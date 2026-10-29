// Fill suggestions for one slot (SPEC §4.3, §3.4): words matching the slot's letters,
// with crossing room per candidate and dupe flags against the rest of the grid. Pure.
import type { Day } from '../model/types';
import { andCount, nextSet } from './bitset';
import { crosserAt, EMPTY, hasOther, slotWord, type Board } from './board';
import { describeDupe, DupeTracker, Segmenter } from './dupes';
import type { Lexicon } from './lexicon';
import { floorFor } from './settings';

export interface Candidate {
  word: string;
  score: number;
  /** effective value for the day */
  value: number;
  boost: number;
  nyt: number;
  last: number;
  /** min candidates left in any open crossing slot (at or above the floor); null = no open crossers */
  room: number | null;
  /** slot id of the crosser with the least room */
  tightest: string | null;
  /** why it's a dupe, or null */
  dupe: string | null;
}

export interface CandidateList {
  slot: string;
  pattern: string;
  /** usable words of this length matching the letters, any score */
  inList: number;
  /** of those, at or above the floor */
  atFloor: number;
  candidates: Candidate[];
}

export interface CandidateOptions {
  day: Day;
  floor: number;
  affixes: readonly string[];
  /** cap on returned candidates (best by value) */
  limit?: number;
}

export function candidatesFor(board: Board, slotId: string, lex: Lexicon, o: CandidateOptions): CandidateList | null {
  const slots = board.index.slots;
  const k = slots.findIndex((s) => s.id === slotId);
  if (k < 0) return null;
  const slot = slots[k];
  const len = slot.cells.length;
  const pattern = slot.cells.map((i) => board.cells[i]);
  const patternText = pattern.map((c) => (c >= 1 && c <= 26 ? String.fromCharCode(64 + c) : c === EMPTY ? '?' : '*')).join('');
  const li = lex.get(len);
  const empty: CandidateList = { slot: slotId, pattern: patternText, inList: 0, atFloor: 0, candidates: [] };
  if (!li || hasOther(board.cells, slot)) return empty;

  const all = li.match(pattern, -Infinity);
  const m = li.match(pattern, o.floor);

  // crossing slots through this slot's empty cells: count per letter, computed lazily
  const crossers = slot.cells.flatMap((cell, self) => {
    if (board.cells[cell] !== EMPTY) return [];
    const c = crosserAt(board.index, slot, cell);
    if (c < 0) return [];
    const cs = slots[c];
    const cli = lex.get(cs.cells.length);
    if (!cli || hasOther(board.cells, cs)) return [];
    const base = cli.match(cs.cells.map((i) => board.cells[i]), floorFor(o.floor, cs.cells.length));
    const at = cs.cells.indexOf(cell);
    const counts = new Int32Array(27).fill(-1);
    return [{ id: cs.id, self, count: (l: number) => (counts[l] >= 0 ? counts[l] : (counts[l] = andCount(base.set, cli.pos(at, l)))) }];
  });

  // other complete entries, for dupe flags
  const tracker = new DupeTracker({ affixes: o.affixes, segmenter: Segmenter.forLexicon(lex) });
  slots.forEach((s, j) => {
    if (j === k) return;
    const w = slotWord(board.cells, s);
    if (w && w.length >= 3) tracker.add(w, j);
  });

  const values = li.values(o.day);
  const out: Candidate[] = [];
  const limit = o.limit ?? 300;
  for (let id = nextSet(m.set, 0); id >= 0 && out.length < limit; id = nextSet(m.set, id + 1)) {
    const word = li.words[id];
    let room: number | null = null;
    let tightest: string | null = null;
    for (const x of crossers) {
      const n = x.count(word.charCodeAt(x.self) - 64);
      if (room === null || n < room) {
        room = n;
        tightest = x.id;
      }
    }
    const d = tracker.conflict(word);
    out.push({
      word,
      score: li.score[id],
      value: Math.round(values[id] * 10) / 10,
      boost: li.boost[id],
      nyt: li.nyt[id],
      last: li.last[id],
      room,
      tightest,
      dupe: d ? describeDupe(word, d.with, d.dupe) : null,
    });
  }
  out.sort((a, b) => b.value - a.value);
  return { slot: slotId, pattern: patternText, inList: all.count, atFloor: m.count, candidates: out };
}
