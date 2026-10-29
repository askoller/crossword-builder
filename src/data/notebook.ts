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

/** Bumped after every local write, so screens reload the Notebook. */
export const notebookVersion = signal(0);

const TOMB = 'deleted:';

export async function readNotebook(): Promise<NotebookFile> {
  const db = await openDb();
  const tx = db.transaction('notebook');
  const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  const out: NotebookFile = { clues: [], themes: [], deleted: [], synced: 0 };
  keys.forEach((k, i) => {
    const v = values[i] as Record<string, unknown>;
    if (!v) return;
    if (k.startsWith('answer:') && typeof v.answer === 'string') out.clues.push(normalizeAnswer(v as unknown as NotebookAnswer));
    else if (k.startsWith('theme:') && typeof v.id === 'string') out.themes.push(normalizeTheme(v as unknown as NotebookTheme));
    else if (k.startsWith(TOMB)) out.deleted.push(v as unknown as Tombstone);
  });
  out.synced = ((await db.get('settings', 'notebookSynced')) as number | undefined) ?? 0;
  return out;
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
  notebookVersion.value++;
  return item;
}

export async function saveTheme(t: NotebookTheme, now = Date.now()): Promise<NotebookTheme> {
  const item = { ...normalizeTheme(t), updated: now };
  const db = await openDb();
  const tx = db.transaction('notebook', 'readwrite');
  void tx.store.put(item, themeKey(item.id));
  void tx.store.delete(TOMB + themeKey(item.id));
  await tx.done;
  notebookVersion.value++;
  return item;
}

export async function deleteItem(key: string, now = Date.now()): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('notebook', 'readwrite');
  void tx.store.delete(key);
  void tx.store.put({ key, at: now }, TOMB + key);
  await tx.done;
  notebookVersion.value++;
}

/** Add a clue idea to an answer, creating the answer if needed. */
export async function addClueIdea(answer: string, clue: string): Promise<NotebookAnswer> {
  const cur = (await getAnswer(answer)) ?? normalizeAnswer({ answer });
  const text = clue.trim();
  if (text && !cur.clues.includes(text)) cur.clues = [...cur.clues, text];
  return saveAnswer(cur);
}

/** Replace the local Notebook with a file (e.g. the result of mergeNotebooks). */
export async function writeNotebook(file: NotebookFile): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['notebook', 'settings'], 'readwrite');
  const store = tx.objectStore('notebook');
  await store.clear();
  for (const a of file.clues) void store.put(a, answerKey(a.answer));
  for (const t of file.themes) void store.put(t, themeKey(t.id));
  for (const d of file.deleted) void store.put(d, TOMB + d.key);
  void tx.objectStore('settings').put(file.synced, 'notebookSynced');
  await tx.done;
  notebookVersion.value++;
}

/** Merge a remote notebook (Drive / ThemeFill) into the local one; returns the merged file to write back. */
export async function mergeIntoLocal(remote: Partial<NotebookFile>, synced = Date.now()): Promise<NotebookFile> {
  const merged = { ...mergeNotebooks(await readNotebook(), remote), synced };
  await writeNotebook(merged);
  return merged;
}

/** Boost per answer letters, for Fill and Autofill. */
export async function notebookBoosts(): Promise<Map<string, number>> {
  const nb = await readNotebook();
  return new Map(nb.clues.map((a) => [letters(a.answer), a.boost]));
}
