// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, DB_NAME, getSetting, openDb } from '../../src/data/db';
import { classifyFiles, lexiconWord, parseWords, runImport, type StoredManifest } from '../../src/data/importCore';
import { FIXTURES } from './helpers';

const blob = (name: string) => new Blob([readFileSync(join(FIXTURES, name))]);

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('data pack import', () => {
  it('parses words.tsv into packed per-length chunks', () => {
    const chunks = parseWords('word\tscore\tnyt\tlast\nCAT\t45\t120\t2024\nDOG\t1\t3\t\nbad\t40\t0\t\nTOOLONGWORDTOOLONGWORDX\t40\t0\t\nAREA\t44\t300\t2025\n');
    const three = chunks.get(3)!;
    expect(three.count).toBe(2);
    expect(lexiconWord(three, 1)).toBe('DOG');
    expect([...three.score]).toEqual([45, 1]);
    expect([...three.last]).toEqual([2024, 0]);
    expect(chunks.get(4)!.words).toBe('AREA');
    expect(chunks.has(23)).toBe(false);
  });

  it('classifies picked files by name', () => {
    const roles = classifyFiles([{ name: 'clues.json.gz' }, { name: 'manifest.json' }, { name: 'words.tsv.gz' }, { name: 'notebook.json' }]);
    expect(roles).toEqual({ manifest: 1, words: 2, clues: 0, myScores: -1, notebook: 3 });
  });

  it('imports the fixtures into IndexedDB', async () => {
    const phases: string[] = [];
    const m = await runImport(
      {
        manifest: blob('manifest.json'),
        words: blob('words.tsv.gz'),
        clues: blob('clues.json.gz'),
        myScores: blob('my-scores.json'),
        notebook: blob('notebook.json'),
      },
      (p) => phases.push(p.phase),
    );
    expect(phases.at(-1)).toBe('done');
    const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8'));
    expect(m!.words).toBe(manifest.words);
    expect((await getSetting<StoredManifest>('manifest'))!.clues).toBe(manifest.clues);

    const db = await openDb();
    let total = 0;
    for (const c of await db.getAll('lexicon')) total += c.count;
    expect(total).toBe(manifest.words);
    const five = (await db.get('lexicon', 5))!;
    const words = Array.from({ length: five.count }, (_, i) => lexiconWord(five, i));
    expect(words[words.indexOf('BAGEL')]).toBe('BAGEL');
    expect(five.score[words.indexOf('BAGEL')]).toBe(50);

    const era = (await db.get('clues', 'ERA'))!;
    expect(era.length).toBeGreaterThan(1);
    expect(era[0][1]).toBeGreaterThanOrEqual(era[1][1]); // newest first
    expect(await db.count('clues')).toBe(manifest.clueAnswers);
    expect(await db.get('notebook', 'answer:TEAPARTY')).toBeTruthy();
    expect(await db.get('notebook', 'theme:fixture-theme-1')).toBeTruthy();
  });
});
