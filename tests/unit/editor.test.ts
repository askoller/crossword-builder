import { describe, expect, it } from 'vitest';
import * as ed from '../../src/model/editor';
import { computeSlots } from '../../src/model/grid';
import { applyDiff, makeDiff } from '../../src/model/history';
import type { Puzzle } from '../../src/model/types';
import { fromRows, rowsOf } from './helpers';

/** Apply an edit result to the puzzle, like the store does. */
function apply(p: Puzzle, r: ed.EditResult): Puzzle {
  const d = makeDiff(p, r.changes);
  return d ? applyDiff(p, d) : p;
}

function typeAll(p: Puzzle, cur: ed.Cursor, letters: string): { p: Puzzle; cur: ed.Cursor } {
  for (const ch of letters) {
    const r = ed.typeLetter(p, computeSlots(p.width, p.height, p.cells), cur, ch);
    p = apply(p, r);
    cur = r.cursor;
  }
  return { p, cur };
}

describe('typing', () => {
  it('advances within the word and stays on the last cell', () => {
    const start = fromRows(['#....', '.....', '.....', '.....', '....#']);
    const { p, cur } = typeAll(start, { cell: 1, dir: 'across' }, 'abcde');
    expect(rowsOf(p)[0]).toBe('#ABCE');
    expect(cur.cell).toBe(4);
  });

  it('types down a column', () => {
    const start = fromRows(['#....', '.....', '.....', '.....', '....#']);
    const { p, cur } = typeAll(start, { cell: 2, dir: 'down' }, 'TEST');
    expect(rowsOf(p).map((r) => r[2]).join('')).toBe('TEST.');
    expect(cur).toEqual({ cell: 22, dir: 'down' });
  });

  it('skips locked cells', () => {
    const start = fromRows(['.a.b.', '.....', '.....']);
    const { p, cur } = typeAll(start, { cell: 0, dir: 'across' }, 'XYZ');
    expect(rowsOf(p)[0]).toBe('XaYbZ');
    expect(cur.cell).toBe(4);
  });

  it('types into the next open cell when the cursor is on a locked cell', () => {
    const start = fromRows(['a....', '.....']);
    const { p } = typeAll(start, { cell: 0, dir: 'across' }, 'Q');
    expect(rowsOf(p)[0]).toBe('aQ...');
  });

  it('ignores blocks and non-letters', () => {
    const start = fromRows(['#....', '.....']);
    const idx = computeSlots(start.width, start.height, start.cells);
    expect(ed.typeLetter(start, idx, { cell: 0, dir: 'across' }, 'A').changes.size).toBe(0);
    expect(ed.typeLetter(start, idx, { cell: 1, dir: 'across' }, '1').changes.size).toBe(0);
  });

  it('marks typed letters as typed', () => {
    const start = fromRows(['.....', '.....']);
    const { p } = typeAll(start, { cell: 0, dir: 'across' }, 'A');
    expect(p.cells[0]).toMatchObject({ l: 'A', src: 'typed', rebus: null });
  });
});

describe('backspace', () => {
  it('clears the current cell when it has a letter', () => {
    const p = fromRows(['ABC..', '.....']);
    const idx = computeSlots(p.width, p.height, p.cells);
    const r = ed.backspace(p, idx, { cell: 2, dir: 'across' });
    expect(rowsOf(apply(p, r))[0]).toBe('AB...');
    expect(r.cursor.cell).toBe(2);
  });

  it('moves back and clears when the current cell is empty', () => {
    const p = fromRows(['ABC..', '.....']);
    const idx = computeSlots(p.width, p.height, p.cells);
    const r = ed.backspace(p, idx, { cell: 3, dir: 'across' });
    expect(rowsOf(apply(p, r))[0]).toBe('AB...');
    expect(r.cursor.cell).toBe(2);
  });

  it('skips locked cells when moving back', () => {
    const p = fromRows(['Ab...', '.....']);
    const idx = computeSlots(p.width, p.height, p.cells);
    const r = ed.backspace(p, idx, { cell: 2, dir: 'across' });
    expect(rowsOf(apply(p, r))[0]).toBe('.b...');
    expect(r.cursor.cell).toBe(0);
  });

  it('does nothing at the start of an empty word', () => {
    const p = fromRows(['.....', '.....']);
    const idx = computeSlots(p.width, p.height, p.cells);
    const r = ed.backspace(p, idx, { cell: 0, dir: 'across' });
    expect(r.changes.size).toBe(0);
    expect(r.cursor.cell).toBe(0);
  });
});

describe('blocks and symmetry', () => {
  it('toggles the cell and its 180° partner', () => {
    const p = fromRows(['.....', '.....', '.....', '.....', '.....']);
    const once = apply(p, ed.toggleBlock(p, { cell: 1, dir: 'across' }));
    expect(rowsOf(once)).toEqual(['.#...', '.....', '.....', '.....', '...#.']);
    const twice = apply(once, ed.toggleBlock(once, { cell: 1, dir: 'across' }));
    expect(rowsOf(twice)).toEqual(rowsOf(p));
  });

  it('toggles a single center cell', () => {
    const p = fromRows(['...', '...', '...']);
    expect(rowsOf(apply(p, ed.toggleBlock(p, { cell: 4, dir: 'across' })))).toEqual(['...', '.#.', '...']);
  });

  it('follows left-right, diagonal and no symmetry', () => {
    const p = fromRows(['....', '....', '....', '....']);
    expect(rowsOf(apply({ ...p, symmetry: 'left-right' }, ed.toggleBlock({ ...p, symmetry: 'left-right' }, { cell: 4, dir: 'across' }))))
      .toEqual(['....', '#..#', '....', '....']);
    expect(rowsOf(apply({ ...p, symmetry: 'diagonal' }, ed.toggleBlock({ ...p, symmetry: 'diagonal' }, { cell: 1, dir: 'across' }))))
      .toEqual(['.#..', '#...', '....', '....']);
    expect(rowsOf(apply({ ...p, symmetry: 'none' }, ed.toggleBlock({ ...p, symmetry: 'none' }, { cell: 1, dir: 'across' }))))
      .toEqual(['.#..', '....', '....', '....']);
  });

  it('clears letters when blocking and never blocks locked cells', () => {
    const p = fromRows(['A....', '.....', '.....', '.....', '....z']);
    expect(ed.toggleBlock(p, { cell: 24, dir: 'across' }).changes.size).toBe(0);
    const r = ed.toggleBlock(p, { cell: 0, dir: 'across' });
    // partner (24) is locked, so only cell 0 changes
    expect([...r.changes.keys()]).toEqual([0]);
    expect(r.changes.get(0)).toMatchObject({ b: 1, l: '' });
  });
});

describe('navigation', () => {
  const p = fromRows(['#....', '.....', '.....', '.....', '....#']);
  const idx = computeSlots(p.width, p.height, p.cells);

  it('tapping the selected cell switches direction', () => {
    expect(ed.tapCell(p, idx, { cell: 7, dir: 'across' }, 7)).toEqual({ cell: 7, dir: 'down' });
    expect(ed.tapCell(p, idx, { cell: 7, dir: 'across' }, 8)).toEqual({ cell: 8, dir: 'across' });
  });

  it('arrows switch axis first, then move skipping blocks', () => {
    expect(ed.arrow(p, { cell: 5, dir: 'across' }, 'ArrowDown')).toEqual({ cell: 5, dir: 'down' });
    expect(ed.arrow(p, { cell: 5, dir: 'down' }, 'ArrowUp')).toEqual({ cell: 5, dir: 'down' });
    expect(ed.arrow(p, { cell: 2, dir: 'across' }, 'ArrowLeft')).toEqual({ cell: 1, dir: 'across' });
    expect(ed.arrow(p, { cell: 1, dir: 'across' }, 'ArrowLeft')).toEqual({ cell: 1, dir: 'across' });
    expect(ed.arrow(p, { cell: 23, dir: 'across' }, 'ArrowRight')).toEqual({ cell: 23, dir: 'across' });
  });

  it('steps through entries across then down, wrapping', () => {
    let cur: ed.Cursor = { cell: 1, dir: 'across' };
    const seen: string[] = [];
    for (let k = 0; k < 11; k++) {
      cur = ed.stepEntry(p, idx, cur, 1);
      seen.push(ed.currentSlot(idx, cur)!.id);
    }
    expect(seen).toEqual(['A5', 'A6', 'A7', 'A8', 'D1', 'D2', 'D3', 'D4', 'D5', 'A1', 'A5']);
    expect(ed.currentSlot(idx, ed.stepEntry(p, idx, { cell: 1, dir: 'across' }, -1))!.id).toBe('D5');
  });

  it('moves to the first empty cell of the next entry', () => {
    const q = fromRows(['#....', 'AB...', '.....', '.....', '....#']);
    const qi = computeSlots(q.width, q.height, q.cells);
    expect(ed.stepEntry(q, qi, { cell: 1, dir: 'across' }, 1)).toEqual({ cell: 7, dir: 'across' });
  });
});

describe('rebus, circle, lock', () => {
  it('sets and clears a rebus', () => {
    const p = fromRows(['...', '...', '...']);
    const r = ed.setRebus(p, { cell: 0, dir: 'across' }, 'cat');
    expect(r.changes.get(0)).toMatchObject({ l: 'C', rebus: 'CAT' });
    const q = apply(p, r);
    expect(ed.setRebus(q, { cell: 0, dir: 'across' }, 'C').changes.get(0)).toMatchObject({ l: 'C', rebus: null });
  });

  it('toggles a circle', () => {
    const p = fromRows(['...', '...', '...']);
    const q = apply(p, ed.toggleCircle(p, { cell: 4, dir: 'across' }));
    expect(q.cells[4].circle).toBe(1);
    expect(apply(q, ed.toggleCircle(q, { cell: 4, dir: 'across' })).cells[4].circle).toBe(0);
  });

  it('locks and unlocks the current word', () => {
    const p = fromRows(['AB.', '...', '...']);
    const idx = computeSlots(p.width, p.height, p.cells);
    const q = apply(p, ed.toggleLockWord(p, idx, { cell: 0, dir: 'across' }));
    expect(rowsOf(q)[0]).toBe('ab.');
    expect(q.cells[2].lock).toBe(1);
    expect(q.cells[0].src).toBe('theme');
    const r = apply(q, ed.toggleLockWord(q, idx, { cell: 0, dir: 'across' }));
    expect(rowsOf(r)[0]).toBe('AB.');
    expect(r.cells[0].src).toBe('typed');
  });
});
