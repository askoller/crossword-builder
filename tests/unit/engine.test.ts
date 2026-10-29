// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { boardOf, makeProblem, scopeMask } from '../../src/engine/board';
import { candidatesFor } from '../../src/engine/candidates';
import { checkPuzzle, gridStats } from '../../src/engine/check';
import { Lexicon, letterCode } from '../../src/engine/lexicon';
import { DEFAULT_AFFIXES, dayAdjustment, defaultFloors } from '../../src/engine/settings';
import { fixtureLexicon, fromRows } from './helpers';

const small = () =>
  Lexicon.fromWords(
    [
      { word: 'CAT', score: 50, nyt: 10 },
      { word: 'CAR', score: 45 },
      { word: 'COT', score: 35 },
      { word: 'BAT', score: 30 },
      { word: 'ARE', score: 40 },
      { word: 'TEA', score: 48 },
      { word: 'ZZZ', score: 1 },
      { word: 'ABCD', score: 40 },
    ],
    { notebook: [{ answer: 'COT', boost: 50 }, { answer: 'ICE AGE', boost: 10 }], neverUse: ['BAT'] },
  );

describe('lexicon (SPEC §4.1)', () => {
  it('orders words by base value with the boost, and excludes never-use', () => {
    const lex = small();
    const three = lex.get(3)!;
    // COT: 35 + 50 × 0.3 = 50 ties CAT; ties keep list order
    expect(three.words.slice(0, 4)).toEqual(['CAT', 'COT', 'TEA', 'CAR']);
    expect(lex.info('COT')!.base).toBe(50);
    expect(lex.info('ZZZ')!.neverUse).toBe(true);
    expect(lex.info('BAT')!.neverUse).toBe(true);
    const all = three.match([0, 0, 0], -Infinity);
    expect(all.count).toBe(5); // ZZZ and BAT excluded
  });

  it('adds boosted Notebook answers that are missing, keeping their own spaces', () => {
    const lex = small();
    expect(lex.info('ICEAGE')).toMatchObject({ score: 40, boost: 10, base: 43 });
    expect(lex.phraseParts.get('ICEAGE')).toEqual(['ICE', 'AGE']);
  });

  it('matches patterns with per-position letter bitsets at a floor', () => {
    const lex = small();
    const three = lex.get(3)!;
    const m = three.match([letterCode('C'), 0, letterCode('T')], 0);
    const ids = [...Array(three.n).keys()].filter((i) => m.set[i >>> 5] & (1 << (i & 31)));
    expect(ids.map((i) => three.words[i]).sort()).toEqual(['CAT', 'COT']);
    expect(three.match([letterCode('C'), 0, 0], 46).count).toBe(2); // CAT, COT (boosted)
  });

  it('day adjustment is small and favours familiar words early in the week', () => {
    expect(dayAdjustment('Mon', 5, 100)).toBeGreaterThan(dayAdjustment('Mon', 5, 0));
    expect(dayAdjustment('Sat', 5, 0)).toBeGreaterThan(dayAdjustment('Sat', 5, 100));
    expect(dayAdjustment('Sat', 12, 0)).toBeGreaterThan(dayAdjustment('Sat', 5, 0));
    for (const d of ['Mon', 'Sat'] as const) for (const n of [0, 5, 1000]) expect(Math.abs(dayAdjustment(d, 15, n))).toBeLessThanOrEqual(3);
  });

  it('loads the fixture word list', async () => {
    const lex = await fixtureLexicon();
    expect(lex.size).toBeGreaterThan(270000);
    expect(lex.info('BAGEL')).toMatchObject({ score: 50, boost: 40, base: 60 });
    expect(lex.info('TEAPARTY')).toMatchObject({ boost: 70 });
  });
});

describe('candidates and crossing room (SPEC §4.3)', () => {
  it('lists matching words with the smallest crossing count', () => {
    const lex = small();
    // 3×3 with a block in the middle: A1 / A7 across, D1 / D3 down
    const p = fromRows(['C..', '.#.', '...']);
    const board = boardOf(p);
    const list = candidatesFor(board, 'A1', lex, { day: 'Thu', floor: 0, affixes: DEFAULT_AFFIXES })!;
    expect(list.pattern).toBe('C??');
    expect(list.candidates.map((c) => c.word).sort()).toEqual(['CAR', 'CAT', 'COT']);
    expect(list).toMatchObject({ inList: 3, atFloor: 3 });
    // A1's third letter starts D2 (?..): T → TEA only; R → nothing
    const byWord = Object.fromEntries(list.candidates.map((c) => [c.word, c]));
    expect(byWord.CAT.room).toBe(1);
    expect(byWord.CAR.room).toBe(0);
    expect(byWord.CAT.tightest).toBe('D2');
  });

  it('flags dupes against other complete entries', async () => {
    const lex = await fixtureLexicon();
    const p = fromRows(['#SPOUSE', '#######', '.......']);
    const list = candidatesFor(boardOf(p), 'A2', lex, { day: 'Thu', floor: 0, affixes: DEFAULT_AFFIXES, limit: 100000 })!;
    const spouses = list.candidates.find((c) => c.word === 'SPOUSES');
    expect(spouses?.dupe).toContain('share SPOU');
  });
});

describe('problem scopes (SPEC §4.4)', () => {
  it('splits slots into vars, viability checks and fixed entries for a selection', () => {
    const p = fromRows(['CAT', '...', 'ARE']);
    const board = boardOf(p);
    const prob = makeProblem(board, scopeMask(board, { kind: 'selection', cells: [0] }));
    const kinds = Object.fromEntries(board.index.slots.map((s, k) => [s.id, prob.kinds[k]]));
    // A1 CAT touches the selection and is otherwise complete → var; D1 C.A has an empty
    // cell outside → viability; A5 ARE → fixed; A4 is empty and untouched
    expect(kinds).toMatchObject({ A1: 'var', D1: 'viability', A5: 'fixed', A4: 'ignore' });
    expect(prob.cells[0]).toBe(0);
  });

  it('never selects locked cells or blocks', () => {
    const p = fromRows(['ca#', '...', '...']);
    const board = boardOf(p);
    expect([...scopeMask(board, { kind: 'selection', cells: [0, 1, 2, 3] })].slice(0, 4)).toEqual([0, 0, 0, 1]);
  });
});

describe('check (SPEC §4.6)', () => {
  it('reports dupes, viability, entry quality and grid stats', async () => {
    const lex = await fixtureLexicon();
    const p = fromRows(['SPOUSE#', '#######', 'SPOUSES', '#######', 'ERENOW#', '#######', 'ERE##..']);
    const r = checkPuzzle(p, lex, { floor: defaultFloors(), affixes: DEFAULT_AFFIXES, symmetry: 'none' });
    const dupes = r.issues.filter((i) => i.kind === 'dupe');
    expect(dupes.map((d) => d.slots)).toEqual([
      ['A1', 'A2'],
      ['A3', 'A4'],
    ]);
    expect(dupes[1].text).toContain('ERE is a word in ERENOW');
    expect(r.issues.some((i) => i.kind === 'grid' && i.text.includes('two-letter'))).toBe(true);
    expect(r.stats.connected).toBe(false);
    expect(r.count).toBeGreaterThan(0);
  });

  it('warns about slots with few candidates', async () => {
    const lex = await fixtureLexicon();
    const p = fromRows(['QZX..']);
    const r = checkPuzzle(p, lex, { floor: 0, affixes: DEFAULT_AFFIXES, symmetry: 'none' });
    expect(r.issues[0]).toMatchObject({ level: 'error', kind: 'viability', slots: ['A1'] });
  });

  it('computes grid stats', () => {
    const p = fromRows(['#...', '....', '....', '...#']);
    const st = gridStats(p, 'rotational');
    expect(st).toMatchObject({ blocks: 2, symmetric: true, connected: true, unchecked: 0, twoLetter: 0, longest: 4, shortest: 3 });
  });
});
