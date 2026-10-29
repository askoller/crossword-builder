import { emptyHistory, type History } from '../model/history';
import { uuid } from '../model/grid';
import type { Puzzle } from '../model/types';
import { openDb, type Snapshot } from './db';

export const SNAPSHOT_CAP = 50;
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

export async function listPuzzles(): Promise<Puzzle[]> {
  const all = await (await openDb()).getAll('puzzles');
  return all.sort((a, b) => b.updated.localeCompare(a.updated));
}

export async function getPuzzle(id: string): Promise<Puzzle | undefined> {
  return (await openDb()).get('puzzles', id);
}

export async function getHistory(id: string): Promise<History> {
  return (await (await openDb()).get('history', id)) ?? emptyHistory(id);
}

/**
 * Write the puzzle and (optionally) its undo history in one transaction, and queue it in
 * the outbox for the next Drive backup (one row per puzzle).
 */
export async function savePuzzle(p: Puzzle, history?: History): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['puzzles', 'history', 'outbox'], 'readwrite');
  const outbox = tx.objectStore('outbox');
  const queued = await outbox.index('puzzleId').getAllKeys(p.id);
  await Promise.all([
    tx.objectStore('puzzles').put(p),
    history ? tx.objectStore('history').put(history) : Promise.resolve(),
    ...queued.map((k) => outbox.delete(k)),
    outbox.add({ puzzleId: p.id, at: Date.now() }),
    tx.done,
  ]);
}

export async function deletePuzzle(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['puzzles', 'history', 'snapshots', 'outbox'], 'readwrite');
  const snapKeys = await tx.objectStore('snapshots').index('puzzleId').getAllKeys(id);
  const outKeys = await tx.objectStore('outbox').index('puzzleId').getAllKeys(id);
  await Promise.all([
    tx.objectStore('puzzles').delete(id),
    tx.objectStore('history').delete(id),
    ...snapKeys.map((k) => tx.objectStore('snapshots').delete(k)),
    ...outKeys.map((k) => tx.objectStore('outbox').delete(k)),
    tx.done,
  ]);
}

export async function duplicatePuzzle(p: Puzzle): Promise<Puzzle> {
  const now = new Date().toISOString();
  const copy: Puzzle = structuredClone({ ...p, id: uuid(), title: `${p.title} (copy)`, created: now, updated: now });
  await savePuzzle(copy);
  return copy;
}

/** Store a full copy of the puzzle; keeps the newest SNAPSHOT_CAP per puzzle. */
export async function addSnapshot(p: Puzzle, reason: Snapshot['reason']): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('snapshots', 'readwrite');
  await tx.store.add({ puzzleId: p.id, at: Date.now(), reason, puzzle: structuredClone(p) });
  const keys = await tx.store.index('puzzleId').getAllKeys(p.id);
  // keys are auto-increment, so ascending key order is oldest first
  keys.sort((a, b) => a - b);
  for (const k of keys.slice(0, Math.max(0, keys.length - SNAPSHOT_CAP))) await tx.store.delete(k);
  await tx.done;
}

export async function listSnapshots(puzzleId: string): Promise<Snapshot[]> {
  const all = await (await openDb()).getAllFromIndex('snapshots', 'puzzleId', puzzleId);
  return all.sort((a, b) => b.at - a.at);
}
