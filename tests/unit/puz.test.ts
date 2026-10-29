import { describe, expect, it } from 'vitest';
import { computeSlots } from '../../src/model/grid';
import { cksum, exportPuz, latin1, puzClueOrder, puzzleFileBase, readPuz } from '../../src/model/puz';
import { fixtureGrid, fromRows } from './helpers';

describe('.puz export (SPEC §7)', () => {
  it('checksum matches the Across Lite algorithm', () => {
    // Hand-computed: rotate right, then add each byte.
    expect(cksum(new Uint8Array([]))).toBe(0);
    expect(cksum(new Uint8Array([1]))).toBe(1);
    expect(cksum(new Uint8Array([1, 2]))).toBe(0x8002);
    expect(cksum(new Uint8Array([0x41, 0x42, 0x43]))).toBe(0x4074);
  });

  it('round-trips a filled grid with clues', () => {
    const p = fromRows(['CAT#', 'ARE#', 'TEN#', '####']);
    p.title = 'Mini test';
    const slots = computeSlots(p.width, p.height, p.cells).slots;
    for (const s of slots) p.clues[s.id] = { text: `Clue for ${s.id}` };
    p.clues.A1.notes = 'a note';
    const bytes = exportPuz(p, { author: 'A. Constructor', copyright: '© 2026' });
    const r = readPuz(bytes);
    expect(r.checksumsOk).toBe(true);
    expect(r.width).toBe(4);
    expect(r.height).toBe(4);
    expect(r.solution).toBe('CAT.ARE.TEN.....');
    expect(r.fill).toBe('---.---.---.....');
    expect(r.title).toBe('Mini test');
    expect(r.author).toBe('A. Constructor');
    expect(r.copyright).toBe('© 2026');
    // number order, Across before Down at the same number
    expect(puzClueOrder(p)).toEqual(['A1', 'D1', 'D2', 'D3', 'A4', 'A5']);
    expect(r.clues).toEqual(['Clue for A1', 'Clue for D1', 'Clue for D2', 'Clue for D3', 'Clue for A4', 'Clue for A5']);
    expect(r.notes).toBe('1A: a note');
    expect(r.sectionNames).toEqual([]);
  });

  it('writes rebus squares (GRBS/RTBL) and circles (GEXT)', () => {
    const p = fromRows(['HAT', 'ONE', 'TEN']);
    p.cells[0] = { ...p.cells[0], l: 'H', rebus: 'HEART' };
    p.cells[8] = { ...p.cells[8], l: 'H', rebus: 'HEART' };
    p.cells[4] = { ...p.cells[4], rebus: 'STAR', l: 'S' };
    p.cells[2].circle = 1;
    p.cells[6].circle = 1;
    const r = readPuz(exportPuz(p));
    expect(r.checksumsOk).toBe(true);
    expect(r.sectionNames).toEqual(['GRBS', 'RTBL', 'GEXT']);
    expect([...r.rebus]).toEqual([
      [0, 'HEART'],
      [4, 'STAR'],
      [8, 'HEART'],
    ]);
    expect([...r.circles]).toEqual([2, 6]);
    expect(r.solution).toBe('HATOSETEH');
  });

  it('round-trips every fixture grid', () => {
    for (const id of ['fixture-mini-5x5', 'fixture-open-15x15', 'fixture-themed-15x15']) {
      const p = fixtureGrid(id);
      const r = readPuz(exportPuz(p));
      expect(r.checksumsOk, id).toBe(true);
      expect(r.width * r.height).toBe(p.cells.length);
      expect(r.clues.length).toBe(computeSlots(p.width, p.height, p.cells).slots.length);
      p.cells.forEach((c, i) => {
        expect(r.solution[i]).toBe(c.b ? '.' : (c.rebus ?? c.l)[0] ?? '-');
        expect(r.circles.has(i)).toBe(!!c.circle);
      });
    }
  });

  it('detects a corrupted file', () => {
    const bytes = exportPuz(fromRows(['CAT', 'ARE', 'TEN']));
    bytes[0x34] = 0x5a; // change a solution letter
    expect(readPuz(bytes).checksumsOk).toBe(false);
  });

  it('encodes clue text as ISO-8859-1', () => {
    expect([...latin1('“Café” — it’s…')]).toEqual([...latin1('"Café" -- it\'s...')]);
    expect(latin1('é')[0]).toBe(0xe9);
    expect(latin1('漢')[0]).toBe(0x3f);
  });

  it('names files <slug>-<id8>', () => {
    expect(puzzleFileBase({ id: '1234abcd-ef00-4000-8000-000000000000', title: 'Tea Party, Thursday!' })).toBe('tea-party-thursday-1234abcd');
    expect(puzzleFileBase({ id: 'abcdef1234', title: '  ' })).toBe('untitled-abcdef12');
  });
});
