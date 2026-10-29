import { describe, expect, it } from 'vitest';
import { letterBreakdown, mergeNotebooks, symmetryCheck, type NotebookFile } from '../../src/model/notebook';

const ans = (answer: string, updated?: number, boost = 50) => ({ answer, clues: [`clue ${updated ?? 0}`], boost, note: '', ...(updated === undefined ? {} : { updated }) });
const theme = (id: string, updated: number, title = id) => ({ id, title, description: '', revealer: null, entries: [], updated });
const file = (p: Partial<NotebookFile>): Partial<NotebookFile> => ({ clues: [], themes: [], deleted: [], synced: 0, ...p });

describe('notebook merge (SPEC §5.4)', () => {
  it('newest updated wins per key; answers keyed by letters', () => {
    const a = file({ clues: [ans('TEA PARTY', 100)] });
    const b = file({ clues: [ans('TEAPARTY', 200)] });
    const m = mergeNotebooks(a, b);
    expect(m.clues).toHaveLength(1);
    expect(m.clues[0].answer).toBe('TEAPARTY');
    expect(m.clues[0].updated).toBe(200);
  });

  it('keeps items only one side has', () => {
    const m = mergeNotebooks(file({ clues: [ans('BAGEL', 1)] }), file({ themes: [theme('t1', 1)] }));
    expect(m.clues.map((c) => c.answer)).toEqual(['BAGEL']);
    expect(m.themes.map((t) => t.id)).toEqual(['t1']);
  });

  it('items with no updated count as 0', () => {
    const m = mergeNotebooks(file({ clues: [ans('BAGEL')] }), file({ clues: [ans('BAGEL', 5)] }));
    expect(m.clues[0].updated).toBe(5);
  });

  it('a tombstone wins over older edits and loses to newer ones', () => {
    const local = file({ clues: [ans('BAGEL', 100), ans('ERA', 300)], themes: [theme('t1', 50)] });
    const remote = file({ deleted: [{ key: 'answer:BAGEL', at: 200 }, { key: 'answer:ERA', at: 200 }, { key: 'theme:t1', at: 50 }] });
    const m = mergeNotebooks(local, remote);
    expect(m.clues.map((c) => c.answer)).toEqual(['ERA']);
    expect(m.themes).toEqual([]); // equal time: tombstone wins
    expect(m.deleted).toEqual([
      { key: 'answer:BAGEL', at: 200 },
      { key: 'theme:t1', at: 50 },
    ]);
  });

  it('tombstones merge to the latest time and delete items missing everywhere', () => {
    const m = mergeNotebooks(file({ deleted: [{ key: 'theme:x', at: 10 }] }), file({ deleted: [{ key: 'theme:x', at: 30 }] }));
    expect(m.deleted).toEqual([{ key: 'theme:x', at: 30 }]);
  });

  it('is symmetric and idempotent', () => {
    const a = file({ clues: [ans('BAGEL', 100, 10), ans('ERA', 5)], themes: [theme('t1', 7, 'A')], deleted: [{ key: 'answer:OBOE', at: 9 }], synced: 3 });
    const b = file({ clues: [ans('BAGEL', 100, 90), ans('OBOE', 4)], themes: [theme('t1', 7, 'B'), theme('t2', 1)], synced: 8 });
    const ab = mergeNotebooks(a, b);
    expect(ab).toEqual(mergeNotebooks(b, a));
    expect(mergeNotebooks(ab, ab)).toEqual(ab);
    expect(mergeNotebooks(ab, a)).toEqual(ab);
    expect(ab.synced).toBe(8);
    expect(ab.clues.map((c) => c.answer)).toEqual(['BAGEL', 'ERA']);
  });

  it('tolerates missing arrays', () => {
    expect(mergeNotebooks({}, { clues: [ans('ERA', 1)] }).clues).toHaveLength(1);
  });
});

describe('notebook helpers', () => {
  it('breaks answers into letters and words', () => {
    expect(letterBreakdown('TEAR GAS')).toBe('7 letters · 2 words (4, 3)');
    expect(letterBreakdown('BAGEL')).toBe('5 letters');
    expect(letterBreakdown('GO FOR BROKE')).toBe('10 letters · 3 words (2, 3, 5)');
  });

  it('checks theme symmetry', () => {
    const ok = symmetryCheck(['ABCDEFGH', 'HGFEDCBA', 'ABCDEFGHIJ', 'JIHGFEDCBA', 'ABCDEFGHI']);
    expect(ok.ok).toBe(true);
    expect(ok.label).toBe('8·8 · 10·10 · 9 center');
    expect(symmetryCheck(['ABCDEFGHIJKLM', 'ABCDEFGH', 'ABCDEFGH']).label).toBe('8·8 · 13 center');
    expect(symmetryCheck(['ABCDEFGHIJKL', 'ABCDEFGH', 'ABCDEFGH']).ok).toBe(false);
    // one odd leftover is a center entry; an even one or two leftovers are unpaired
    expect(symmetryCheck(['ABCDEFGHIJKL', 'ABCDEFGH', 'ABCDEFGH']).label).toBe('12 unpaired');
    expect(symmetryCheck(['ABCDEFGHIJKLM', 'ABCDEFGHI']).label).toBe('9, 13 unpaired');
    expect(symmetryCheck(['ABCDEFGHI'], 16).label).toBe('9 unpaired');
    expect(symmetryCheck([]).label).toBe('No entries');
  });
});
