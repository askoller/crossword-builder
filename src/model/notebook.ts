// Notebook model (SPEC §3.7, §5.4). Pure: no DOM, no IndexedDB. The same shape as
// ThemeFill's notebook.json, so the merge below works for Drive sync as well.

export interface NotebookAnswer {
  /** as typed, spaces allowed ("TEA PARTY") */
  answer: string;
  clues: string[];
  /** 1–100; boost 100 adds 30 score points in Fill and Autofill */
  boost: number;
  note: string;
  /** Unix ms */
  updated?: number;
}

export interface ThemeEntry {
  answer: string;
  clues: string[];
}

export interface NotebookTheme {
  id: string;
  title: string;
  description: string;
  revealer: ThemeEntry | null;
  entries: ThemeEntry[];
  /** Unix ms */
  updated?: number;
}

export interface Tombstone {
  /** "answer:<LETTERS>" or "theme:<id>" */
  key: string;
  /** Unix ms */
  at: number;
}

export interface NotebookFile {
  clues: NotebookAnswer[];
  themes: NotebookTheme[];
  deleted: Tombstone[];
  synced: number;
}

export const DEFAULT_BOOST = 50;
/** Score points per boost point (boost 100 adds 30, matching ThemeFill). */
export const BOOST_FACTOR = 0.3;

export function letters(answer: string): string {
  return answer.toUpperCase().replace(/[^A-Z]/g, '');
}

export function answerKey(answer: string): string {
  return `answer:${letters(answer)}`;
}

export function themeKey(id: string): string {
  return `theme:${id}`;
}

/** "9 letters · 2 words (4, 5)" or "5 letters". */
export function letterBreakdown(answer: string): string {
  const n = letters(answer).length;
  const words = answer
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
  const base = `${n} letter${n === 1 ? '' : 's'}`;
  if (words.length < 2) return base;
  return `${base} · ${words.length} words (${words.map((w) => w.length).join(', ')})`;
}

export interface SymmetryCheck {
  ok: boolean;
  /** lengths that have a partner of the same length, once per pair */
  pairs: number[];
  /** an odd-length entry that can run through the center */
  center: number | null;
  unpaired: number[];
  label: string;
}

/**
 * Theme entries need a symmetric partner of the same length; one odd-length entry may sit
 * in the center row of an odd-width grid instead.
 */
export function symmetryCheck(answers: string[], width = 15): SymmetryCheck {
  const lens = answers.map((a) => letters(a).length).filter((n) => n > 0);
  const count = new Map<number, number>();
  for (const n of lens) count.set(n, (count.get(n) ?? 0) + 1);
  const pairs: number[] = [];
  const left: number[] = [];
  for (const [n, c] of [...count].sort((a, b) => a[0] - b[0])) {
    for (let i = 0; i < Math.floor(c / 2); i++) pairs.push(n);
    if (c % 2) left.push(n);
  }
  let center: number | null = null;
  if (left.length === 1 && left[0] % 2 === 1 && width % 2 === 1 && left[0] <= width) center = left.pop()!;
  const ok = left.length === 0 && lens.length > 0;
  const label = !lens.length
    ? 'No entries'
    : ok
      ? [...pairs.map((n) => `${n}·${n}`), ...(center ? [`${center} center`] : [])].join(' · ')
      : `${left.join(', ')} unpaired`;
  return { ok, pairs, center, unpaired: left, label };
}

/** All answers of a theme, revealer last. */
export function themeAnswers(t: NotebookTheme): string[] {
  const out = t.entries.map((e) => e.answer).filter((a) => letters(a));
  if (t.revealer && letters(t.revealer.answer)) out.push(t.revealer.answer);
  return out;
}

/** Fill in missing fields so items from older files or ThemeFill are safe to use. */
export function normalizeAnswer(a: Partial<NotebookAnswer> & { answer: string }): NotebookAnswer {
  return {
    answer: a.answer,
    clues: Array.isArray(a.clues) ? a.clues.filter((c) => typeof c === 'string') : [],
    boost: typeof a.boost === 'number' ? Math.max(1, Math.min(100, Math.round(a.boost))) : DEFAULT_BOOST,
    note: typeof a.note === 'string' ? a.note : '',
    ...(typeof a.updated === 'number' ? { updated: a.updated } : {}),
  };
}

export function normalizeTheme(t: Partial<NotebookTheme> & { id: string }): NotebookTheme {
  const entry = (e: Partial<ThemeEntry> | null | undefined): ThemeEntry | null =>
    e && typeof e.answer === 'string' ? { answer: e.answer, clues: Array.isArray(e.clues) ? e.clues.filter((c) => typeof c === 'string') : [] } : null;
  return {
    id: t.id,
    title: typeof t.title === 'string' ? t.title : '',
    description: typeof t.description === 'string' ? t.description : '',
    revealer: entry(t.revealer),
    entries: (Array.isArray(t.entries) ? t.entries : []).map(entry).filter((e): e is ThemeEntry => !!e),
    ...(typeof t.updated === 'number' ? { updated: t.updated } : {}),
  };
}

/**
 * Merge two notebooks (SPEC §5.4). Per key the newest `updated` wins (missing = 0); a
 * tombstone wins over any edit that is not newer than it. Tombstones that an item
 * outlived are dropped. Pure and symmetric: merge(a, b) equals merge(b, a).
 */
export function mergeNotebooks(a: Partial<NotebookFile>, b: Partial<NotebookFile>): NotebookFile {
  const items = new Map<string, { kind: 'answer'; v: NotebookAnswer } | { kind: 'theme'; v: NotebookTheme }>();
  const tombs = new Map<string, number>();
  const upd = (x: { updated?: number }) => (typeof x.updated === 'number' ? x.updated : 0);
  const offer = (key: string, next: { kind: 'answer'; v: NotebookAnswer } | { kind: 'theme'; v: NotebookTheme }) => {
    const cur = items.get(key);
    // Ties break on the serialized value so the result doesn't depend on argument order.
    if (!cur || upd(next.v) > upd(cur.v) || (upd(next.v) === upd(cur.v) && JSON.stringify(next.v) > JSON.stringify(cur.v))) items.set(key, next);
  };
  for (const side of [a, b]) {
    for (const c of side.clues ?? []) if (c && typeof c.answer === 'string' && letters(c.answer)) offer(answerKey(c.answer), { kind: 'answer', v: c });
    for (const t of side.themes ?? []) if (t && typeof t.id === 'string') offer(themeKey(t.id), { kind: 'theme', v: t });
    for (const d of side.deleted ?? []) if (d && typeof d.key === 'string') tombs.set(d.key, Math.max(tombs.get(d.key) ?? 0, Number(d.at) || 0));
  }
  const out: NotebookFile = { clues: [], themes: [], deleted: [], synced: Math.max(a.synced ?? 0, b.synced ?? 0) };
  for (const key of [...items.keys()].sort()) {
    const it = items.get(key)!;
    const t = tombs.get(key);
    if (t !== undefined && t >= upd(it.v)) continue;
    if (t !== undefined) tombs.delete(key);
    if (it.kind === 'answer') out.clues.push(it.v);
    else out.themes.push(it.v);
  }
  out.deleted = [...tombs].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([key, at]) => ({ key, at }));
  return out;
}
