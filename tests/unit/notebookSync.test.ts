// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { setSetting } from '../../src/data/db';
import { deleteItem, readNotebook, saveAnswer } from '../../src/data/notebook';
import { authState } from '../../src/google/auth';
import type { NotebookFile } from '../../src/model/notebook';
import { createRootFolder, getIds, setDrive } from '../../src/sync/backup';
import { notebookSyncStatus, syncNotebook } from '../../src/sync/notebookSync';
import { FakeDrive, resetDb } from './fakeDrive';

let fake: FakeDrive;
let root: string;

const ans = (answer: string, updated: number, boost = 50) => ({ answer, clues: [`idea ${updated}`], boost, note: '', updated });

const pack: NotebookFile = {
  clues: [ans('BAGEL', 100)],
  themes: [{ id: 't1', title: 'Pack theme', description: '', revealer: null, entries: [], updated: 100 }],
  deleted: [],
  synced: 0,
};

beforeEach(async () => {
  await resetDb();
  fake = new FakeDrive();
  setDrive(fake.drive);
  authState.value = 'connected';
  root = (await createRootFolder()).root;
});

const remoteFile = () => fake.byName('notebook.json')[0];
const remote = () => JSON.parse(fake.text(remoteFile().id)) as NotebookFile;

describe('notebook sync (SPEC §5.4)', () => {
  it('creates notebook.json from the data pack notebook plus local edits when missing', async () => {
    await setSetting('datapackNotebook', pack);
    await saveAnswer(ans('ERA', 0), undefined, 500);
    await syncNotebook();
    const f = remoteFile();
    expect(f.parents).toEqual([root]);
    expect(remote().clues.map((c) => c.answer).sort()).toEqual(['BAGEL', 'ERA']);
    expect(remote().themes.map((t) => t.id)).toEqual(['t1']);
    expect((await getIds()).notebook).toBe(f.id);
    expect((await readNotebook()).clues.map((c) => c.answer).sort()).toEqual(['BAGEL', 'ERA']);
    expect(notebookSyncStatus.value.at).toBeGreaterThan(0);
  });

  it('merges both ways and writes back in place (same file id)', async () => {
    const f = fake.add({ name: 'notebook.json', parents: [root], mimeType: 'application/json' }, JSON.stringify({ ...pack, clues: [ans('BAGEL', 900, 80), ans('OREO', 200)] }));
    await saveAnswer(ans('BAGEL', 0, 10), undefined, 300); // older than ThemeFill's edit
    await saveAnswer(ans('ERA', 0), undefined, 400); // only on the phone
    await syncNotebook();
    expect(fake.byName('notebook.json')).toHaveLength(1);
    expect(remoteFile().id).toBe(f.id);
    const local = await readNotebook();
    const bagel = local.clues.find((c) => c.answer === 'BAGEL')!;
    expect(bagel.boost).toBe(80);
    expect(local.clues.map((c) => c.answer).sort()).toEqual(['BAGEL', 'ERA', 'OREO']);
    expect(remote().clues.map((c) => c.answer).sort()).toEqual(['BAGEL', 'ERA', 'OREO']);
  });

  it('tombstones travel both ways', async () => {
    fake.add({ name: 'notebook.json', parents: [root] }, JSON.stringify({ ...pack, clues: [ans('BAGEL', 100), ans('OREO', 100)], deleted: [{ key: 'theme:t1', at: 200 }] }));
    await syncNotebook();
    expect((await readNotebook()).themes).toHaveLength(0);
    await deleteItem('answer:OREO', 300);
    await syncNotebook();
    expect(remote().clues.map((c) => c.answer)).toEqual(['BAGEL']);
    expect(remote().deleted).toEqual(expect.arrayContaining([{ key: 'answer:OREO', at: 300 }, { key: 'theme:t1', at: 200 }]));
  });

  it('does not rewrite the file when nothing changed', async () => {
    fake.add({ name: 'notebook.json', parents: [root] }, JSON.stringify(pack));
    await syncNotebook();
    await syncNotebook();
    expect(fake.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('re-creates the file if it was deleted in Drive', async () => {
    await syncNotebook();
    remoteFile().trashed = true;
    await saveAnswer(ans('ERA', 0), undefined, 400);
    await syncNotebook();
    expect(fake.byName('notebook.json')).toHaveLength(1);
    expect(remote().clues.map((c) => c.answer)).toEqual(['ERA']);
  });

  it('does nothing when not connected', async () => {
    authState.value = 'paused';
    const n = fake.calls.length;
    await syncNotebook();
    expect(fake.calls.length).toBe(n);
  });

  it('reports a broken remote file without touching the local notebook', async () => {
    fake.add({ name: 'notebook.json', parents: [root] }, 'not json');
    await saveAnswer(ans('ERA', 0), undefined, 400);
    await syncNotebook();
    expect(notebookSyncStatus.value.error).not.toBe('');
    expect((await readNotebook()).clues.map((c) => c.answer)).toEqual(['ERA']);
  });
});
