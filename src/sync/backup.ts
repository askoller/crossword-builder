// Google Drive backup (SPEC §5.3). Local saving never depends on Drive: saves only add the
// puzzle to the outbox, and the outbox is uploaded every 3 minutes, when the app goes to
// the background and when the network comes back. Offline or signed out, it just waits.
import { signal } from '@preact/signals';
import { DRIVE_FOLDER } from '../config';
import { getSetting, openDb, setSetting } from '../data/db';
import { addSnapshot, getPuzzle, savePuzzle } from '../data/puzzles';
import { AuthError, authState } from '../google/auth';
import { drive as defaultDrive, DriveError, q, type Drive, type DriveFile } from '../google/drive';
import { exportPuz, puzzleFileBase } from '../model/puz';
import type { Puzzle } from '../model/types';

export const BACKUP_INTERVAL_MS = 3 * 60 * 1000;

export interface DriveFolders {
  root: string;
  puzzles: string;
}

/** Remembered Drive ids, so uploads update files in place instead of searching. */
export interface DriveIds {
  folders?: DriveFolders;
  notebook?: string;
  /** per puzzle id */
  files?: Record<string, { json?: string; puz?: string }>;
}

export interface BackupStatus {
  /** Unix ms of the last successful upload round, or 0 */
  lastBackup: number;
  /** puzzles waiting in the outbox */
  pending: number;
  busy: boolean;
  error: string;
  /** connected, but no Drive folder chosen yet */
  needsFolder: boolean;
}

export const backupStatus = signal<BackupStatus>({ lastBackup: 0, pending: 0, busy: false, error: '', needsFolder: false });

const IDS_KEY = 'driveIds';
const LAST_KEY = 'lastBackup';

let driveImpl: Drive = defaultDrive;
/** Tests swap in a Drive backed by a fake fetch. */
export function setDrive(d: Drive): void {
  driveImpl = d;
}
export function getDrive(): Drive {
  return driveImpl;
}

function patchStatus(p: Partial<BackupStatus>): void {
  backupStatus.value = { ...backupStatus.value, ...p };
}

export async function getIds(): Promise<DriveIds> {
  return (await getSetting<DriveIds>(IDS_KEY)) ?? {};
}

export async function setIds(ids: DriveIds): Promise<void> {
  await setSetting(IDS_KEY, ids);
}

/** Forget remembered ids (on disconnect, or when the folder was deleted in Drive). */
export async function clearIds(): Promise<void> {
  await setSetting(IDS_KEY, {});
}

export class FolderNotSet extends Error {}

/**
 * "Crossword Builder/" and its "puzzles/" folder. Under drive.file the app can only find
 * a root folder it made itself; if the laptop made it first, Andrew picks it once in
 * Settings (useRootFolder) so there are never two folders with the same name.
 */
export async function ensureFolders(d: Drive = driveImpl): Promise<DriveFolders> {
  const ids = await getIds();
  if (ids.folders) return ids.folders;
  const root = await d.findFolder(DRIVE_FOLDER);
  if (!root) throw new FolderNotSet('Choose the Crossword Builder folder in Settings');
  return useRootFolder(root.id, d);
}

/** Use this folder as the root (picked in Settings, or found). Forgets old file ids. */
export async function useRootFolder(rootId: string, d: Drive = driveImpl): Promise<DriveFolders> {
  const puzzles = await d.ensureFolder('puzzles', rootId);
  const folders = { root: rootId, puzzles: puzzles.id };
  await setIds({ folders });
  patchStatus({ needsFolder: false });
  return folders;
}

/** Make a new "Crossword Builder" folder in My Drive and use it. */
export async function createRootFolder(d: Drive = driveImpl): Promise<DriveFolders> {
  return useRootFolder((await d.createFolder(DRIVE_FOLDER)).id, d);
}

/** After connecting: true when a root folder is known or found, false when Andrew must choose. */
export async function resolveFolders(d: Drive = driveImpl): Promise<boolean> {
  try {
    await ensureFolders(d);
    return true;
  } catch (e) {
    if (e instanceof FolderNotSet) {
      patchStatus({ needsFolder: true });
      return false;
    }
    throw e;
  }
}

// ---------- outbox ----------

async function refreshPending(): Promise<void> {
  const keys = await (await openDb()).getAll('outbox');
  patchStatus({ pending: new Set(keys.map((k) => k.puzzleId)).size });
}

/** Queue a puzzle for upload (savePuzzle already does this for every local save). */
export async function markChanged(puzzleId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('outbox', 'readwrite');
  const keys = await tx.store.index('puzzleId').getAllKeys(puzzleId);
  for (const k of keys) await tx.store.delete(k);
  await tx.store.add({ puzzleId, at: Date.now() });
  await tx.done;
  await refreshPending();
}

/** Queue every local puzzle (first connection, "Back up now" after a restore). */
export async function markAll(): Promise<void> {
  const ids = await (await openDb()).getAllKeys('puzzles');
  for (const id of ids) await markChanged(id);
}

const JSON_MIME = 'application/json';
const PUZ_MIME = 'application/x-crossword';

async function uploadOne(d: Drive, folders: DriveFolders, p: Puzzle, ids: DriveIds): Promise<void> {
  const base = puzzleFileBase(p);
  const known = ids.files?.[p.id] ?? {};
  const put = async (kind: 'json' | 'puz', name: string, mimeType: string, body: Blob): Promise<string> => {
    let id = known[kind];
    if (!id) {
      // A reinstall forgets the ids; find the earlier upload by its tag.
      const found = await d.list(
        `${quoteTag('puzzleId', p.id)} and ${quoteTag('kind', kind)} and ${q(folders.puzzles)} in parents and trashed = false`,
      );
      id = found[0]?.id;
    }
    if (id) {
      try {
        return (await d.update(id, body, { name, mimeType })).id;
      } catch (e) {
        // deleted in Drive: create it again
        if (!notFound(e)) throw e;
      }
    }
    const created = await d.create({ name, mimeType, parents: [folders.puzzles], appProperties: { puzzleId: p.id, kind } }, body);
    return created.id;
  };
  const json = await put('json', `${base}.json`, JSON_MIME, new Blob([JSON.stringify(p)], { type: JSON_MIME }));
  const puz = await put('puz', `${base}.puz`, PUZ_MIME, new Blob([exportPuz(p) as BlobPart], { type: PUZ_MIME }));
  ids.files = { ...ids.files, [p.id]: { json, puz } };
}

function notFound(e: unknown): boolean {
  return e instanceof DriveError && e.status === 404;
}

function quoteTag(key: string, value: string): string {
  return `appProperties has { key=${q(key)} and value=${q(value)} }`;
}

let running: Promise<void> | null = null;

/** Upload everything in the outbox. Safe to call any time; does nothing when it can't. */
export function flushOutbox(d: Drive = driveImpl): Promise<void> {
  running ??= doFlush(d).finally(() => (running = null));
  return running;
}

async function doFlush(d: Drive): Promise<void> {
  await refreshPending();
  if (authState.value !== 'connected') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const db = await openDb();
  const rows = await db.getAll('outbox');
  if (!rows.length) {
    if (!backupStatus.value.lastBackup) patchStatus({ lastBackup: (await getSetting<number>(LAST_KEY)) ?? 0 });
    return;
  }
  patchStatus({ busy: true, error: '' });
  try {
    let folders = await ensureFolders(d);
    const ids = await getIds();
    const byPuzzle = new Map<string, number>();
    for (const r of rows) byPuzzle.set(r.puzzleId, Math.max(byPuzzle.get(r.puzzleId) ?? 0, r.at));
    for (const [puzzleId, at] of byPuzzle) {
      const p = await getPuzzle(puzzleId);
      if (p) {
        try {
          await uploadOne(d, folders, p, ids);
        } catch (e) {
          // The puzzles folder was deleted in Drive: find or make it again, once.
          if (notFound(e)) {
            await setIds({ ...ids, folders: undefined });
            folders = await ensureFolders(d);
            await uploadOne(d, folders, p, ids);
          } else throw e;
        }
        await setIds({ ...(await getIds()), files: ids.files });
      }
      // Remove only rows that were there before the upload; later edits stay queued.
      const tx = db.transaction('outbox', 'readwrite');
      const keys = await tx.store.index('puzzleId').getAllKeys(puzzleId);
      for (const k of keys) {
        const row = await tx.store.get(k);
        if (row && row.at <= at) await tx.store.delete(k);
      }
      await tx.done;
    }
    const now = Date.now();
    await setSetting(LAST_KEY, now);
    patchStatus({ lastBackup: now });
  } catch (e) {
    if (e instanceof FolderNotSet) patchStatus({ needsFolder: true });
    else patchStatus({ error: e instanceof AuthError ? '' : e instanceof Error ? e.message : String(e) });
  } finally {
    patchStatus({ busy: false });
    await refreshPending();
  }
}

export async function loadBackupStatus(): Promise<void> {
  patchStatus({ lastBackup: (await getSetting<number>(LAST_KEY)) ?? 0 });
  await refreshPending();
}

// ---------- restore ----------

export interface RemotePuzzle {
  fileId: string;
  name: string;
  modified: string;
  puzzleId: string | null;
}

export async function listBackups(d: Drive = driveImpl): Promise<RemotePuzzle[]> {
  const folders = await ensureFolders(d);
  const files: DriveFile[] = await d.list(`${q(folders.puzzles)} in parents and trashed = false and name contains '.json'`);
  return files
    .filter((f) => f.name.endsWith('.json'))
    .map((f) => ({ fileId: f.id, name: f.name.replace(/\.json$/, ''), modified: f.modifiedTime ?? '', puzzleId: f.appProperties?.puzzleId ?? null }))
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

function isPuzzle(x: unknown): x is Puzzle {
  const p = x as Puzzle;
  return (
    !!p &&
    p.format === 1 &&
    typeof p.id === 'string' &&
    Number.isInteger(p.width) &&
    Number.isInteger(p.height) &&
    Array.isArray(p.cells) &&
    p.cells.length === p.width * p.height
  );
}

/**
 * Restore one backup. A local copy with the same id is kept as a snapshot first, so a
 * restore never loses work. Returns the restored puzzle.
 */
export async function restoreBackup(fileId: string, d: Drive = driveImpl): Promise<Puzzle> {
  const data = JSON.parse(await (await d.download(fileId)).text()) as unknown;
  if (!isPuzzle(data)) throw new Error('That file is not a Crossword Builder puzzle');
  const local = await getPuzzle(data.id);
  if (local) await addSnapshot(local, 'import');
  await savePuzzle(data);
  const ids = await getIds();
  ids.files = { ...ids.files, [data.id]: { ...ids.files?.[data.id], json: fileId } };
  await setIds(ids);
  return data;
}

export async function restoreAll(d: Drive = driveImpl, onProgress: (done: number, total: number) => void = () => {}): Promise<number> {
  const list = await listBackups(d);
  let n = 0;
  for (const f of list) {
    await restoreBackup(f.fileId, d);
    onProgress(++n, list.length);
  }
  return n;
}
