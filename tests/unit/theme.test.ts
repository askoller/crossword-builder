import { describe, expect, it } from 'vitest';
import { applyDiff, makeDiff } from '../../src/model/history';
import { computeSlots } from '../../src/model/grid';
import { findPlaced, placeThemeEntry, unlockSlot } from '../../src/model/theme';
import type { Puzzle } from '../../src/model/types';
import { fromRows, rowsOf } from './helpers';

const apply = (p: Puzzle, cells: Map<number, Puzzle['cells'][number]>) => applyDiff(p, makeDiff(p, cells, [0, 'across'])!);
const slot = (p: Puzzle, id: string) => computeSlots(p.width, p.height, p.cells).slots.find((s) => s.id === id)!;

describe('theme entries in the grid', () => {
  it('places an entry as locked theme letters', () => {
    const p = fromRows(['.....', '.....', '.....', '.....', '.....']);
    const r = placeThemeEntry(p, slot(p, 'A6'), 'TEA PARTY');
    expect(r.ok).toBe(false);
    const ok = placeThemeEntry(p, slot(p, 'A6'), 'BAGEL');
    expect(ok.ok).toBe(true);
    const q = apply(p, (ok as { changes: Map<number, Puzzle['cells'][number]> }).changes);
    expect(rowsOf(q)[1]).toBe('bagel');
    expect(q.cells[5].src).toBe('theme');
    const idx = computeSlots(q.width, q.height, q.cells);
    expect(findPlaced(q, idx, 'BAGEL').map((s) => s.id)).toEqual(['A6']);
  });

  it('refuses to overwrite a crossing locked letter that differs, allows one that agrees', () => {
    const p = fromRows(['b....', 'a....', 'g....', 'e....', 'l....']);
    expect(placeThemeEntry(p, slot(p, 'A1'), 'CRANE')).toMatchObject({ ok: false });
    expect(placeThemeEntry(p, slot(p, 'A1'), 'BRAKE').ok).toBe(true);
  });

  it('unlocks an entry but keeps letters a crossing locked entry needs', () => {
    const p = fromRows(['bagel', 'a....', 'g....', 'e....', 'l....']);
    const idx = computeSlots(p.width, p.height, p.cells);
    const q = apply(p, unlockSlot(p, slot(p, 'A1'), idx));
    expect(rowsOf(q)[0]).toBe('bAGEL');
    expect(q.cells[1].src).toBe('typed');
  });
});
