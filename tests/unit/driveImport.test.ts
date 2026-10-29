// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSetting, openDb } from '../../src/data/db';
import { runImport, type StoredManifest } from '../../src/data/importCore';
import type { DataPackInput } from '../../src/data/import';
import { FOLDER_MIME } from '../../src/google/drive';
import { createRootFolder, setDrive } from '../../src/sync/backup';
import { importFromDrive } from '../../src/sync/driveImport';
import { FakeDrive, resetDb } from './fakeDrive';
import { FIXTURES } from './helpers';

const NAMES = ['manifest.json', 'words.tsv.gz', 'clues.json.gz', 'my-scores.json', 'notebook.json'];

// The app runs importDataPack in a worker; here the same core runs directly.
const importer = (input: DataPackInput, onProgress?: Parameters<typeof runImport>[1]) => {
  const files = input as File[];
  const role = (n: string) => files.find((f) => f.name === n);
  return runImport({ manifest: role('manifest.json'), words: role('words.tsv.gz'), clues: role('clues.json.gz'), myScores: role('my-scores.json'), notebook: role('notebook.json') }, onProgress ?? (() => {}));
};

let fake: FakeDrive;

beforeEach(async () => {
  await resetDb();
  fake = new FakeDrive();
  setDrive(fake.drive);
});

describe('data pack import from Drive (Picker)', () => {
  it('downloads the picked files and runs the normal import', async () => {
    const { root } = await createRootFolder();
    const data = fake.add({ name: 'data', mimeType: FOLDER_MIME, parents: [root] });
    const picked = NAMES.map((n) => fake.add({ name: n, parents: [data.id] }, new Uint8Array(readFileSync(join(FIXTURES, n)))));
    const pick = vi.fn(async () => picked.map((f) => ({ id: f.id, name: f.name })));
    const fractions: number[] = [];
    const m = (await importFromDrive((p) => fractions.push(p.fraction), pick, fake.drive, importer)) as StoredManifest;
    expect(pick).toHaveBeenCalledWith(expect.any(String), data.id);
    expect(m.fixture).toBe(true);
    expect((await getSetting<StoredManifest>('manifest'))!.words).toBe(m.words);
    expect(await (await openDb()).count('lexicon')).toBeGreaterThan(0);
    expect(fractions[0]).toBe(0);
    expect(Math.max(...fractions)).toBeLessThanOrEqual(1);
  });

  it('opens at the root folder when the data folder is not visible to the app', async () => {
    const { root } = await createRootFolder();
    const pick = vi.fn(async () => []);
    expect(await importFromDrive(() => {}, pick, fake.drive, importer)).toBeNull();
    expect(pick).toHaveBeenCalledWith(expect.any(String), root);
  });
});
