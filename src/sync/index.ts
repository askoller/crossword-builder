// When Drive work happens: backups every 3 minutes and on going to the background,
// Notebook sync on start, on returning to the foreground, every 2 minutes while the
// Notebook is open and shortly after each Notebook edit (SPEC §5.3, §5.4). Nothing here
// blocks editing.
import { effect } from '@preact/signals';
import { authState, initAuth } from '../google/auth';
import { route } from '../state/app';
import { BACKUP_INTERVAL_MS, flushOutbox, loadBackupStatus } from './backup';
import { notebookEdits } from '../data/notebook';
import { NOTEBOOK_POLL_MS, NOTEBOOK_PUSH_DELAY_MS, syncNotebook } from './notebookSync';

const flushHooks = new Set<() => Promise<void>>();

/** Pending local saves (the open editor) run before an upload on going to the background. */
export function registerFlush(fn: () => Promise<void>): () => void {
  flushHooks.add(fn);
  return () => flushHooks.delete(fn);
}

async function backupNow(): Promise<void> {
  await Promise.all([...flushHooks].map((f) => f().catch(() => {})));
  await flushOutbox();
}

let started = false;

export async function startSync(): Promise<void> {
  if (started) return;
  started = true;
  await initAuth();
  await loadBackupStatus();

  // Each time the connection becomes usable (start, connect, resume): catch up.
  effect(() => {
    if (authState.value !== 'connected') return;
    void flushOutbox();
    void syncNotebook();
  });

  setInterval(() => void flushOutbox(), BACKUP_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void backupNow();
    else void syncNotebook().then(() => flushOutbox());
  });
  window.addEventListener('pagehide', () => void backupNow());
  window.addEventListener('online', () => {
    void flushOutbox();
    void syncNotebook();
  });

  // Notebook edits (Notebook screen, Save to Notebook in the clue editor) go to Drive soon
  // after they're made. Offline or paused, the next catch-up above pushes them.
  let push: ReturnType<typeof setTimeout> | null = null;
  let firstEdit = true;
  effect(() => {
    void notebookEdits.value;
    if (firstEdit) {
      firstEdit = false;
      return;
    }
    if (push) clearTimeout(push);
    push = setTimeout(() => void syncNotebook(), NOTEBOOK_PUSH_DELAY_MS);
  });

  let poll: ReturnType<typeof setInterval> | null = null;
  effect(() => {
    const open = route.value.name === 'notebook';
    if (open && !poll) {
      void syncNotebook();
      poll = setInterval(() => void syncNotebook(), NOTEBOOK_POLL_MS);
    } else if (!open && poll) {
      clearInterval(poll);
      poll = null;
    }
  });
}
