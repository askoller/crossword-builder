// Clue history helpers (SPEC §3.5). Pure: near-duplicate matching, angle clustering,
// filters and date formatting.

/** [clue, yyyymmdd, weekday 0 = Monday] — same as the clues store. */
export type HistoryClue = [string, number, number];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STOP = new Set(
  (
    'a an the of to in on at by for from with and or but nor as is are was were be been being it its ' +
    'this that these those he she they them his her their you your we our i me my not no so if than then ' +
    'into onto out up down over off about one ones some any who whom whose what which where when how ' +
    'like eg ie etc s'
  ).split(' '),
);

export function tokens(clue: string): string[] {
  return clue
    .toLowerCase()
    .replace(/[’‘']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

export function contentWords(clue: string): string[] {
  return tokens(clue).filter((t) => t.length > 1 && !STOP.has(t));
}

export interface NearMatch {
  index: number;
  overlap: number;
  contains: boolean;
}

export const NEAR_OVERLAP = 0.6;

/**
 * Past clues close to a draft: content-word overlap |A∩B| / max(|A|,|B|) ≥ 0.6, or one
 * clue contains the other as whole words (the contained side needs at least 2 words, so a
 * one-word draft doesn't match every clue that uses the word). Best matches first.
 */
export function nearDuplicates(draft: string, history: HistoryClue[]): NearMatch[] {
  const dAll = tokens(draft);
  if (!dAll.length) return [];
  const dContent = contentWords(draft);
  const dSet = new Set(dContent.length ? dContent : dAll);
  const dStr = ` ${dAll.join(' ')} `;
  const out: NearMatch[] = [];
  history.forEach(([clue], index) => {
    const cAll = tokens(clue);
    if (!cAll.length) return;
    const cContent = contentWords(clue);
    const cSet = new Set(cContent.length ? cContent : cAll);
    let shared = 0;
    for (const t of dSet) if (cSet.has(t)) shared++;
    const overlap = shared / Math.max(dSet.size, cSet.size);
    const cStr = ` ${cAll.join(' ')} `;
    const contains = dStr === cStr || (dAll.length >= 2 && cStr.includes(dStr)) || (cAll.length >= 2 && dStr.includes(cStr));
    if (overlap >= NEAR_OVERLAP || contains) out.push({ index, overlap, contains });
  });
  return out.sort((x, y) => Number(y.contains) - Number(x.contains) || y.overlap - x.overlap || x.index - y.index);
}

export interface Angle {
  /** the shared content word, or 'other' */
  label: string;
  indices: number[];
}

/**
 * Split clues into angles by shared content words: repeatedly take the content word used
 * by the most remaining clues (at least 2) as a cluster. At most 3 clusters + "other".
 */
export function clusterAngles(history: HistoryClue[], max = 3): Angle[] {
  const words = history.map(([c]) => new Set(contentWords(c).map(stem)));
  let left = history.map((_, i) => i);
  const out: Angle[] = [];
  while (out.length < max && left.length) {
    const freq = new Map<string, number>();
    for (const i of left) for (const w of words[i]) freq.set(w, (freq.get(w) ?? 0) + 1);
    let best = '';
    let n = 1;
    for (const [w, c] of freq) if (c > n || (c === n && n > 1 && w < best)) [best, n] = [w, c];
    if (n < 2) break;
    out.push({ label: best, indices: left.filter((i) => words[i].has(best)) });
    left = left.filter((i) => !words[i].has(best));
  }
  if (left.length) out.push({ label: 'other', indices: left });
  return out;
}

/** Light plural folding so "Ages" and "age" land in the same angle. */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export type HistoryFilter = 'all' | 'since2015' | 'late';

export function filterHistory(history: HistoryClue[], f: HistoryFilter): number[] {
  const idx = history.map((_, i) => i);
  if (f === 'since2015') return idx.filter((i) => history[i][1] >= 20150101);
  if (f === 'late') return idx.filter((i) => history[i][2] >= 3 && history[i][2] <= 5);
  return idx;
}

export function weekdayName(w: number): string {
  return WEEKDAYS[w] ?? '';
}

/** 20240304 → "Mar 4, 2024" */
export function formatYmd(ymd: number): string {
  const y = Math.floor(ymd / 10000);
  const m = Math.floor(ymd / 100) % 100;
  const d = ymd % 100;
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${d}, ${y}` : String(ymd);
}

export function yearOf(ymd: number): number {
  return Math.floor(ymd / 10000);
}
