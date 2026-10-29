// Dev-only: load the synthetic fixtures through the real data pack import path.
// Only imported behind `import.meta.env.DEV`, so production builds don't include it.
import manifestUrl from '../../fixtures/manifest.json?url';
import wordsUrl from '../../fixtures/words.tsv.gz?url';
import cluesUrl from '../../fixtures/clues.json.gz?url';
import myScoresUrl from '../../fixtures/my-scores.json?url';
import notebookUrl from '../../fixtures/notebook.json?url';
import type { Puzzle } from '../model/types';
import { importDataPack, type ImportProgress } from './import';
import { savePuzzle } from './puzzles';

const grids = import.meta.glob<Puzzle>('../../fixtures/grids/*.json', { eager: true, import: 'default' });

async function named(url: string, name: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${name}`);
  return new File([await res.blob()], name);
}

export async function loadFixtures(onProgress: (p: ImportProgress) => void): Promise<void> {
  const files = await Promise.all([
    named(manifestUrl, 'manifest.json'),
    named(wordsUrl, 'words.tsv.gz'),
    named(cluesUrl, 'clues.json.gz'),
    named(myScoresUrl, 'my-scores.json'),
    named(notebookUrl, 'notebook.json'),
  ]);
  await importDataPack(files, onProgress);
  for (const g of Object.values(grids)) await savePuzzle(structuredClone(g));
}
