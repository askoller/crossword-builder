// Autofill driver (SPEC §4.4): restarts of the backjumping search with growing noise,
// an improve phase (large-neighbourhood search with branch-and-bound refills), and a
// list of distinct fills, best first. A generator so the worker can interleave messages
// (stop) between slices. Pure.
import type { Day, Puzzle } from '../model/types';
import { boardOf, crosserAt, letterOf, makeProblem, scopeMask, slotWord, type Board, type Problem } from './board';
import { Segmenter, type DupeOptions } from './dupes';
import type { Lexicon } from './lexicon';
import type { AutofillScope, FillStats } from './protocol';
import { rng, Search, type Solution } from './search';
import { floorFor } from './settings';

export interface AutofillOptions {
  day: Day;
  floor: number | number[];
  keepOpen: number;
  affixes: readonly string[];
  maxResults: number;
  /** total search time */
  timeLimitMs: number;
  /** stop after this many distinct fills (default 2 × maxResults) */
  wanted?: number;
  seed?: number;
  /** time spent improving each fill */
  improveMs?: number;
  now?: () => number;
}

export interface FillResult {
  /** cell index → letter for the open cells */
  fill: Record<number, string>;
  stats: FillStats;
  /** Σ length × value over the open slots */
  total: number;
}

export type AutofillEvent =
  | { type: 'result'; result: FillResult; index: number; replaces: boolean }
  | { type: 'tick'; elapsed: number; attempts: number }
  | { type: 'fail'; reason: string };

/** Distinct when they differ in at least 15% of open cells. */
export const DISTINCT_FRACTION = 0.15;

export function fillStats(prob: Problem, cells: Uint8Array, lex: Lexicon, day: Day, floor: number | number[]): { stats: FillStats; total: number } {
  const slots = prob.board.index.slots;
  let total = 0;
  let len = 0;
  let weakest: FillStats['weakest'] = null;
  for (const k of prob.vars) {
    const s = slots[k];
    const w = slotWord(cells, s);
    if (!w) continue;
    const li = lex.get(w.length);
    const id = li ? li.idOf(w) : -1;
    const value = id >= 0 ? li!.values(day)[id] : 0;
    total += w.length * value;
    len += w.length;
    if (!weakest || value < weakest.value) weakest = { slot: s.id, word: w, value: Math.round(value * 10) / 10 };
  }
  let underFloor = 0;
  for (const s of slots) {
    const w = slotWord(cells, s);
    if (!w) continue;
    const info = lex.info(w);
    if (!info || info.base < floorFor(floor, w.length)) underFloor++;
  }
  return { stats: { average: len ? Math.round((total / len) * 10) / 10 : 0, weakest, underFloor }, total };
}

function toFill(prob: Problem, cells: Uint8Array): Record<number, string> {
  const fill: Record<number, string> = {};
  for (let i = 0; i < cells.length; i++) if (prob.open[i] && cells[i] >= 1 && cells[i] <= 26) fill[i] = letterOf(cells[i]);
  return fill;
}

function slotWordFromFill(prob: Problem, k: number, fill: Record<number, string>): string | null {
  let w = '';
  for (const i of prob.board.index.slots[k].cells) {
    const l = fill[i] ?? (prob.cells[i] >= 1 && prob.cells[i] <= 26 ? letterOf(prob.cells[i]) : '');
    if (!l) return null;
    w += l;
  }
  return w;
}

function hamming(a: Record<number, string>, b: Record<number, string>): number {
  let d = 0;
  for (const k in a) if (a[k] !== b[k]) d++;
  return d;
}

/**
 * Improve a full solution: repeatedly clear a compact region around a weak entry and
 * refill it by branch-and-bound, keeping refills that raise the total.
 */
function* improve(
  prob: Problem,
  sol: Solution,
  lex: Lexicon,
  o: AutofillOptions,
  dupes: DupeOptions,
  until: number,
  now: () => number,
  tick: () => AutofillEvent,
  bans?: ReadonlyMap<number, ReadonlySet<string>>,
): Generator<AutofillEvent, Solution> {
  const slots = prob.board.index.slots;
  const rand = rng((o.seed ?? 7) * 31 + 1);
  let cur = sol;
  let stale = 0;
  while (now() < until && stale < 24) {
    // rank var slots by value, pick one of the weakest few
    const ranked = prob.vars
      .map((k) => {
        const w = slotWord(cur.cells, slots[k])!;
        const li = lex.get(w.length)!;
        return { k, v: li.values(o.day)[li.idOf(w)] ?? 0 };
      })
      .sort((a, b) => a.v - b.v);
    const pick = ranked[Math.floor(rand() * Math.min(4, ranked.length))];
    if (!pick) break;
    // region: the weak slot plus up to 2 cells either side along each crossing slot
    const region = new Uint8Array(prob.cells.length);
    const s = slots[pick.k];
    for (const cell of s.cells) {
      region[cell] = 1;
      const c = crosserAt(prob.board.index, s, cell);
      if (c < 0) continue;
      const cs = slots[c].cells;
      const at = cs.indexOf(cell);
      for (let d = -2; d <= 2; d++) {
        const j = cs[at + d];
        if (j !== undefined) region[j] = 1;
      }
    }
    for (let i = 0; i < region.length; i++) if (!prob.open[i]) region[i] = 0;
    const board: Board = { ...prob.board, cells: cur.cells };
    const sub = makeProblem(board, region);
    // the current total of the sub-problem's vars is the incumbent to beat
    let incumbent = 0;
    for (const k of sub.vars) {
      const w = slotWord(cur.cells, slots[k])!;
      const li = lex.get(w.length)!;
      incumbent += w.length * li.values(o.day)[li.idOf(w)];
    }
    const search = new Search(sub, {
      lex,
      day: o.day,
      floor: o.floor,
      keepOpen: o.keepOpen,
      dupes,
      mode: 'best',
      incumbent,
      nodeLimit: 4000,
      seed: Math.floor(rand() * 1e9),
      bans,
    });
    while (search.run(500) === 'running') yield tick();
    if (search.best && search.best.total > incumbent + 1e-6) {
      const cells = search.best.cells;
      const words = prob.vars.map((k) => slotWord(cells, slots[k])!);
      cur = { cells, words, total: cur.total - incumbent + search.best.total };
      stale = 0;
    } else stale++;
    yield tick();
  }
  return cur;
}

export function* autofill(puzzle: Pick<Puzzle, 'width' | 'height' | 'cells'>, scope: AutofillScope, lex: Lexicon, o: AutofillOptions): Generator<AutofillEvent, void> {
  const now = o.now ?? Date.now;
  const start = now();
  const deadline = start + o.timeLimitMs;
  const board = boardOf(puzzle);
  const prob = makeProblem(board, scopeMask(board, scope));
  if (!prob.vars.length) {
    yield { type: 'fail', reason: prob.openCount ? 'No complete entries to fill in this scope.' : 'Nothing to fill: select some empty squares.' };
    return;
  }
  const dupes: DupeOptions = { affixes: o.affixes, segmenter: Segmenter.forLexicon(lex) };
  const minDist = Math.max(1, Math.ceil(prob.openCount * DISTINCT_FRACTION));
  const wanted = o.wanted ?? o.maxResults * 2;
  const kept: FillResult[] = [];
  const penalty = new Map<string, number>();
  const rand = rng((o.seed ?? 1) * 7919);
  let attempts = 0;
  let failures = 0;
  /** attempts since the last new or better fill */
  let idle = 0;
  let nodeLimit = 20000;

  while (now() < deadline && kept.length < wanted && idle < 60) {
    attempts++;
    idle++;
    // After the first fill, ban the words of a few slots of a kept fill (in those slots
    // only) so the next search has to go somewhere else.
    let bans: Map<number, Set<string>> | undefined;
    if (kept.length) {
      bans = new Map();
      const from = kept[Math.floor(rand() * kept.length)];
      const n = 1 + (attempts % 3);
      for (let t = 0; t < n; t++) {
        const k = prob.vars[Math.floor(rand() * prob.vars.length)];
        const w = slotWordFromFill(prob, k, from.fill);
        if (!w) continue;
        if (!bans.has(k)) bans.set(k, new Set());
        bans.get(k)!.add(w);
      }
    }
    const search = new Search(prob, {
      lex,
      day: o.day,
      floor: o.floor,
      keepOpen: o.keepOpen,
      dupes,
      mode: 'first',
      nodeLimit,
      noise: attempts === 1 ? 0 : Math.min(12, 2 + attempts),
      seed: (o.seed ?? 1) * 1000 + attempts,
      penalty,
      bans,
    });
    if (search.deadSlot >= 0) {
      const s = board.index.slots[search.deadSlot];
      yield { type: 'fail', reason: `${s.id} has no ${prob.kinds[search.deadSlot] === 'var' ? 'words' : `room (fewer than ${o.keepOpen} words)`} that fit.` };
      return;
    }
    while (search.run(400) === 'running') {
      if (now() >= deadline) return;
      yield { type: 'tick', elapsed: now() - start, attempts };
    }
    if (search.status === 'exhausted') {
      if (bans) continue; // the bans ruled everything out; try other bans
      yield { type: 'fail', reason: 'No fill exists for this scope with the current floor.' };
      return;
    }
    if (search.status === 'limit' || !search.best) {
      nodeLimit = Math.min(400000, nodeLimit * 2);
      if (++failures > 6 && !kept.length && now() - start > o.timeLimitMs / 2) {
        yield { type: 'fail', reason: 'No fill found yet. Try a lower floor or a smaller selection.' };
        return;
      }
      continue;
    }
    const improveUntil = Math.min(deadline, now() + (o.improveMs ?? 600));
    const tick = (): AutofillEvent => ({ type: 'tick', elapsed: now() - start, attempts });
    const sol = yield* improve(prob, search.best, lex, o, dupes, improveUntil, now, tick, bans);
    for (const w of sol.words) penalty.set(w, (penalty.get(w) ?? 0) + 6);
    const { stats, total } = fillStats(prob, sol.cells, lex, o.day, o.floor);
    const result: FillResult = { fill: toFill(prob, sol.cells), stats, total };
    const near = kept.findIndex((k) => hamming(k.fill, result.fill) < minDist);
    if (near >= 0) {
      if (kept[near].total < result.total) {
        kept[near] = result;
        idle = 0;
        yield { type: 'result', result, index: near, replaces: true };
      }
      continue;
    }
    kept.push(result);
    idle = 0;
    yield { type: 'result', result, index: kept.length - 1, replaces: false };
  }
}
