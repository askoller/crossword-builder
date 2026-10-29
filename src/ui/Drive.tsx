// Google Drive UI: Settings section, Home backup card, "Backup paused" banner, restore.
import { useEffect, useState } from 'preact/hooks';
import { DRIVE_FOLDER } from '../config';
import { authState, connect, disconnect, resume } from '../google/auth';
import { pickFolder } from '../google/picker';
import {
  backupStatus,
  createRootFolder,
  flushOutbox,
  listBackups,
  loadBackupStatus,
  markAll,
  resolveFolders,
  restoreAll,
  restoreBackup,
  useRootFolder,
  type RemotePuzzle,
} from '../sync/backup';
import { notebookSyncStatus, syncNotebook } from '../sync/notebookSync';
import { dataVersion, navigate } from '../state/app';
import { Dialog, relativeTime } from './common';
import { IconChevronRight, IconCloud } from './icons';

const puzzles = (n: number) => `${n} puzzle${n === 1 ? '' : 's'}`;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** After a fresh connection: find or choose the folder, queue everything, sync. */
async function finishSetup(): Promise<boolean> {
  if (!(await resolveFolders())) return false;
  await markAll();
  await flushOutbox();
  await syncNotebook();
  return true;
}

/** "Backed up to Google Drive · Crossword Builder folder · 2 min ago" and friends. */
export function backupLine(): { title: string; sub: string } {
  const st = backupStatus.value;
  switch (authState.value) {
    case 'disconnected':
      return { title: 'Not backed up yet', sub: 'Connect Google Drive' };
    case 'paused':
      return { title: 'Backup paused', sub: 'Tap to sign in' };
  }
  if (st.needsFolder) return { title: 'Choose a Drive folder', sub: 'Tap to finish setting up backup' };
  if (st.busy) return { title: 'Backing up…', sub: `Google Drive · ${DRIVE_FOLDER} folder` };
  if (!st.lastBackup) return { title: 'Waiting to back up', sub: navigator.onLine ? `${puzzles(st.pending)} queued` : 'Offline · will back up when online' };
  return { title: 'Backed up to Google Drive', sub: `${DRIVE_FOLDER} folder · ${relativeTime(st.lastBackup)}` };
}

export function BackupCard() {
  useTick();
  const { title, sub } = backupLine();
  const onClick = () => {
    if (authState.value === 'paused') void resume().catch(() => navigate({ name: 'settings' }));
    else navigate({ name: 'settings' });
  };
  return (
    <button class={`card backup-card${authState.value === 'paused' ? ' paused' : ''}`} onClick={onClick}>
      <IconCloud />
      <div>
        <div class="strong">{title}</div>
        <div class="muted">{sub}</div>
      </div>
      <IconChevronRight />
    </button>
  );
}

/** Notebook screen status line: "Synced with ThemeFill · 2 min ago" and friends (SPEC §3.7). */
export function NotebookSyncLine({ synced = 0 }: { synced?: number }) {
  useTick();
  const nb = notebookSyncStatus.value;
  const at = Math.max(nb.at, synced);
  let text: string;
  let tap: (() => void) | null = () => void syncNotebook();
  if (authState.value === 'disconnected') {
    text = 'On this phone · Connect Google Drive to sync with ThemeFill';
    tap = () => navigate({ name: 'settings' });
  } else if (authState.value === 'paused') {
    text = 'Sync paused · tap to resume';
    tap = () => void resume().catch(() => navigate({ name: 'settings' }));
  } else if (backupStatus.value.needsFolder) {
    text = 'Choose a Drive folder in Settings to sync with ThemeFill';
    tap = () => navigate({ name: 'settings' });
  } else if (nb.busy) {
    text = 'Syncing with ThemeFill…';
    tap = null;
  } else if (nb.error) text = `Sync failed · ${nb.error} · tap to retry`;
  else if (!navigator.onLine) text = 'Offline · edits sync with ThemeFill when back online';
  else text = at ? `Synced with ThemeFill · ${relativeTime(at)}` : 'Not synced yet · tap to sync';
  return (
    <button class={`sync-line${nb.error ? ' warn-text' : ' muted'}`} disabled={!tap} onClick={() => tap?.()}>
      {text}
    </button>
  );
}

/** Shown at the top of every screen while backup is paused. */
export function PausedBanner() {
  const [error, setError] = useState('');
  if (authState.value !== 'paused') return null;
  return (
    <button class="update-banner paused-banner" onClick={() => void resume().then(() => setError(''), (e) => setError(message(e)))}>
      <span>Backup paused · tap to resume</span>
      {error && <span class="small">{error}</span>}
    </button>
  );
}

/** Re-render every 30 s so "x min ago" labels stay fresh. */
export function useTick(ms = 30_000): void {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function DriveSection() {
  useTick();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(false);
  const state = authState.value;
  const st = backupStatus.value;
  const nb = notebookSyncStatus.value;

  useEffect(() => {
    void loadBackupStatus();
  }, []);

  const run = async (label: string, job: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await job();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };

  const onConnect = () =>
    run('Connecting…', async () => {
      await connect();
      await finishSetup();
    });

  const chooseExisting = () =>
    run('Opening Drive…', async () => {
      const folder = await pickFolder(`Choose your ${DRIVE_FOLDER} folder`, DRIVE_FOLDER);
      if (!folder) return;
      await useRootFolder(folder.id);
      await finishSetup();
    });

  const createNew = () =>
    run('Creating folder…', async () => {
      await createRootFolder();
      await finishSetup();
    });

  return (
    <section class="card section">
      <h2>Google Drive</h2>
      <div class="row">
        <IconCloud />
        <div>
          <div class="strong">{state === 'disconnected' ? 'Not connected' : state === 'paused' ? 'Backup paused' : `Connected · ${DRIVE_FOLDER} folder`}</div>
          <div class="muted small">
            {state === 'disconnected'
              ? 'Back up puzzles and sync the Notebook with ThemeFill. The app only sees files it made or that you pick.'
              : state === 'paused'
                ? 'Google needs you to sign in again. Puzzles keep saving on this phone and upload when you resume.'
                : st.lastBackup
                  ? `Last backup ${relativeTime(st.lastBackup)}${st.pending ? ` · ${st.pending} waiting` : ''}`
                  : st.pending
                    ? `${puzzles(st.pending)} waiting to upload`
                    : 'Nothing backed up yet'}
          </div>
          {state !== 'disconnected' && nb.at > 0 && <div class="muted small">Notebook synced with ThemeFill {relativeTime(nb.at)}</div>}
        </div>
      </div>

      {state === 'connected' && st.needsFolder && (
        <div class="notice notice-col">
          <span>
            No {DRIVE_FOLDER} folder made by this app was found. If your laptop already has one, choose it so backups and the
            Notebook go in the same place.
          </span>
          <div class="row">
            <button class="btn primary small" disabled={!!busy} onClick={chooseExisting}>
              Choose existing folder
            </button>
            <button class="btn small" disabled={!!busy} onClick={createNew}>
              Create new folder
            </button>
          </div>
        </div>
      )}

      <div class="button-col">
        {state === 'disconnected' && (
          <button class="btn primary" disabled={!!busy} onClick={onConnect}>
            Connect Google Drive
          </button>
        )}
        {state === 'paused' && (
          <button class="btn primary" disabled={!!busy} onClick={() => run('Signing in…', resume)}>
            Resume backup
          </button>
        )}
        {state === 'connected' && !st.needsFolder && (
          <>
            <button
              class="btn primary"
              disabled={!!busy || st.busy}
              onClick={() =>
                run('Backing up…', async () => {
                  await markAll();
                  await flushOutbox();
                  await syncNotebook();
                  if (backupStatus.value.error) throw new Error(backupStatus.value.error);
                })
              }
            >
              Back up now
            </button>
            <button class="btn" disabled={!!busy} onClick={() => setRestoring(true)}>
              Restore from Drive
            </button>
          </>
        )}
        {state !== 'disconnected' && (
          <button class="btn" disabled={!!busy} onClick={() => run('Disconnecting…', disconnect)}>
            Disconnect
          </button>
        )}
      </div>
      {busy && <p class="muted small">{busy}</p>}
      {(error || st.error || nb.error) && <p class="warn-text">{error || st.error || nb.error}</p>}
      {restoring && <RestoreDialog onClose={() => setRestoring(false)} />}
    </section>
  );
}

function RestoreDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<RemotePuzzle[] | null>(null);
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    listBackups().then(setList, (e) => setError(message(e)));
  }, []);

  const one = async (f: RemotePuzzle) => {
    setBusy(f.fileId);
    setError('');
    try {
      await restoreBackup(f.fileId);
      setDone((s) => new Set(s).add(f.fileId));
      dataVersion.value++;
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };

  const all = async () => {
    setBusy('all');
    setError('');
    try {
      await restoreAll(undefined, (n, total) => setBusy(`all:${n}/${total}`));
      setDone(new Set(list?.map((f) => f.fileId)));
      dataVersion.value++;
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <Dialog
      title="Restore from Drive"
      onClose={onClose}
      actions={
        list && list.length > 0 ? (
          <button class="btn primary" disabled={!!busy} onClick={all}>
            {busy.startsWith('all:') ? `Restoring ${busy.slice(4)}` : `Restore all ${list.length}`}
          </button>
        ) : undefined
      }
    >
      <p class="muted small">A puzzle that is also on this phone is replaced; the phone's copy is kept as a snapshot.</p>
      {!list && !error && <p class="muted">Loading backups…</p>}
      {list && !list.length && <p class="muted">No puzzle backups in the {DRIVE_FOLDER} folder yet.</p>}
      <div class="restore-list">
        {list?.map((f) => (
          <div key={f.fileId} class="restore-row">
            <div>
              <div class="strong">{f.name}</div>
              <div class="muted small">{f.modified ? `Backed up ${relativeTime(f.modified)}` : ''}</div>
            </div>
            <button class="btn small" disabled={!!busy || done.has(f.fileId)} onClick={() => one(f)}>
              {done.has(f.fileId) ? 'Restored' : busy === f.fileId ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        ))}
      </div>
      {error && <p class="warn-text">{error}</p>}
    </Dialog>
  );
}
