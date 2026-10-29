// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSetting, openDb } from '../../src/data/db';
import { runImport, type StoredManifest } from '../../src/data/importCore';
import type { DataPackInput } from '../../src/data/import';
import { FOLDER_MIME } from '../../src/google/drive';
import { createRootFolder, getIds, setDrive } from '../../src/sync/backup';
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

const load = (n: string) => new Uint8Array(readFileSync(join(FIXTURES, n)));

function pickers(folder: { id: string; name: string } | null = null, files: { id: string; name: string }[] = []) {
  return { folder: vi.fn(async () => folder), files: vi.fn(async () => files) };
}

describe('data pack import from Drive', () => {
  it('imports every data pack file in Crossword Builder/data without a Picker', async () => {
    const { root } = await createRootFolder();
    const data = fake.add({ name: 'data', mimeType: FOLDER_MIME, parents: [root] });
    for (const n of NAMES) fake.add({ name: n, parents: [data.id] }, load(n));
    fake.add({ name: 'README.txt', parents: [data.id] }, 'not part of the pack');
    const pick = pickers();
    const fractions: number[] = [];
    const m = (await importFromDrive((p) => fractions.push(p.fraction), fake.drive, importer, pick)) as StoredManifest;
    expect(pick.folder).not.toHaveBeenCalled();
    expect(pick.files).not.toHaveBeenCalled();
    expect(m.fixture).toBe(true);
    expect((await getSetting<StoredManifest>('manifest'))!.words).toBe(m.words);
    expect(await (await openDb()).count('lexicon')).toBeGreaterThan(0);
    expect(await (await openDb()).get('clues', 'ERA')).toBeTruthy();
    expect(fractions[0]).toBe(0);
    expect(Math.max(...fractions)).toBeLessThanOrEqual(1);
    expect((await getIds()).data).toBe(data.id);
  });

  it('takes the newest file when a name appears twice', async () => {
    const { root } = await createRootFolder();
    const data = fake.add({ name: 'data', mimeType: FOLDER_MIME, parents: [root] });
    fake.add({ name: 'manifest.json', parents: [data.id], modifiedTime: '2026-01-01T00:00:00Z' }, JSON.stringify({ ...JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')), built: 'old' }));
    fake.add({ name: 'manifest.json', parents: [data.id], modifiedTime: '2026-06-01T00:00:00Z' }, load('manifest.json'));
    const m = (await importFromDrive(() => {}, fake.drive, importer, pickers()))!;
    expect(m.built).not.toBe('old');
  });

  it('asks for the data folder once when the app cannot see it, then lists it', async () => {
    const { root } = await createRootFolder();
    // The laptop made data/, so under drive.file findFolder('data') can't see it (the
    // fake has no permissions; a different name stands in for that).
    const data = fake.add({ name: 'data-laptop', mimeType: FOLDER_MIME, parents: [root] });
    for (const n of NAMES) fake.add({ name: n, parents: [data.id] }, load(n));
    const pick = pickers({ id: data.id, name: 'data' });
    const m = (await importFromDrive(() => {}, fake.drive, importer, pick))!;
    expect(pick.folder).toHaveBeenCalledWith(expect.any(String), undefined, root);
    expect(pick.files).not.toHaveBeenCalled();
    expect(m.fixture).toBe(true);
    // Remembered: the next import needs no Picker.
    const again = pickers();
    await importFromDrive(() => {}, fake.drive, importer, again);
    expect(again.folder).not.toHaveBeenCalled();
  });

  it('falls back to selecting the files when the picked folder still lists nothing', async () => {
    const { root } = await createRootFolder();
    const data = fake.add({ name: 'data', mimeType: FOLDER_MIME, parents: [root] });
    const hidden = NAMES.map((n) => fake.add({ name: n, parents: ['elsewhere'] }, load(n)));
    const pick = pickers({ id: data.id, name: 'data' }, hidden.map((f) => ({ id: f.id, name: f.name })));
    const m = (await importFromDrive(() => {}, fake.drive, importer, pick))!;
    expect(pick.files).toHaveBeenCalledWith(expect.any(String), data.id);
    expect(m.fixture).toBe(true);
  });

  it('returns null when the folder Picker is cancelled', async () => {
    await createRootFolder();
    expect(await importFromDrive(() => {}, fake.drive, importer, pickers())).toBeNull();
  });

  it('needs the Crossword Builder folder first', async () => {
    await expect(importFromDrive(() => {}, fake.drive, importer, pickers())).rejects.toThrow(/Crossword Builder folder/);
  });
});
