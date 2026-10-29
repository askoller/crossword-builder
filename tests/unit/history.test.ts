import { describe, expect, it } from 'vitest';
import { applyDiff, emptyHistory, HISTORY_CAP, makeDiff, pushDiff, redo, undo } from '../../src/model/history';
import { fromRows, rowsOf } from './helpers';

describe('undo / redo', () => {
  it('stores only the changed cells', () => {
    const p = fromRows(['...', '...', '...']);
    const d = makeDiff(p, new Map([[0, { ...p.cells[0], l: 'A', src: 'typed' }], [1, { ...p.cells[1] }]]), [0, 'across']);
    expect(d!.c).toHaveLength(1);
    expect(d!.at).toEqual([0, 'across']);
    expect(makeDiff(p, new Map([[1, { ...p.cells[1] }]]))).toBeNull();
  });

  it('undoes and redoes a sequence of steps', () => {
    let p = fromRows(['...', '...', '...']);
    let h = emptyHistory(p.id);
    const states = [rowsOf(p)];
    for (const [i, l] of [[0, 'C'], [1, 'A'], [2, 'T']] as const) {
      const d = makeDiff(p, new Map([[i, { ...p.cells[i], l, src: 'typed' as const }]]))!;
      p = applyDiff(p, d);
      h = pushDiff(h, d);
      states.push(rowsOf(p));
    }
    expect(rowsOf(p)[0]).toBe('CAT');
    for (let k = 2; k >= 0; k--) {
      const r = undo(p, h)!;
      p = r.puzzle;
      h = r.history;
      expect(rowsOf(p)).toEqual(states[k]);
    }
    expect(undo(p, h)).toBeNull();
    for (let k = 1; k <= 3; k++) {
      const r = redo(p, h)!;
      p = r.puzzle;
      h = r.history;
      expect(rowsOf(p)).toEqual(states[k]);
    }
    expect(redo(p, h)).toBeNull();
  });

  it('a new step clears the redo stack', () => {
    let p = fromRows(['...']);
    let h = emptyHistory(p.id);
    const d1 = makeDiff(p, new Map([[0, { ...p.cells[0], l: 'A' }]]))!;
    p = applyDiff(p, d1);
    h = pushDiff(h, d1);
    const u = undo(p, h)!;
    expect(u.history.redo).toHaveLength(1);
    const d2 = makeDiff(u.puzzle, new Map([[1, { ...p.cells[1], l: 'B' }]]))!;
    expect(pushDiff(u.history, d2).redo).toHaveLength(0);
  });

  it('undoes block changes with their symmetric partner in one step', () => {
    const p = fromRows(['...', '...', '...']);
    const block = { b: 1 as const, l: '', rebus: null, circle: 0 as const, lock: 0 as const, src: null };
    const d = makeDiff(p, new Map([[0, block], [8, block]]))!;
    const q = applyDiff(p, d);
    expect(rowsOf(q)).toEqual(['#..', '...', '..#']);
    expect(rowsOf(undo(q, pushDiff(emptyHistory(p.id), d))!.puzzle)).toEqual(['...', '...', '...']);
  });

  it('undoes clue changes', () => {
    const p = fromRows(['...', '...', '...']);
    const d = makeDiff(p, new Map(), undefined, new Map([['A1', { text: 'Feline' }]]))!;
    const q = applyDiff(p, d);
    expect(q.clues.A1.text).toBe('Feline');
    expect(applyDiff(q, d, true).clues.A1).toBeUndefined();
  });

  it(`caps the undo stack at ${HISTORY_CAP}`, () => {
    let p = fromRows(['...']);
    let h = emptyHistory(p.id);
    for (let k = 0; k < HISTORY_CAP + 20; k++) {
      const d = makeDiff(p, new Map([[0, { ...p.cells[0], l: k % 2 ? 'A' : 'B' }]]))!;
      p = applyDiff(p, d);
      h = pushDiff(h, d);
    }
    expect(h.undo).toHaveLength(HISTORY_CAP);
  });
});
