// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { getClueHistory, resetWordCache, suggestAnswers, wordFacts } from '../../src/data/clues';
import { closeDb, DB_NAME } from '../../src/data/db';
import { runImport } from '../../src/data/importCore';
import { addClueIdea, deleteItem, getAnswer, mergeIntoLocal, notebookBoosts, readNotebook, saveAnswer, saveTheme } from '../../src/data/notebook';
import { FIXTURES } from './helpers';

const blob = (name: string) => new Blob([readFileSync(join(FIXTURES, name))]);

beforeEach(async () => {
  await closeDb();
  resetWordCache();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('local notebook store', () => {
  it('seeds from the data pack and reads back as a notebook file', async () => {
    await runImport({ notebook: blob('notebook.json') });
    const nb = await readNotebook();
    expect(nb.clues.map((c) => c.answer).sort()).toEqual(['BAGEL', 'TEA PARTY']);
    expect(nb.themes[0].id).toBe('fixture-theme-1');
    expect((await notebookBoosts()).get('TEAPARTY')).toBe(70);
  });

  it('renaming an answer tombstones the old key; deleting leaves a tombstone', async () => {
    await saveAnswer({ answer: 'tea  party', clues: [], boost: 60, note: '' }, undefined, 100);
    expect((await getAnswer('TEAPARTY'))!.answer).toBe('TEA PARTY');
    await saveAnswer({ answer: 'TEA PARTIES', clues: [], boost: 60, note: '' }, 'TEA PARTY', 200);
    let nb = await readNotebook();
    expect(nb.clues.map((c) => c.answer)).toEqual(['TEA PARTIES']);
    expect(nb.deleted).toEqual([{ key: 'answer:TEAPARTY', at: 200 }]);
    await deleteItem('answer:TEAPARTIES', 300);
    nb = await readNotebook();
    expect(nb.clues).toEqual([]);
    expect(nb.deleted.map((d) => d.key).sort()).toEqual(['answer:TEAPARTIES', 'answer:TEAPARTY']);
    // saving again clears the tombstone
    await saveAnswer({ answer: 'TEA PARTY', clues: [], boost: 1, note: '' }, undefined, 400);
    expect((await readNotebook()).deleted.map((d) => d.key)).toEqual(['answer:TEAPARTIES']);
  });

  it('adds clue ideas without duplicates', async () => {
    await addClueIdea('ERA', 'Long stretch');
    await addClueIdea('ERA', 'Long stretch');
    await addClueIdea('ERA', 'Pitcher’s stat');
    expect((await getAnswer('ERA'))!.clues).toEqual(['Long stretch', 'Pitcher’s stat']);
  });

  it('merges a remote notebook into the local one', async () => {
    await saveAnswer({ answer: 'BAGEL', clues: ['local'], boost: 40, note: '' }, undefined, 100);
    await saveTheme({ id: 't1', title: 'Local', description: '', revealer: null, entries: [] }, 100);
    const merged = await mergeIntoLocal(
      { clues: [{ answer: 'BAGEL', clues: ['remote'], boost: 40, note: '', updated: 200 }], themes: [], deleted: [{ key: 'theme:t1', at: 150 }] },
      999,
    );
    expect(merged.synced).toBe(999);
    const nb = await readNotebook();
    expect(nb.clues[0].clues).toEqual(['remote']);
    expect(nb.themes).toEqual([]);
    expect(nb.synced).toBe(999);
  });
});

describe('clue history and word facts', () => {
  it('looks up history per answer, suggests answers and reads word facts', async () => {
    await runImport({ words: blob('words.tsv.gz'), clues: blob('clues.json.gz') });
    expect((await getClueHistory('era')).length).toBeGreaterThan(1);
    expect(await getClueHistory('QQQQ')).toEqual([]);
    const s = await suggestAnswers('er');
    expect(s).toContain('ERA');
    expect(s.every((a) => a.startsWith('ER'))).toBe(true);
    expect((await wordFacts('bagel'))!.score).toBe(50);
    expect(await wordFacts('QZXQZ')).toBeNull();
    expect(await wordFacts('AB')).toBeNull();
  });
});
