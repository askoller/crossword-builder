// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/data/db';
import { getPuzzle, listSnapshots, savePuzzle } from '../../src/data/puzzles';
import { authState } from '../../src/google/auth';
import { FOLDER_MIME } from '../../src/google/drive';
import { readPuz } from '../../src/model/puz';
import {
  backupStatus,
  createRootFolder,
  flushOutbox,
  getIds,
  listBackups,
  resolveFolders,
  restoreAll,
  restoreBackup,
  setDrive,
  useRootFolder,
} from '../../src/sync/backup';
import { FakeDrive, resetDb } from './fakeDrive';
import { fromRows } from './helpers';

let fake: FakeDrive;

beforeEach(async () => {
  await resetDb();
  fake = new FakeDrive();
  setDrive(fake.drive);
  authState.value = 'connected';
  backupStatus.value = { lastBackup: 0, pending: 0, busy: false, error: '', needsFolder: false };
});

const puzzle = (title = 'Test puzzle') => {
  const p = fromRows(['CAT', 'ARE', 'TEN']);
  p.title = title;
  return p;
};

const outboxSize = async () => (await (await openDb()).getAll('outbox')).length;

describe('Drive folder', () => {
  it('asks Andrew to choose when no app-made folder is visible, then creates on request', async () => {
    expect(await resolveFolders()).toBe(false);
    expect(backupStatus.value.needsFolder).toBe(true);
    const folders = await createRootFolder();
    expect(fake.byName('Crossword Builder')).toHaveLength(1);
    expect(fake.files.get(folders.puzzles)!.parents).toEqual([folders.root]);
    expect(backupStatus.value.needsFolder).toBe(false);
  });

  it('reuses a folder the app made earlier (after a reinstall)', async () => {
    const root = fake.add({ name: 'Crossword Builder', mimeType: FOLDER_MIME });
    expect(await resolveFolders()).toBe(true);
    expect((await getIds()).folders!.root).toBe(root.id);
    expect(fake.byName('Crossword Builder')).toHaveLength(1);
  });

  it('uses a picked folder as the root', async () => {
    const root = fake.add({ name: 'Crossword Builder', mimeType: FOLDER_MIME });
    await useRootFolder(root.id);
    expect(fake.byName('puzzles')[0].parents).toEqual([root.id]);
  });
});

describe('backup outbox', () => {
  beforeEach(async () => {
    await createRootFolder();
  });

  it('every local save queues the puzzle once', async () => {
    const p = puzzle();
    await savePuzzle(p);
    await savePuzzle({ ...p, title: 'Again' });
    expect(await outboxSize()).toBe(1);
  });

  it('uploads JSON + .puz into puzzles/ and empties the outbox', async () => {
    const p = puzzle('Tea Party');
    await savePuzzle(p);
    await flushOutbox();
    const base = `tea-party-${p.id.replace(/-/g, '').slice(0, 8)}`;
    const [json] = fake.byName(`${base}.json`);
    const [puzFile] = fake.byName(`${base}.puz`);
    expect(JSON.parse(fake.text(json.id)).id).toBe(p.id);
    expect(json.appProperties).toEqual({ puzzleId: p.id, kind: 'json' });
    expect(json.parents).toEqual([(await getIds()).folders!.puzzles]);
    const r = readPuz(puzFile.content);
    expect(r.checksumsOk).toBe(true);
    expect(r.solution).toBe('CATARETEN');
    expect(await outboxSize()).toBe(0);
    expect(backupStatus.value.lastBackup).toBeGreaterThan(0);
    expect(backupStatus.value.pending).toBe(0);
  });

  it('updates the same files in place, renaming with the title', async () => {
    const p = puzzle('First');
    await savePuzzle(p);
    await flushOutbox();
    const before = fake.files.size;
    await savePuzzle({ ...p, title: 'Second', cells: fromRows(['DOG', 'ARE', 'TEN']).cells });
    await flushOutbox();
    expect(fake.files.size).toBe(before);
    const json = [...fake.files.values()].find((f) => f.appProperties?.kind === 'json')!;
    expect(json.name).toMatch(/^second-/);
    expect(JSON.parse(fake.text(json.id)).cells[0].l).toBe('D');
  });

  it('finds earlier uploads by tag when the remembered ids are gone', async () => {
    const p = puzzle();
    await savePuzzle(p);
    await flushOutbox();
    const ids = await getIds();
    await (await openDb()).put('settings', { folders: ids.folders }, 'driveIds');
    const before = fake.files.size;
    await savePuzzle({ ...p, title: 'Edited' });
    await flushOutbox();
    expect(fake.files.size).toBe(before);
  });

  it('re-creates a file deleted in Drive', async () => {
    const p = puzzle();
    await savePuzzle(p);
    await flushOutbox();
    const json = [...fake.files.values()].find((f) => f.appProperties?.kind === 'json')!;
    json.trashed = true;
    await savePuzzle({ ...p, title: 'Back' });
    await flushOutbox();
    expect([...fake.files.values()].filter((f) => f.appProperties?.kind === 'json' && !f.trashed)).toHaveLength(1);
    expect(await outboxSize()).toBe(0);
  });

  it('keeps the outbox when offline, signed out, or paused', async () => {
    await savePuzzle(puzzle());
    for (const state of ['disconnected', 'paused'] as const) {
      authState.value = state;
      await flushOutbox();
      expect(await outboxSize()).toBe(1);
    }
    authState.value = 'connected';
    const online = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine');
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    try {
      await flushOutbox();
      expect(await outboxSize()).toBe(1);
      expect(fake.calls.filter((c) => c.url.includes('upload'))).toHaveLength(0);
    } finally {
      if (online) Object.defineProperty(globalThis.navigator, 'onLine', online);
      else delete (globalThis.navigator as { onLine?: boolean }).onLine;
    }
    await flushOutbox();
    expect(await outboxSize()).toBe(0);
  });

  it('a failed upload leaves the puzzle queued and reports the error', async () => {
    await savePuzzle(puzzle());
    const realFetch = fake.fetch.bind(fake);
    fake.fetch = async (url, init) => (url.includes('/upload/') ? new Response('{"error":{"message":"Server sad"}}', { status: 500 }) : realFetch(url, init));
    await flushOutbox();
    expect(await outboxSize()).toBe(1);
    expect(backupStatus.value.error).toBe('Server sad');
  });

  it('retries once with a renewed token on 401', async () => {
    await savePuzzle(puzzle());
    fake.unauthorized = 1;
    await flushOutbox();
    expect(fake.invalidated).toBe(1);
    expect(await outboxSize()).toBe(0);
  });

  it('edits made during an upload stay queued', async () => {
    const p = puzzle();
    await savePuzzle(p);
    const realFetch = fake.fetch.bind(fake);
    let edited = false;
    fake.fetch = async (url, init) => {
      if (!edited && url.includes('/upload/')) {
        edited = true;
        await new Promise((r) => setTimeout(r, 5));
        await savePuzzle({ ...p, title: 'Edited mid-upload' });
      }
      return realFetch(url, init);
    };
    await flushOutbox();
    expect(await outboxSize()).toBe(1);
  });
});

describe('restore', () => {
  beforeEach(async () => {
    await createRootFolder();
  });

  it('lists backups and restores one, keeping the phone copy as a snapshot', async () => {
    const p = puzzle('Keep me');
    await savePuzzle(p);
    await flushOutbox();
    await savePuzzle({ ...p, title: 'Local edit' });
    const list = await listBackups();
    expect(list).toHaveLength(1);
    expect(list[0].puzzleId).toBe(p.id);
    const restored = await restoreBackup(list[0].fileId);
    expect(restored.title).toBe('Keep me');
    expect((await getPuzzle(p.id))!.title).toBe('Keep me');
    const snaps = await listSnapshots(p.id);
    expect(snaps[0].puzzle.title).toBe('Local edit');
  });

  it('restores all puzzles after local data is deleted', async () => {
    const a = puzzle('A');
    const b = puzzle('B');
    await savePuzzle(a);
    await savePuzzle(b);
    await flushOutbox();
    const db = await openDb();
    await db.clear('puzzles');
    expect(await restoreAll()).toBe(2);
    expect((await getPuzzle(a.id))!.title).toBe('A');
    expect((await getPuzzle(b.id))!.title).toBe('B');
  });

  it('rejects files that are not puzzles', async () => {
    const folders = (await getIds()).folders!;
    const f = fake.add({ name: 'junk.json', parents: [folders.puzzles] }, '{"hello":1}');
    await expect(restoreBackup(f.id)).rejects.toThrow(/not a Crossword Builder puzzle/);
  });
});
