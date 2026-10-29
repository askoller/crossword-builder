// Fill search (SPEC §4.4): MRV variable choice, values ordered by value plus crossing
// room with the top K forward-checked, conflict-directed backjumping. In 'best' mode it
// is a branch-and-bound over total value (chronological backtracking), used by the
// improve phase. Pure; runs in the worker and in unit tests.
import type { Day } from '../model/types';
import { andCount, andInto, nextSet } from './bitset';
import { crosserAt, EMPTY, letterOf, type Problem } from './board';
import { DupeTracker, type DupeOptions } from './dupes';
import type { LengthIndex, Lexicon } from './lexicon';
import { DAY_ADJ_MAX, floorFor } from './settings';

export interface SearchOptions {
  lex: Lexicon;
  day: Day;
  floor: number | number[];
  /** viability slots must keep at least this many candidates */
  keepOpen: number;
  dupes: DupeOptions;
  mode: 'first' | 'best';
  /** best mode: total (Σ length × value over vars) to beat */
  incumbent?: number;
  /** stop after this many candidate checks */
  nodeLimit: number;
  /** ordering noise in value points (0 = deterministic) */
  noise?: number;
  seed?: number;
  /** ordering-only penalties per word (used to find distinct fills) */
  penalty?: ReadonlyMap<string, number>;
  /** how many top candidates get a full forward check for ordering */
  topK?: number;
  /** words not allowed in a given slot (slot index → words), to force a different fill */
  bans?: ReadonlyMap<number, ReadonlySet<string>>;
}

export type SearchStatus = 'running' | 'solved' | 'exhausted' | 'limit';

export interface Solution {
  /** letter codes for every cell */
  cells: Uint8Array;
  /** word per var, aligned with problem.vars */
  words: string[];
  total: number;
}

interface Cross {
  /** crossing slot index */
  slot: number;
  /** position of the shared cell in the crossing slot */
  at: number;
  /** position of the shared cell in this slot */
  self: number;
  cell: number;
}

interface Frame {
  v: number;
  dom: Uint32Array;
  top: number[];
  topPtr: number;
  /** next id to scan after the top K */
  scan: number;
  conf: Set<number>;
  memo: Map<number, number>;
  /** current value, -1 = none */
  id: number;
  changed: number[];
  trailMark: number;
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Search {
  status: SearchStatus = 'running';
  best: Solution | null = null;
  nodes = 0;
  /** slot index that had no candidates at the start (with no fill possible), or -1 */
  deadSlot = -1;

  private readonly cells: Uint8Array;
  private readonly li: (LengthIndex | undefined)[];
  private readonly values: (Float32Array | undefined)[];
  private readonly dom: (Uint32Array | null)[];
  private readonly cnt: Int32Array;
  private readonly varOf: Int32Array;
  private readonly cross: Cross[][];
  private readonly assigned: Int32Array;
  private readonly depthOf: Int32Array;
  private readonly frames: Frame[] = [];
  private readonly trail: [number, Uint32Array, number][] = [];
  private readonly tracker: DupeTracker;
  private readonly rand: () => number;
  private readonly topK: number;
  private total = 0;
  private incumbent: number;
  private unassigned: number;

  constructor(
    private readonly prob: Problem,
    private readonly o: SearchOptions,
  ) {
    const { board, kinds, vars } = prob;
    const slots = board.index.slots;
    this.cells = prob.cells.slice();
    this.rand = rng(o.seed ?? 1);
    this.topK = o.topK ?? 12;
    this.incumbent = o.incumbent ?? -Infinity;
    this.li = slots.map((s) => o.lex.get(s.cells.length));
    this.values = this.li.map((l) => l?.values(o.day));
    this.dom = slots.map(() => null);
    this.cnt = new Int32Array(slots.length);
    this.varOf = new Int32Array(slots.length).fill(-1);
    vars.forEach((k, v) => (this.varOf[k] = v));
    this.assigned = new Int32Array(vars.length).fill(-1);
    this.depthOf = new Int32Array(vars.length).fill(-1);
    this.unassigned = vars.length;
    this.cross = slots.map((s) =>
      s.cells.flatMap((cell, self) => {
        const c = crosserAt(board.index, s, cell);
        return c >= 0 ? [{ slot: c, at: slots[c].cells.indexOf(cell), self, cell }] : [];
      }),
    );

    // initial domains for vars and viability slots
    slots.forEach((s, k) => {
      if (kinds[k] !== 'var' && kinds[k] !== 'viability') return;
      const li = this.li[k];
      if (!li) {
        this.dom[k] = new Uint32Array(0);
        this.cnt[k] = 0;
      } else {
        const pattern = s.cells.map((i) => this.cells[i]);
        const m = li.match(pattern, floorFor(o.floor, s.cells.length));
        this.dom[k] = m.set;
        this.cnt[k] = m.count;
      }
      const need = kinds[k] === 'var' ? 1 : Math.max(1, o.keepOpen);
      if (this.cnt[k] < need && this.deadSlot < 0) this.deadSlot = k;
    });

    this.tracker = new DupeTracker(o.dupes);
    slots.forEach((s, k) => {
      if (kinds[k] !== 'fixed') return;
      let w = '';
      for (const i of s.cells) w += letterOf(this.cells[i]);
      this.tracker.add(w, -1);
    });

    if (this.deadSlot >= 0) this.status = 'exhausted';
    else if (!vars.length) this.finish();
    else this.pushFrame();
  }

  /** Run up to `budget` candidate checks. */
  run(budget: number): SearchStatus {
    const stopAt = this.nodes + budget;
    while (this.status === 'running') {
      if (this.nodes >= this.o.nodeLimit) {
        this.status = 'limit';
        break;
      }
      if (this.nodes >= stopAt) break;
      this.step();
    }
    return this.status;
  }

  private step(): void {
    const f = this.frames[this.frames.length - 1];
    if (f.id >= 0) this.unassign(f);
    const id = this.nextCandidate(f);
    if (id < 0) {
      this.backtrack(f);
      return;
    }
    this.assign(f, id);
    if (this.o.mode === 'best' && this.bound() <= this.incumbent + 1e-6) return; // try the next value
    if (this.unassigned === 0) {
      this.finish();
      return;
    }
    this.pushFrame();
  }

  private finish(): void {
    const words = this.prob.vars.map((k) => {
      const v = this.varOf[k];
      return this.li[k]!.words[this.assigned[v]];
    });
    const sol = { cells: this.cells.slice(), words, total: this.total };
    if (this.o.mode === 'first') {
      this.best = sol;
      this.status = 'solved';
      return;
    }
    if (sol.total > this.incumbent) {
      this.best = sol;
      this.incumbent = sol.total;
    }
    if (!this.frames.length) this.status = 'exhausted';
    // otherwise the next step tries the next value of the deepest frame
  }

  private pushFrame(): void {
    const vars = this.prob.vars;
    let bestV = -1;
    let bestCnt = Infinity;
    let bestLen = 0;
    for (let v = 0; v < vars.length; v++) {
      if (this.assigned[v] >= 0 || this.depthOf[v] >= 0) continue;
      const k = vars[v];
      const c = this.cnt[k];
      const len = this.prob.board.index.slots[k].cells.length;
      if (c < bestCnt || (c === bestCnt && len > bestLen)) {
        bestV = v;
        bestCnt = c;
        bestLen = len;
      }
    }
    const k = vars[bestV];
    const f: Frame = {
      v: bestV,
      dom: this.dom[k]!,
      top: [],
      topPtr: 0,
      scan: 0,
      conf: new Set(),
      memo: new Map(),
      id: -1,
      changed: [],
      trailMark: 0,
    };
    this.depthOf[bestV] = this.frames.length;
    this.frames.push(f);
    this.fillTop(f);
  }

  /** Forward-check the first K candidates and order them by value plus crossing room. */
  private fillTop(f: Frame): void {
    const k = this.prob.vars[f.v];
    const values = this.values[k]!;
    const scored: [number, number][] = [];
    let id = nextSet(f.dom, 0);
    while (id >= 0 && scored.length < this.topK) {
      const room = this.check(f, id);
      if (room >= 0) {
        const word = this.li[k]!.words[id];
        const pen = this.o.penalty?.get(word) ?? 0;
        const noise = this.o.noise ? this.o.noise * this.rand() : 0;
        scored.push([id, values[id] - pen + noise + 1.5 * Math.log2(1 + Math.min(room, 1000))]);
      }
      id = nextSet(f.dom, id + 1);
    }
    scored.sort((a, b) => b[1] - a[1]);
    f.top = scored.map((s) => s[0]);
    f.scan = id < 0 ? Infinity : id;
  }

  private nextCandidate(f: Frame): number {
    if (f.topPtr < f.top.length) return f.top[f.topPtr++];
    while (f.scan !== Infinity) {
      const id = nextSet(f.dom, f.scan);
      if (id < 0) {
        f.scan = Infinity;
        break;
      }
      f.scan = id + 1;
      if (this.check(f, id) >= 0) return id;
    }
    return -1;
  }

  /**
   * Can candidate `id` go into the frame's var? Returns its crossing room (min candidates
   * left in an open crossing slot; Infinity when none), or -1 when rejected, adding the
   * culprits to the frame's conflict set.
   */
  private check(f: Frame, id: number): number {
    this.nodes++;
    const k = this.prob.vars[f.v];
    const word = this.li[k]!.words[id];
    if (this.o.bans?.get(k)?.has(word)) return -1;
    const dup = this.tracker.conflict(word);
    if (dup) {
      if (dup.owner >= 0) f.conf.add(dup.owner);
      return -1;
    }
    let room = Infinity;
    for (const x of this.cross[k]) {
      if (this.cells[x.cell] !== EMPTY) continue;
      const kind = this.prob.kinds[x.slot];
      if (kind !== 'var' && kind !== 'viability') continue;
      const letter = word.charCodeAt(x.self) - 64;
      const key = x.slot * 27 + letter;
      let n = f.memo.get(key);
      if (n === undefined) {
        n = andCount(this.dom[x.slot]!, this.li[x.slot]!.pos(x.at, letter));
        f.memo.set(key, n);
      }
      const need = kind === 'var' ? 1 : Math.max(1, this.o.keepOpen);
      if (n < need) {
        this.addPast(f.conf, x.slot, f.v);
        return -1;
      }
      if (n < room) room = n;
    }
    return room;
  }

  /** Assigned vars that cross `slot` (they set its letters). */
  private addPast(into: Set<number>, slot: number, except: number): void {
    for (const x of this.cross[slot]) {
      const v = this.varOf[x.slot];
      if (v >= 0 && v !== except && this.assigned[v] >= 0) into.add(v);
    }
  }

  private assign(f: Frame, id: number): void {
    const k = this.prob.vars[f.v];
    const slot = this.prob.board.index.slots[k];
    const word = this.li[k]!.words[id];
    f.id = id;
    f.changed = [];
    f.trailMark = this.trail.length;
    slot.cells.forEach((cell, p) => {
      if (this.cells[cell] === EMPTY) {
        this.cells[cell] = word.charCodeAt(p) - 64;
        f.changed.push(cell);
      }
    });
    for (const x of this.cross[k]) {
      if (!f.changed.includes(x.cell)) continue;
      const kind = this.prob.kinds[x.slot];
      if (kind !== 'var' && kind !== 'viability') continue;
      const old = this.dom[x.slot]!;
      const nd = new Uint32Array(old.length);
      const n = andInto(nd, old, this.li[x.slot]!.pos(x.at, this.cells[x.cell]));
      this.trail.push([x.slot, old, this.cnt[x.slot]]);
      this.dom[x.slot] = nd;
      this.cnt[x.slot] = n;
    }
    this.tracker.add(word, f.v);
    this.assigned[f.v] = id;
    this.unassigned--;
    this.total += slot.cells.length * this.values[k]![id];
  }

  private unassign(f: Frame): void {
    const k = this.prob.vars[f.v];
    const slot = this.prob.board.index.slots[k];
    const word = this.li[k]!.words[f.id];
    for (const cell of f.changed) this.cells[cell] = EMPTY;
    while (this.trail.length > f.trailMark) {
      const [s, d, c] = this.trail.pop()!;
      this.dom[s] = d;
      this.cnt[s] = c;
    }
    this.tracker.remove(word, f.v);
    this.total -= slot.cells.length * this.values[k]![f.id];
    this.assigned[f.v] = -1;
    this.unassigned++;
    f.id = -1;
    f.changed = [];
  }

  /** Optimistic total: assigned values plus the best possible value of each open var. */
  private bound(): number {
    let b = this.total;
    const vars = this.prob.vars;
    for (let v = 0; v < vars.length; v++) {
      if (this.assigned[v] >= 0) continue;
      const k = vars[v];
      const first = nextSet(this.dom[k]!, 0);
      if (first < 0) return -Infinity;
      b += this.prob.board.index.slots[k].cells.length * (this.li[k]!.base[first] + DAY_ADJ_MAX);
    }
    return b;
  }

  private backtrack(f: Frame): void {
    this.frames.pop();
    this.depthOf[f.v] = -1;
    if (this.o.mode === 'best') {
      if (!this.frames.length) this.status = 'exhausted';
      return;
    }
    // conflict-directed backjump
    const j = new Set(f.conf);
    this.addPast(j, this.prob.vars[f.v], f.v);
    let h = -1;
    for (const v of j) if (this.depthOf[v] > h) h = this.depthOf[v];
    if (h < 0) {
      this.status = 'exhausted';
      return;
    }
    while (this.frames.length - 1 > h) {
      const g = this.frames.pop()!;
      if (g.id >= 0) this.unassign(g);
      this.depthOf[g.v] = -1;
    }
    const target = this.frames[h];
    for (const v of j) if (v !== target.v) target.conf.add(v);
    // the next step unassigns target and tries its next value
  }
}
