// Check (SPEC §4.6): dupes, viability, grid stats, entry quality. Pure.
import { isSymmetric } from '../model/grid';
import type { Puzzle, Symmetry } from '../model/types';
import { BLOCK, boardOf, EMPTY, hasOther, slotWord } from './board';
import { describeDupe, dupeOf, Segmenter, type DupeRule } from './dupes';
import type { Lexicon } from './lexicon';
import { floorFor } from './settings';

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  kind: 'dupe' | 'viability' | 'grid' | 'floor' | 'never' | 'old' | 'debut' | 'unknown';
  text: string;
  /** slot ids involved */
  slots: string[];
  /** remaining words for low-viability slots */
  words?: string[];
  rule?: DupeRule;
}

export interface GridStats {
  words: number;
  blocks: number;
  /** open squares in only one entry */
  unchecked: number;
  twoLetter: number;
  symmetric: boolean;
  connected: boolean;
  longest: number;
  shortest: number;
  openSquares: number;
  filledSquares: number;
}

export interface CheckReport {
  issues: Issue[];
  stats: GridStats;
  /** errors + warnings, for the tool badge */
  count: number;
}

export interface CheckOptions {
  floor: number | number[];
  affixes: readonly string[];
  symmetry: Symmetry;
}

const OLD_YEAR = 2005;

export function gridStats(p: Pick<Puzzle, 'width' | 'height' | 'cells'>, symmetry: Symmetry): GridStats {
  const b = boardOf(p);
  const { slots, across, down } = b.index;
  let blocks = 0;
  let unchecked = 0;
  let open = 0;
  let filled = 0;
  for (let i = 0; i < b.cells.length; i++) {
    if (b.cells[i] === BLOCK) {
      blocks++;
      continue;
    }
    open++;
    if (b.cells[i] !== EMPTY) filled++;
    if (across[i] < 0 || down[i] < 0) unchecked++;
  }
  // connectivity of open squares
  let connected = true;
  const first = b.cells.findIndex((c) => c !== BLOCK);
  if (first >= 0) {
    const seen = new Uint8Array(b.cells.length);
    const stack = [first];
    seen[first] = 1;
    let reached = 0;
    while (stack.length) {
      const i = stack.pop()!;
      reached++;
      const r = Math.floor(i / b.width);
      const c = i % b.width;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= b.height || cc >= b.width) continue;
        const j = rr * b.width + cc;
        if (!seen[j] && b.cells[j] !== BLOCK) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    connected = reached === open;
  }
  const lens = slots.map((s) => s.cells.length);
  return {
    words: slots.length,
    blocks,
    unchecked,
    twoLetter: lens.filter((l) => l === 2).length,
    symmetric: isSymmetric(p, symmetry === 'none' ? 'rotational' : symmetry),
    connected,
    longest: lens.length ? Math.max(...lens) : 0,
    shortest: lens.length ? Math.min(...lens) : 0,
    openSquares: open,
    filledSquares: filled,
  };
}

export function checkPuzzle(p: Pick<Puzzle, 'width' | 'height' | 'cells'>, lex: Lexicon, o: CheckOptions): CheckReport {
  const b = boardOf(p);
  const slots = b.index.slots;
  const issues: Issue[] = [];
  const seg = Segmenter.forLexicon(lex);

  // entries
  const entries: { id: string; word: string }[] = [];
  for (const s of slots) {
    const w = slotWord(b.cells, s);
    if (w && w.length >= 3) entries.push({ id: s.id, word: w });
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const c = entries[j];
      const d = dupeOf(a.word, c.word, { affixes: o.affixes, segmenter: seg });
      if (d) {
        issues.push({
          level: 'error',
          kind: 'dupe',
          rule: d.rule,
          slots: [a.id, c.id],
          text: `${a.id} / ${c.id}: ${describeDupe(a.word, c.word, d)} (${d.rule === 'same' ? 'same entry' : d.rule === 'substring' ? 'shared 4-letter string' : 'word inside a phrase'})`,
        });
      }
    }
  }

  // viability of open slots
  for (const s of slots) {
    const pattern = s.cells.map((i) => b.cells[i]);
    if (!pattern.includes(EMPTY) || hasOther(b.cells, s) || s.cells.length < 3) continue;
    const li = lex.get(s.cells.length);
    const m = li?.match(pattern, floorFor(o.floor, s.cells.length));
    const n = m?.count ?? 0;
    if (n >= 3) continue;
    const words: string[] = [];
    if (li && m) for (let id = 0; id < li.n && words.length < n; id++) if (m.set[id >>> 5] & (1 << (id & 31))) words.push(li.words[id]);
    issues.push({
      level: n === 0 ? 'error' : 'warning',
      kind: 'viability',
      slots: [s.id],
      words,
      text: n === 0 ? `${s.id} has no words that fit` : `${s.id} has only ${n} word${n === 1 ? '' : 's'} left: ${words.join(', ')}`,
    });
  }

  // entry quality
  for (const e of entries) {
    const info = lex.info(e.word);
    if (!info) {
      issues.push({ level: 'warning', kind: 'unknown', slots: [e.id], text: `${e.id} ${e.word} is not in your word list` });
      continue;
    }
    if (info.neverUse) issues.push({ level: 'error', kind: 'never', slots: [e.id], text: `${e.id} ${e.word} is on the never-use list` });
    else if (info.base < floorFor(o.floor, e.word.length)) {
      issues.push({ level: 'warning', kind: 'floor', slots: [e.id], text: `${e.id} ${e.word} scores ${Math.round(info.base)}, under the floor` });
    }
    if (info.nyt === 0) issues.push({ level: 'info', kind: 'debut', slots: [e.id], text: `${e.id} ${e.word} would be a debut` });
    else if (info.last > 0 && info.last < OLD_YEAR) {
      issues.push({ level: 'info', kind: 'old', slots: [e.id], text: `${e.id} ${e.word} last used in ${info.last}` });
    }
  }

  // grid
  const stats = gridStats(p, o.symmetry);
  if (stats.twoLetter) issues.push({ level: 'error', kind: 'grid', slots: slots.filter((s) => s.cells.length === 2).map((s) => s.id), text: `${stats.twoLetter} two-letter entr${stats.twoLetter === 1 ? 'y' : 'ies'}` });
  if (stats.unchecked) issues.push({ level: 'warning', kind: 'grid', slots: [], text: `${stats.unchecked} unchecked square${stats.unchecked === 1 ? '' : 's'}` });
  if (!stats.connected) issues.push({ level: 'error', kind: 'grid', slots: [], text: 'The grid is split into separate parts' });
  if (o.symmetry !== 'none' && !stats.symmetric) issues.push({ level: 'warning', kind: 'grid', slots: [], text: `Blocks are not ${o.symmetry} symmetric` });

  const order: Record<IssueLevel, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((x, y) => order[x.level] - order[y.level]);
  return { issues, stats, count: issues.filter((i) => i.level !== 'info').length };
}
