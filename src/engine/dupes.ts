// Andrew's duplicate rules (SPEC §4.5). Pure.
//
// 1. Shared 4-letter string: two entries may not share any 4-letter substring, except
//    where the shared string is part of a listed affix at the same end of both words:
//    the occurrence must sit at the same distance from that end in both words and
//    overlap the affix. So NATION / RATION (sharing ATIO and TION, both overlapping the
//    final TION) are fine, while SPOUSE / SPOUSES and PARTS / APART are dupes.
// 2. Word inside a phrase: an entry may not equal a component word of another entry
//    that is a multi-word phrase (ERE / ERENOW, TEA / TEAPARTY). Phrases are split by a
//    dictionary segmentation into the fewest parts (at least two), each part a lexicon
//    word of length ≥ 3 with score ≥ 25, or a common short word. Notebook answers typed
//    with spaces use their own spaces.
// 3. The same entry twice is always a dupe.
import type { Lexicon } from './lexicon';

export type DupeRule = 'same' | 'substring' | 'phrase';

export interface Dupe {
  rule: DupeRule;
  /** the shared string (rule 1) or the component word (rule 2) */
  detail: string;
}

export const SEGMENT_MIN_SCORE = 25;
export const COMMON_SHORT = new Set(
  'A I AN AT BE BY DO GO IF IN IS IT ME MY NO OF ON OR SO TO UP US WE'.split(' '),
);

export const gramCode = (w: string, i: number): number =>
  ((w.charCodeAt(i) * 32 + w.charCodeAt(i + 1)) * 32 + w.charCodeAt(i + 2)) * 32 + w.charCodeAt(i + 3);

/** Is the shared 4-letter string at a[i..i+4) / b[j..j+4) covered by an affix exception? */
export function affixExempt(a: string, i: number, b: string, j: number, affixes: readonly string[]): boolean {
  for (const x of affixes) {
    const n = x.length;
    if (!n) continue;
    // suffix: same distance from the end in both, overlapping the affix
    if (a.length - i === b.length - j && i + 4 > a.length - n && a.endsWith(x) && b.endsWith(x)) return true;
    // prefix: same position from the start, overlapping the affix
    if (i === j && i < n && a.startsWith(x) && b.startsWith(x)) return true;
  }
  return false;
}

/** Rule 1: first shared 4-letter string that isn't affix-exempt, or null. */
export function shared4(a: string, b: string, affixes: readonly string[]): string | null {
  if (a.length < 4 || b.length < 4) return null;
  for (let i = 0; i + 4 <= a.length; i++) {
    const g = a.slice(i, i + 4);
    for (let j = b.indexOf(g); j >= 0; j = b.indexOf(g, j + 1)) {
      if (!affixExempt(a, i, b, j, affixes)) return g;
    }
  }
  return null;
}

/** Splits entries into component words (rule 2), with a cache. */
export class Segmenter {
  private cache = new Map<string, string[] | null>();
  constructor(
    private readonly isPart: (w: string) => boolean,
    private readonly own: ReadonlyMap<string, string[]> = new Map(),
  ) {}

  static forLexicon(lex: Lexicon): Segmenter {
    return new Segmenter((w) => {
      if (w.length < 3) return COMMON_SHORT.has(w);
      const info = lex.info(w);
      return !!info && info.score >= SEGMENT_MIN_SCORE;
    }, lex.phraseParts);
  }

  /** Component words, or null when the entry isn't a multi-word phrase. */
  parts(word: string): string[] | null {
    const hit = this.cache.get(word);
    if (hit !== undefined) return hit;
    const own = this.own.get(word);
    const r = own ?? this.split(word);
    this.cache.set(word, r);
    return r;
  }

  private split(w: string): string[] | null {
    const n = w.length;
    if (n < 2) return null;
    // best[i] = fewest parts covering w[0..i); the whole word as one part isn't allowed
    const best = new Array<number>(n + 1).fill(Infinity);
    const from = new Array<number>(n + 1).fill(-1);
    best[0] = 0;
    for (let end = 1; end <= n; end++) {
      for (let start = 0; start < end; start++) {
        if (best[start] === Infinity || (start === 0 && end === n)) continue;
        if (best[start] + 1 >= best[end]) continue;
        if (this.isPart(w.slice(start, end))) {
          best[end] = best[start] + 1;
          from[end] = start;
        }
      }
    }
    if (best[n] === Infinity) return null;
    const parts: string[] = [];
    for (let end = n; end > 0; end = from[end]) parts.unshift(w.slice(from[end], end));
    return parts;
  }
}

export interface DupeOptions {
  affixes: readonly string[];
  segmenter: Segmenter;
}

/** The rule that makes a and b dupes, or null. Entries are letters only, upper case. */
export function dupeOf(a: string, b: string, o: DupeOptions): Dupe | null {
  if (a === b) return { rule: 'same', detail: a };
  const g = shared4(a, b, o.affixes);
  if (g) return { rule: 'substring', detail: g };
  if (o.segmenter.parts(b)?.includes(a)) return { rule: 'phrase', detail: a };
  if (o.segmenter.parts(a)?.includes(b)) return { rule: 'phrase', detail: b };
  return null;
}

export function describeDupe(a: string, b: string, d: Dupe): string {
  switch (d.rule) {
    case 'same':
      return `${a} appears twice`;
    case 'substring':
      return `${a} and ${b} share ${d.detail}`;
    case 'phrase':
      return `${d.detail} is a word in ${d.detail === a ? b : a}`;
  }
}

/**
 * Entries placed so far, indexed for fast dupe checks during search. Each entry has an
 * owner (a search variable, or -1 for fixed entries).
 */
export class DupeTracker {
  private grams = new Map<number, { word: string; pos: number; owner: number }[]>();
  private words = new Map<string, number[]>();
  /** component word → owners of the phrases containing it */
  private components = new Map<string, number[]>();

  constructor(private readonly o: DupeOptions) {}

  add(word: string, owner: number): void {
    push(this.words, word, owner);
    for (let i = 0; i + 4 <= word.length; i++) push(this.grams, gramCode(word, i), { word, pos: i, owner });
    for (const p of this.o.segmenter.parts(word) ?? []) push(this.components, p, owner);
  }

  remove(word: string, owner: number): void {
    pull(this.words, word, (x) => x === owner);
    for (let i = 0; i + 4 <= word.length; i++) pull(this.grams, gramCode(word, i), (x) => x.owner === owner && x.word === word);
    for (const p of this.o.segmenter.parts(word) ?? []) pull(this.components, p, (x) => x === owner);
  }

  /**
   * First conflict for a candidate: the owner it clashes with (-1 = a fixed entry) plus
   * the rule, or null when it's clean.
   */
  conflict(word: string): { owner: number; with: string; dupe: Dupe } | null {
    const same = this.words.get(word);
    if (same?.length) return { owner: same[0], with: word, dupe: { rule: 'same', detail: word } };
    for (let i = 0; i + 4 <= word.length; i++) {
      const list = this.grams.get(gramCode(word, i));
      if (!list) continue;
      for (const e of list) {
        if (!affixExempt(word, i, e.word, e.pos, this.o.affixes)) {
          return { owner: e.owner, with: e.word, dupe: { rule: 'substring', detail: word.slice(i, i + 4) } };
        }
      }
    }
    const asPart = this.components.get(word);
    if (asPart?.length) {
      const owner = asPart[0];
      return { owner, with: this.wordOf(owner, word) ?? word, dupe: { rule: 'phrase', detail: word } };
    }
    for (const p of this.o.segmenter.parts(word) ?? []) {
      const w = this.words.get(p);
      if (w?.length) return { owner: w[0], with: p, dupe: { rule: 'phrase', detail: p } };
    }
    return null;
  }

  private wordOf(owner: number, part: string): string | null {
    for (const [w, owners] of this.words) {
      if (owners.includes(owner) && this.o.segmenter.parts(w)?.includes(part)) return w;
    }
    return null;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

function pull<K, V>(m: Map<K, V[]>, k: K, match: (v: V) => boolean): void {
  const l = m.get(k);
  if (!l) return;
  const i = l.findIndex(match);
  if (i >= 0) l.splice(i, 1);
  if (!l.length) m.delete(k);
}
