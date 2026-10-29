// Local Notebook store (SPEC §3.7). Items live in the `notebook` object store under
// "answer:<LETTERS>" / "theme:<id>"; deletions leave a tombstone under "deleted:<key>" so
// Drive sync (session 4) can merge with ThemeFill using mergeNotebooks().
import { signal } from '@preact/signals';
import {
  answerKey,
  letters,
  mergeNotebooks,
  normalizeAnswer,
  normalizeTheme,
  themeKey,
  type NotebookAnswer,
  type NotebookFile,
  type NotebookTheme,
  type Tombstone,
} from '../model/notebook';
import { openDb } from './db';

/** Bumped after every change to the stored Notebook, so screens and the engine reload it. */
export const notebookVersion = signal(0);

/** Bumped only by edits made in the app (not by sync merges), so Drive sync can push them. */
export const notebookEdits = signal(0);

function edited(): void {
  notebookVersion.value++;
  notebookEdits.value++;
}

const TOMB = 'deleted:';

function fromRows(keys: string[], values: unknown[], synced: number): NotebookFile {
  const out: NotebookFile = { clues: [], themes: [], deleted: [], synced };
  keys.forEach((k, i) => {
    const v = values[i] as Record<string, unknown>;
    if (!v) return;
    if (k.startsWith('answer:') && typeof v.answer === 'string') out.clues.push(normalizeAnswer(v as unknown as NotebookAnswer));
    else if (k.startsWith('theme:') && typeof v.id === 'string') out.themes.push(normalizeTheme(v as unknown as NotebookTheme));
    else if (k.startsWith(TOMB)) out.deleted.push(v as unknown as Tombstone);
  });
  return out;
}

export async function readNotebook(): Promise<NotebookFile> {
  const db = await openDb();
  const tx = db.transaction(['notebook', 'settings']);
  const store = tx.objectStore('notebook');
  const [keys, values, synced] = await Promise.all([store.getAllKeys(), store.getAll(), tx.objectStore('settings').get('notebookSynced')]);
  return fromRows(keys, values, (synced as number | undefined) ?? 0);
}

export async function getAnswer(answer: string): Promise<NotebookAnswer | null> {
  const v = (await (await openDb()).get('notebook', answerKey(answer))) as NotebookAnswer | undefined;
  return v ? normalizeAnswer(v) : null;
}

export async function getTheme(id: string): Promise<NotebookTheme | null> {
  const v = (await (await openDb()).get('notebook', themeKey(id))) as NotebookTheme | undefined;
  return v ? normalizeTheme(v) : null;
}

/** Save an answer. `previous` is its answer before an edit, so a rename tombstones the old key. */
export async function saveAnswer(a: NotebookAnswer, previous?: string, now = Date.now()): Promise<NotebookAnswer> {
  if (!letters(a.answer)) throw new Error('An answer needs at least one letter');
  const item = { ...normalizeAnswer(a), answer: a.answer.trim().toUpperCase().replace(/\s+/g, ' '), updated: now };
  const db = await openDb();
  const tx = db.transaction('notebook', 'readwrite');
  const key = answerKey(item.answer);
  void tx.store.put(item, key);
  void tx.store.delete(TOMB + key);
  if (previous !== undefined && answerKey(previous) !== key) {
    void tx.store.delete(answerKey(previous));
    void tx.store.put({ key: answerKey(previous), at: now }, TOMB + answerKey(previous));
  }
  await tx.done;
  edited();
  return item;
}

export async function saveTheme(t: NotebookTheme, now = Date.now()): Promise<NotebookTheme> {
  const item = { ...normalizeTheme(t), updated: now };
  const db = await openDb();
  const tx = db.transaction('notebook', 'readwrite');
  void tx.store.put(item, themeKey(item.id));
  void tx.store.delete(TOMB + themeKey(item.id));
  await tx.done;
  edited();
  return item;
}

export async function deleteItem(key: string, now = Date.now()): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('notebook', 'readwrite');
  void tx.store.delete(key);
  void tx.store.put({ key, at: now }, TOMB + key);
  await tx.done;
  edited();
}

/** Add a clue idea to an answer, creating the answer if needed. */
export async function addClueIdea(answer: string, clue: string): Promise<NotebookAnswer> {
  const cur = (await getAnswer(answer)) ?? normalizeAnswer({ answer });
  const text = clue.trim();
  if (text && !cur.clues.includes(text)) cur.clues = [...cur.clues, text];
  return saveAnswer(cur);
}

function putAll(store: { clear(): Promise<void>; put(v: unknown, k: string): Promise<unknown> }, file: NotebookFile): void {
  void store.clear();
  for (const a of file.clues) void store.put(a, answerKey(a.answer));
  for (const t of file.themes) void store.put(t, themeKey(t.id));
  for (const d of file.deleted) void store.put(d, TOMB + d.key);
}

/** Replace the local Notebook with a file (e.g. the result of mergeNotebooks). */
export async function writeNotebook(file: NotebookFile): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['notebook', 'settings'], 'readwrite');
  putAll(tx.objectStore('notebook'), file);
  void tx.objectStore('settings').put(file.synced, 'notebookSynced');
  await tx.done;
  notebookVersion.value++;
}

const sameContent = (a: NotebookFile, b: NotebookFile) => JSON.stringify({ ...a, synced: 0 }) === JSON.stringify({ ...b, synced: 0 });

/**
 * Merge a remote notebook (Drive / ThemeFill) into the local one; returns the merged file to
 * write back. Read, merge and write happen in one transaction, so an edit saved while a
 * sync is downloading is never overwritten.
 */
export async function mergeIntoLocal(remote: Partial<NotebookFile>, synced = Date.now()): Promise<NotebookFile> {
  const db = await openDb();
  const tx = db.transaction(['notebook', 'settings'], 'readwrite');
  const store = tx.objectStore('notebook');
  const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()]);
  const local = fromRows(keys, values, 0);
  const merged = { ...mergeNotebooks(local, remote), synced };
  // Compare with the local file normalised the same way, so a no-op sync doesn't reload the engine.
  const changed = !sameContent(merged, { ...mergeNotebooks(local, {}), synced });
  if (changed) putAll(store, merged);
  void tx.objectStore('settings').put(synced, 'notebookSynced');
  await tx.done;
  if (changed) notebookVersion.value++;
  return merged;
}

/** Boost per answer letters, for Fill and Autofill. */
export async function notebookBoosts(): Promise<Map<string, number>> {
  const nb = await readNotebook();
  return new Map(nb.clues.map((a) => [letters(a.answer), a.boost]));
}
