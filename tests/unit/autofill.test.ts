// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { autofill, type AutofillEvent, type AutofillOptions, type FillResult } from '../../src/engine/autofill';
import { boardOf, slotWord } from '../../src/engine/board';
import { dupeOf, Segmenter } from '../../src/engine/dupes';
import type { Lexicon } from '../../src/engine/lexicon';
import { DEFAULT_AFFIXES, defaultFloors } from '../../src/engine/settings';
import type { AutofillScope } from '../../src/engine/protocol';
import type { Puzzle } from '../../src/model/types';
import { fixtureGrid, fixtureLexicon } from './helpers';

const opts = (o: Partial<AutofillOptions> = {}): AutofillOptions => ({
  day: 'Wed',
  floor: defaultFloors(),
  keepOpen: 3,
  affixes: DEFAULT_AFFIXES,
  maxResults: 3,
  timeLimitMs: 20_000,
  improveMs: 200,
  ...o,
});

function run(p: Puzzle, scope: AutofillScope, lex: Lexicon, o: AutofillOptions, onFirst?: (ms: number) => void) {
  const t0 = Date.now();
  const results: FillResult[] = [];
  const events: AutofillEvent[] = [];
  for (const e of autofill(p, scope, lex, o)) {
    events.push(e);
    if (e.type === 'result') {
      if (!results.length) onFirst?.(Date.now() - t0);
      if (e.replaces) results[e.index] = e.result;
      else results.push(e.result);
    }
  }
  return { results, fail: events.find((e) => e.type === 'fail') };
}

function apply(p: Puzzle, fill: Record<number, string>): Puzzle {
  const q = structuredClone(p);
  for (const [i, l] of Object.entries(fill)) q.cells[+i] = { ...q.cells[+i], l, src: 'autofill' };
  return q;
}

function assertValid(q: Puzzle, lex: Lexicon, onlyTouching?: Set<number>) {
  const b = boardOf(q);
  const seg = Segmenter.forLexicon(lex);
  const words: string[] = [];
  for (const s of b.index.slots) {
    if (onlyTouching && !s.cells.some((c) => onlyTouching.has(c))) continue;
    const w = slotWord(b.cells, s);
    if (!w) continue; // a viability slot with empty cells outside the scope
    const info = lex.info(w);
    expect(info, `${s.id} ${w}`).not.toBeNull();
    expect(info!.neverUse).toBe(false);
    words.push(w);
  }
  for (let i = 0; i < words.length; i++)
    for (let j = i + 1; j < words.length; j++) expect(dupeOf(words[i], words[j], { affixes: DEFAULT_AFFIXES, segmenter: seg }), `${words[i]} / ${words[j]}`).toBeNull();
  return words.length;
}

describe('autofill (SPEC §4.4)', () => {
  it('fills the whole fixture 15×15 grid with valid, dupe-free words', async () => {
    const lex = await fixtureLexicon();
    const p = fixtureGrid('fixture-open-15x15');
    const { results, fail } = run(p, { kind: 'grid' }, lex, opts({ maxResults: 2, wanted: 2 }));
    expect(fail).toBeUndefined();
    expect(results.length).toBe(2);
    const q = apply(p, results[0].fill);
    expect(q.cells.every((c) => c.b || c.l)).toBe(true);
    expect(assertValid(q, lex)).toBe(boardOf(p).index.slots.length);
    expect(results[0].stats.average).toBeGreaterThan(40);
    // distinct: differ in at least 15% of open cells
    const open = Object.keys(results[0].fill).length;
    const diff = Object.keys(results[0].fill).filter((k) => results[0].fill[+k] !== results[1].fill[+k]).length;
    expect(diff).toBeGreaterThanOrEqual(Math.ceil(open * 0.15));
  }, 60_000);

  it('fills the themed grid around its locked theme entries', async () => {
    const lex = await fixtureLexicon();
    const p = fixtureGrid('fixture-themed-15x15');
    const { results, fail } = run(p, { kind: 'grid' }, lex, opts({ maxResults: 1, wanted: 1 }));
    expect(fail).toBeUndefined();
    const q = apply(p, results[0].fill);
    p.cells.forEach((c, i) => c.lock && expect(q.cells[i].l).toBe(c.l));
    // every slot that had an empty square is now a valid word (theme rows are fixed)
    assertValid(q, lex, new Set(Object.keys(results[0].fill).map(Number)));
  }, 60_000);

  it('selection autofill never changes letters outside the selection and keeps touched slots valid', async () => {
    const lex = await fixtureLexicon();
    const base = fixtureGrid('fixture-open-15x15');
    const full = apply(base, run(base, { kind: 'grid' }, lex, opts({ maxResults: 1, wanted: 1 })).results[0].fill);
    // a 4×4 block of squares in the middle, minus blocks
    const sel: number[] = [];
    for (let r = 5; r < 9; r++) for (let c = 5; c < 9; c++) if (!full.cells[r * 15 + c].b) sel.push(r * 15 + c);
    const { results, fail } = run(full, { kind: 'selection', cells: sel }, lex, opts({ maxResults: 3, wanted: 3, timeLimitMs: 8000 }));
    expect(fail).toBeUndefined();
    expect(results.length).toBeGreaterThan(0);
    const selected = new Set(sel);
    for (const r of results) {
      expect(Object.keys(r.fill).every((k) => selected.has(+k))).toBe(true);
      const q = apply(full, r.fill);
      q.cells.forEach((c, i) => !selected.has(i) && expect(c.l).toBe(full.cells[i].l));
      assertValid(q, lex, selected);
    }
  }, 60_000);

  it('selection with empty cells outside keeps crossing slots viable and leaves them unfilled', async () => {
    const lex = await fixtureLexicon();
    const p = fixtureGrid('fixture-open-15x15');
    // fill just 1-Across (row 0, columns 0–3) in an otherwise empty grid
    const sel = [0, 1, 2, 3];
    const { results } = run(p, { kind: 'selection', cells: sel }, lex, opts({ maxResults: 2, wanted: 2, timeLimitMs: 5000 }));
    expect(results.length).toBeGreaterThan(0);
    expect(Object.keys(results[0].fill).map(Number).sort((a, b) => a - b)).toEqual(sel);
    const w = sel.map((i) => results[0].fill[i]).join('');
    expect(lex.info(w)).not.toBeNull();
  }, 30_000);

  it('reports a failure when a touched slot has no candidates', async () => {
    const lex = await fixtureLexicon();
    const p = fixtureGrid('fixture-mini-5x5');
    // row 1 = QQQQQ (fixed), select row 0 → every down slot starts ?Q...
    for (let c = 0; c < 5; c++) p.cells[5 + c] = { ...p.cells[5 + c], l: 'Q', src: 'typed' };
    for (let c = 0; c < 5; c++) p.cells[15 + c] = { ...p.cells[15 + c], l: 'X', src: 'typed' };
    const { results, fail } = run(p, { kind: 'selection', cells: [1, 2, 3, 4] }, lex, opts({ timeLimitMs: 3000 }));
    expect(results).toEqual([]);
    expect(fail).toBeDefined();
  }, 30_000);

  it('benchmark: a ~15-square selection returns a first result in under 2 s', async () => {
    const lex = await fixtureLexicon();
    const base = fixtureGrid('fixture-open-15x15');
    const full = apply(base, run(base, { kind: 'grid' }, lex, opts({ maxResults: 1, wanted: 1, seed: 3 })).results[0].fill);
    // 15 open squares around the upper-left corner region
    const sel: number[] = [];
    for (let r = 0; r < 15 && sel.length < 15; r++) for (let c = 0; c < 15 && sel.length < 15; c++) if (r < 4 && c < 5 && !full.cells[r * 15 + c].b) sel.push(r * 15 + c);
    expect(sel.length).toBeGreaterThanOrEqual(14);
    let first = Infinity;
    const { results } = run(full, { kind: 'selection', cells: sel }, lex, opts({ maxResults: 3, wanted: 1, timeLimitMs: 5000 }), (ms) => (first = ms));
    expect(results.length).toBe(1);
    console.log(`selection of ${sel.length} squares: first result in ${first} ms`);
    expect(first).toBeLessThan(2000);
  }, 60_000);
});
