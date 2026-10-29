import { describe, expect, it } from 'vitest';
import { computeSlots } from '../../src/model/grid';
import { detectSymmetry, importGridFile, importPuzBytes } from '../../src/model/importGrid';
import { exportPuz } from '../../src/model/puz';
import { fixtureGrid, fromRows } from './helpers';

const opts = { day: 'Wed' as const, outlet: 'NYT', lock: false };

describe('.puz import', () => {
  it('imports grid, letters, clues, circles, rebus and clue notes from an exported file', () => {
    const p = fromRows(['HAT', 'ONE', 'TEN']);
    p.title = 'Tiny';
    p.cells[0] = { ...p.cells[0], l: 'H', rebus: 'HEART' };
    p.cells[2].circle = 1;
    for (const s of computeSlots(3, 3, p.cells).slots) p.clues[s.id] = { text: `Clue ${s.id}` };
    p.clues.D2.notes = 'check this';
    const { puzzle: q, skipped, summary } = importPuzBytes(exportPuz(p), opts);
    expect(q.title).toBe('Tiny');
    expect(q.width).toBe(3);
    expect(q.cells.map((c) => c.rebus ?? c.l).join(',')).toBe('HEART,A,T,O,N,E,T,E,N');
    expect(q.cells[0]).toMatchObject({ l: 'H', rebus: 'HEART', lock: 0, src: 'typed' });
    expect(q.cells[2].circle).toBe(1);
    expect(q.clues.A1.text).toBe('Clue A1');
    expect(q.clues.D3.text).toBe('Clue D3');
    expect(q.clues.D2).toEqual({ text: 'Clue D2', notes: 'check this' });
    expect(q.day).toBe('Wed');
    expect(q.status).toBe('Cluing');
    expect(skipped).toEqual([]);
    expect(summary).toBe('3×3 · 6 clues · 1 rebus · 1 circle');
    expect(q.id).not.toBe(p.id);
  });

  it('locks imported letters when asked', () => {
    const p = fromRows(['CAT#', 'A###', 'T###', '####']);
    const { puzzle: q } = importPuzBytes(exportPuz(p), { ...opts, lock: true });
    expect(q.cells.filter((c) => c.l).every((c) => c.lock === 1 && c.src === 'theme')).toBe(true);
    expect(q.cells.filter((c) => c.b).every((c) => c.lock === 0)).toBe(true);
  });

  it('round-trips every fixture grid', () => {
    for (const id of ['fixture-mini-5x5', 'fixture-open-15x15', 'fixture-themed-15x15']) {
      const p = fixtureGrid(id);
      for (const s of computeSlots(p.width, p.height, p.cells).slots) p.clues[s.id] = { text: `${s.id} text` };
      const { puzzle: q, skipped } = importPuzBytes(exportPuz(p), opts);
      expect(skipped, id).toEqual([]);
      expect(q.cells.map((c) => [c.b, c.rebus ?? c.l, c.circle]), id).toEqual(p.cells.map((c) => [c.b, c.rebus ?? c.l, c.circle]));
      expect(q.clues, id).toEqual(p.clues);
      expect(q.symmetry, id).toBe(detectSymmetry(p));
    }
  });

  it('keeps empty squares empty and reports a partly filled grid', () => {
    const p = fromRows(['C..', '...', '...']);
    const { puzzle: q, summary } = importPuzBytes(exportPuz(p), opts);
    expect(q.cells.filter((c) => c.l).length).toBe(1);
    expect(q.status).toBe('Filling');
    expect(summary).toContain('1 of 9 squares filled');
  });

  it('reports what it could not import', () => {
    const p = fromRows(['CAT', 'ARE', 'TEN']);
    const bytes = exportPuz(p, { author: 'Someone' });
    const { skipped } = importPuzBytes(bytes, opts);
    expect(skipped.join(' ')).toMatch(/author “Someone”/);
  });

  it('imports a scrambled puzzle without letters and says so', () => {
    const p = fromRows(['CAT', 'ARE', 'TEN']);
    const bytes = exportPuz(p);
    bytes[0x32] = 4; // scrambled tag
    const { puzzle: q, skipped } = importPuzBytes(bytes, opts);
    expect(q.cells.every((c) => !c.l)).toBe(true);
    expect(skipped.join(' ')).toMatch(/scrambled/);
  });

  it('detects symmetry', () => {
    expect(detectSymmetry(fromRows(['#..', '...', '..#']))).toBe('rotational');
    expect(detectSymmetry(fromRows(['#.#', '...', '...']))).toBe('left-right');
    expect(detectSymmetry(fromRows(['#..', '...', '...']))).toBe('diagonal');
    expect(detectSymmetry(fromRows(['.#.', '...', '...']))).toBe('left-right');
    expect(detectSymmetry(fromRows(['##.', '...', '...']))).toBe('none');
  });

  it('rejects files that are not .puz', () => {
    expect(() => importGridFile('notes.txt', new Uint8Array([1, 2, 3]), opts)).toThrow(/not a .puz/);
    expect(() => importGridFile('broken.puz', new Uint8Array(20), opts)).toThrow();
  });
});
