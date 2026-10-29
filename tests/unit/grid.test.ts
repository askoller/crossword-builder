import { describe, expect, it } from 'vitest';
import { computeSlots, isSymmetric, slotPattern, symmetricPartners } from '../../src/model/grid';
import { fixtureGrid, fromRows } from './helpers';

describe('slots and numbering', () => {
  it('numbers a small grid left-to-right, top-to-bottom', () => {
    const p = fromRows(['#....', '.....', '.....', '.....', '....#']);
    const idx = computeSlots(p.width, p.height, p.cells);
    const numbered = idx.numbers.map((n, i) => [i, n]).filter(([, n]) => n);
    expect(numbered).toEqual([
      [1, 1], [2, 2], [3, 3], [4, 4],
      [5, 5], [10, 6], [15, 7], [20, 8],
    ]);
  });

  it('builds the expected across and down slots', () => {
    const p = fromRows(['#....', '.....', '.....', '.....', '....#']);
    const idx = computeSlots(p.width, p.height, p.cells);
    const across = idx.slots.filter((s) => s.dir === 'across').map((s) => [s.id, s.cells]);
    const down = idx.slots.filter((s) => s.dir === 'down').map((s) => [s.id, s.cells]);
    expect(across).toEqual([
      ['A1', [1, 2, 3, 4]],
      ['A5', [5, 6, 7, 8, 9]],
      ['A6', [10, 11, 12, 13, 14]],
      ['A7', [15, 16, 17, 18, 19]],
      ['A8', [20, 21, 22, 23]],
    ]);
    expect(down).toEqual([
      ['D1', [1, 6, 11, 16, 21]],
      ['D2', [2, 7, 12, 17, 22]],
      ['D3', [3, 8, 13, 18, 23]],
      ['D4', [4, 9, 14, 19]],
      ['D5', [5, 10, 15, 20]],
    ]);
    expect(idx.numbers[20]).toBe(8);
    expect(idx.across[12]).toBe(2);
    expect(idx.slots[idx.down[12]].id).toBe('D2');
  });

  it('skips runs of one (unchecked squares) and blocks', () => {
    const p = fromRows(['.#.', '...', '.#.']);
    const idx = computeSlots(p.width, p.height, p.cells);
    expect(idx.slots.map((s) => s.id)).toEqual(['A3', 'D1', 'D2']);
    expect(idx.across[0]).toBe(-1);
    expect(idx.down[1]).toBe(-1);
    expect(idx.numbers).toEqual([1, 0, 2, 3, 0, 0, 0, 0, 0]);
  });

  it('numbers the 15x15 fixture like a standard grid', () => {
    const p = fixtureGrid('fixture-open-15x15');
    const idx = computeSlots(p.width, p.height, p.cells);
    expect(Math.max(...idx.numbers)).toBe(69);
    expect(idx.slots.filter((s) => s.dir === 'across')).toHaveLength(37);
    expect(idx.slots.filter((s) => s.dir === 'down')).toHaveLength(41);
    expect(idx.slots.every((s) => s.cells.length >= 3)).toBe(true);
  });

  it('shows patterns with ? for empty cells and brackets for rebus', () => {
    const p = fromRows(['AB.', '...', '...']);
    p.cells[2] = { ...p.cells[2], l: 'C', rebus: 'CAT', src: 'typed' };
    const idx = computeSlots(p.width, p.height, p.cells);
    expect(slotPattern(p.cells, idx.slots[0])).toBe('AB[CAT]');
    expect(slotPattern(p.cells, idx.slots[1])).toBe('???');
  });
});

describe('symmetry', () => {
  it('pairs cells for each symmetry', () => {
    expect(symmetricPartners(0, 15, 15, 'rotational')).toEqual([0, 224]);
    expect(symmetricPartners(112, 15, 15, 'rotational')).toEqual([112]);
    expect(symmetricPartners(16, 15, 15, 'left-right')).toEqual([16, 28]);
    expect(symmetricPartners(1, 15, 15, 'diagonal')).toEqual([1, 15]);
    expect(symmetricPartners(1, 15, 13, 'diagonal')).toEqual([1]);
    expect(symmetricPartners(5, 15, 15, 'none')).toEqual([5]);
  });

  it('recognises symmetric fixture grids', () => {
    expect(isSymmetric(fixtureGrid('fixture-open-15x15'), 'rotational')).toBe(true);
    expect(isSymmetric(fixtureGrid('fixture-mini-5x5'), 'rotational')).toBe(true);
    expect(isSymmetric(fromRows(['#..', '...', '...']), 'rotational')).toBe(false);
  });
});
