// Lexicon index (SPEC §4.1). Per length: words sorted by base value (best first, so a
// bitset scan visits the best words first), and per position × letter bitsets of word
// ids, built lazily. Pure; runs in the worker and in unit tests.
import type { LexiconChunk } from '../data/db';
import type { Day } from '../model/types';
import { andInto, count, set, words32 } from './bitset';
import { dayAdjustment } from './settings';

export const MIN_LEN = 3;
export const MAX_LEN = 21;
export const MAX_SCORE = 60;
export const NEVER_USE = 1;
export const BOOST_FACTOR = 0.3;
/** Score given to a boosted Notebook answer that isn't in the word list. */
export const NOTEBOOK_BASE_SCORE = 40;

export interface WordInput {
  word: string;
  score: number;
  nyt?: number;
  last?: number;
}

export interface NotebookAnswer {
  /** as typed, spaces allowed */
  answer: string;
  boost: number;
}

export interface LexiconOptions {
  notebook?: NotebookAnswer[];
  /** app-level bans on top of score-1 words */
  neverUse?: Iterable<string>;
}

export interface WordInfo {
  word: string;
  score: number;
  nyt: number;
  last: number;
  boost: number;
  /** min(60, score + boost × 0.3) */
  base: number;
  neverUse: boolean;
}

export const letterCode = (ch: string): number => ch.charCodeAt(0) - 64; // A = 1

export class LengthIndex {
  readonly w32: number;
  readonly base: Float32Array;
  /** ids that are not never-use */
  readonly usable: Uint32Array;
  private posSets: Uint32Array | null = null;
  private floorSets = new Map<number, Uint32Array>();
  private dayValues = new Map<Day, Float32Array>();
  private ids: Map<string, number> | null = null;

  constructor(
    readonly len: number,
    readonly words: string[],
    readonly score: Uint8Array,
    readonly nyt: Uint16Array,
    readonly last: Uint16Array,
    readonly boost: Uint8Array,
    readonly banned: Uint8Array,
  ) {
    this.w32 = words32(words.length);
    this.base = new Float32Array(words.length);
    this.usable = new Uint32Array(this.w32);
    for (let i = 0; i < words.length; i++) {
      this.base[i] = Math.min(MAX_SCORE, score[i] + boost[i] * BOOST_FACTOR);
      if (!banned[i]) set(this.usable, i);
    }
  }

  get n(): number {
    return this.words.length;
  }

  /** Bitset of words with `letter` (1–26) at position `p`. */
  pos(p: number, letter: number): Uint32Array {
    if (!this.posSets) {
      const all = new Uint32Array(this.len * 26 * this.w32);
      for (let i = 0; i < this.words.length; i++) {
        const w = this.words[i];
        const bit = 1 << (i & 31);
        const word = i >>> 5;
        for (let k = 0; k < this.len; k++) all[(k * 26 + w.charCodeAt(k) - 65) * this.w32 + word] |= bit;
      }
      this.posSets = all;
    }
    const off = (p * 26 + letter - 1) * this.w32;
    return this.posSets.subarray(off, off + this.w32);
  }

  /** Usable words with base value at or above `floor`. */
  floorSet(floor: number): Uint32Array {
    let s = this.floorSets.get(floor);
    if (!s) {
      s = new Uint32Array(this.w32);
      // ids are sorted by base value, best first
      for (let i = 0; i < this.n && this.base[i] >= floor; i++) if (!this.banned[i]) set(s, i);
      this.floorSets.set(floor, s);
    }
    return s;
  }

  /** Effective value (base + day adjustment) per id. */
  values(day: Day): Float32Array {
    let v = this.dayValues.get(day);
    if (!v) {
      v = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) v[i] = this.base[i] + dayAdjustment(day, this.len, this.nyt[i]);
      this.dayValues.set(day, v);
    }
    return v;
  }

  idOf(word: string): number {
    if (!this.ids) {
      this.ids = new Map();
      this.words.forEach((w, i) => this.ids!.set(w, i));
    }
    return this.ids.get(word) ?? -1;
  }

  /**
   * Candidate bitset for a pattern (letter codes, 0 = open) at the floor. Returns the
   * set and its size.
   */
  match(pattern: ArrayLike<number>, floor: number): { set: Uint32Array; count: number } {
    const out = this.floorSet(floor).slice();
    let n = -1;
    for (let k = 0; k < pattern.length; k++) {
      const l = pattern[k];
      if (l >= 1 && l <= 26) n = andInto(out, out, this.pos(k, l));
    }
    return { set: out, count: n < 0 ? count(out) : n };
  }
}

/** Upper-case A–Z only. */
export const lettersOnly = (s: string): string => s.toUpperCase().replace(/[^A-Z]/g, '');

export class Lexicon {
  private readonly byLen = new Map<number, LengthIndex>();
  /** Notebook answers typed with spaces: letters → their own parts */
  readonly phraseParts = new Map<string, string[]>();

  constructor(chunks: Iterable<LexiconChunk | { len: number; words: WordInput[] }>, opts: LexiconOptions = {}) {
    const boosts = new Map<string, number>();
    for (const a of opts.notebook ?? []) {
      const w = lettersOnly(a.answer);
      if (w.length < MIN_LEN || w.length > MAX_LEN) continue;
      boosts.set(w, Math.max(0, Math.min(100, Math.round(a.boost || 0))));
      const parts = a.answer.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
      if (parts.length > 1) this.phraseParts.set(w, parts);
    }
    const banned = new Set([...(opts.neverUse ?? [])].map(lettersOnly));
    const seen = new Set<string>();
    const rows = new Map<number, { word: string; score: number; nyt: number; last: number; boost: number; order: number }[]>();
    let order = 0;
    const add = (word: string, score: number, nyt: number, last: number) => {
      if (word.length < MIN_LEN || word.length > MAX_LEN || seen.has(word)) return;
      seen.add(word);
      let list = rows.get(word.length);
      if (!list) rows.set(word.length, (list = []));
      list.push({ word, score, nyt, last, boost: boosts.get(word) ?? 0, order: order++ });
    };
    for (const c of chunks) {
      if ('count' in c) {
        for (let i = 0; i < c.count; i++) add(c.words.slice(i * c.len, (i + 1) * c.len), c.score[i], c.nyt[i], c.last[i]);
      } else {
        for (const w of c.words) add(w.word, w.score, w.nyt ?? 0, w.last ?? 0);
      }
    }
    // Boosted Notebook answers are added to the list if missing (SPEC §3.7).
    for (const w of boosts.keys()) add(w, NOTEBOOK_BASE_SCORE, 0, 0);

    for (const [len, list] of rows) {
      const isBanned = (r: { word: string; score: number }) => r.score <= NEVER_USE || banned.has(r.word);
      const key = (r: (typeof list)[number]) => (isBanned(r) ? -1 : Math.min(MAX_SCORE, r.score + r.boost * BOOST_FACTOR));
      list.sort((a, b) => key(b) - key(a) || a.order - b.order);
      this.byLen.set(
        len,
        new LengthIndex(
          len,
          list.map((r) => r.word),
          Uint8Array.from(list, (r) => r.score),
          Uint16Array.from(list, (r) => r.nyt),
          Uint16Array.from(list, (r) => r.last),
          Uint8Array.from(list, (r) => r.boost),
          Uint8Array.from(list, (r) => (isBanned(r) ? 1 : 0)),
        ),
      );
    }
  }

  /** Small lexicons for tests. */
  static fromWords(words: WordInput[], opts?: LexiconOptions): Lexicon {
    return new Lexicon([{ len: 0, words }], opts);
  }

  get(len: number): LengthIndex | undefined {
    return this.byLen.get(len);
  }

  info(word: string): WordInfo | null {
    const idx = this.byLen.get(word.length);
    const i = idx ? idx.idOf(word) : -1;
    if (!idx || i < 0) return null;
    return {
      word,
      score: idx.score[i],
      nyt: idx.nyt[i],
      last: idx.last[i],
      boost: idx.boost[i],
      base: idx.base[i],
      neverUse: idx.banned[i] === 1,
    };
  }

  get size(): number {
    let n = 0;
    for (const l of this.byLen.values()) n += l.n;
    return n;
  }
}
