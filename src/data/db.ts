// IndexedDB schema (SPEC §5.1).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { History } from '../model/history';
import type { Puzzle } from '../model/types';

/** One word length of the lexicon, packed for fast loading into the engine. */
export interface LexiconChunk {
  len: number;
  count: number;
  /** all words of this length concatenated, upper case */
  words: string;
  /** 1–60; 1 = never use */
  score: Uint8Array;
  /** NYT appearances */
  nyt: Uint16Array;
  /** last NYT year, 0 = never */
  last: Uint16Array;
}

/** [clue, yyyymmdd, weekday 0 = Monday] */
export type ClueEntry = [string, number, number];

export interface Snapshot {
  id?: number;
  puzzleId: string;
  at: number;
  reason: 'interval' | 'autofill' | 'manual' | 'import';
  puzzle: Puzzle;
}

export interface OutboxItem {
  id?: number;
  puzzleId: string;
  at: number;
}

export interface CBSchema extends DBSchema {
  puzzles: { key: string; value: Puzzle; indexes: { updated: string } };
  history: { key: string; value: History };
  snapshots: { key: number; value: Snapshot; indexes: { puzzleId: string } };
  lexicon: { key: number; value: LexiconChunk };
  clues: { key: string; value: ClueEntry[] };
  notebook: { key: string; value: unknown };
  settings: { key: string; value: unknown };
  outbox: { key: number; value: OutboxItem; indexes: { puzzleId: string } };
}

export type CBDatabase = IDBPDatabase<CBSchema>;

export const DB_NAME = 'crossword-builder';
export const DB_VERSION = 1;

let dbPromise: Promise<CBDatabase> | null = null;

export function openDb(): Promise<CBDatabase> {
  dbPromise ??= openDB<CBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const puzzles = db.createObjectStore('puzzles', { keyPath: 'id' });
      puzzles.createIndex('updated', 'updated');
      db.createObjectStore('history', { keyPath: 'puzzleId' });
      const snaps = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
      snaps.createIndex('puzzleId', 'puzzleId');
      db.createObjectStore('lexicon', { keyPath: 'len' });
      db.createObjectStore('clues');
      db.createObjectStore('notebook');
      db.createObjectStore('settings');
      const outbox = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      outbox.createIndex('puzzleId', 'puzzleId');
    },
  });
  return dbPromise;
}

/** Close and forget the connection (tests, and before deleting the database). */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await (await openDb()).get('settings', key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await openDb()).put('settings', value, key);
}
