// Notebook sync with ThemeFill through "Crossword Builder/notebook.json" (SPEC §5.4).
// Pull, merge with the local Notebook (newest wins per key, tombstones), write the
// merged result back in place so the Drive file id never changes.
import { signal } from '@preact/signals';
import { getSetting } from '../data/db';
import { mergeIntoLocal } from '../data/notebook';
import { authState } from '../google/auth';
import { DriveError, type Drive } from '../google/drive';
import { mergeNotebooks, type NotebookFile } from '../model/notebook';
import { ensureFolders, FolderNotSet, getDrive, getIds, setIds } from './backup';

export const NOTEBOOK_FILE = 'notebook.json';
export const NOTEBOOK_POLL_MS = 2 * 60 * 1000;

export interface NotebookSyncStatus {
  /** Unix ms of the last successful sync, or 0 */
  at: number;
  busy: boolean;
  error: string;
}

export const notebookSyncStatus = signal<NotebookSyncStatus>({ at: 0, busy: false, error: '' });

/** Only the parts that matter for "did anything change" (not `synced`). */
function content(f: Partial<NotebookFile>): string {
  return JSON.stringify(mergeNotebooks(f, {}), (k, v) => (k === 'synced' ? undefined : v));
}

function parse(text: string): Partial<NotebookFile> {
  const data = JSON.parse(text) as Partial<NotebookFile>;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('notebook.json is not a notebook');
  return data;
}

let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;

/**
 * Pull, merge and push. Does nothing offline or when Drive isn't connected. A call made
 * while a sync runs queues one more round after it, so a Notebook edit made mid-sync
 * still reaches Drive.
 */
export function syncNotebook(d?: Drive): Promise<void> {
  if (running) {
    queued ??= running.then(() => {
      queued = null;
      return syncNotebook(d);
    });
    return queued;
  }
  running = doSync(d ?? getDrive()).finally(() => (running = null));
  return running;
}

/** Push app edits to Drive shortly after they're made (debounced). */
export const NOTEBOOK_PUSH_DELAY_MS = 1500;

async function doSync(d: Drive): Promise<void> {
  if (authState.value !== 'connected') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  notebookSyncStatus.value = { ...notebookSyncStatus.value, busy: true, error: '' };
  try {
    const folders = await ensureFolders(d);
    const ids = await getIds();
    let fileId = ids.notebook;
    if (!fileId) fileId = (await d.findFile(NOTEBOOK_FILE, folders.root))?.id;

    let remote: Partial<NotebookFile> | null = null;
    if (fileId) {
      try {
        remote = parse(await (await d.download(fileId)).text());
      } catch (e) {
        // Deleted in Drive (404): create it again below. Anything else is a real error.
        if (!(e instanceof DriveError && e.status === 404)) throw e;
        fileId = undefined;
      }
    }

    const now = Date.now();
    let merged: NotebookFile;
    if (remote) merged = await mergeIntoLocal(remote, now);
    else {
      // First time: start from the data pack's notebook, merged with any local edits.
      const pack = (await getSetting<Partial<NotebookFile>>('datapackNotebook')) ?? {};
      merged = await mergeIntoLocal(pack, now);
    }

    const body = new Blob([JSON.stringify(merged, null, 1)], { type: 'application/json' });
    if (!fileId) {
      const created = await d.create({ name: NOTEBOOK_FILE, mimeType: 'application/json', parents: [folders.root] }, body);
      fileId = created.id;
    } else if (content(remote ?? {}) !== content(merged)) {
      await d.update(fileId, body);
    }
    if (ids.notebook !== fileId) await setIds({ ...(await getIds()), notebook: fileId });
    notebookSyncStatus.value = { at: now, busy: false, error: '' };
  } catch (e) {
    // No folder chosen yet: Settings already asks for one.
    const error = e instanceof FolderNotSet ? '' : e instanceof Error ? e.message : String(e);
    notebookSyncStatus.value = { ...notebookSyncStatus.value, busy: false, error };
  }
}

