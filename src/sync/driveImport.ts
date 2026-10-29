// Data pack import from Google Drive (SPEC §3.9): Andrew picks the files in
// "Crossword Builder/data" with the Picker; they are downloaded and handed to the same
// importDataPack() that local files use.
import { importDataPack, type ImportProgress, type StoredManifest } from '../data/import';
import type { Drive } from '../google/drive';
import { pickFiles, type PickedDoc } from '../google/picker';
import { getDrive, getIds } from './backup';

export type Picker = (title: string, parent?: string) => Promise<PickedDoc[]>;
export type Importer = typeof importDataPack;

/** The data folder if this app can see it, else the root folder, else nothing. */
async function startFolder(d: Drive): Promise<string | undefined> {
  const root = (await getIds()).folders?.root;
  if (!root) return undefined;
  try {
    return (await d.findFolder('data', root))?.id ?? root;
  } catch {
    return root;
  }
}

/**
 * Returns null when Andrew cancels the Picker. Downloads count as the first 30% of the
 * progress bar; the import itself reports the rest.
 */
export async function importFromDrive(
  onProgress: (p: ImportProgress) => void,
  pick: Picker = pickFiles,
  d: Drive = getDrive(),
  run: Importer = importDataPack,
): Promise<StoredManifest | null> {
  const docs = await pick('Pick the data pack files in Crossword Builder/data', await startFolder(d));
  if (!docs.length) return null;
  const files: File[] = [];
  for (const [i, doc] of docs.entries()) {
    onProgress({ phase: 'words', fraction: (0.3 * i) / docs.length, message: `Downloading ${doc.name}` });
    files.push(new File([await d.download(doc.id)], doc.name));
  }
  return run(files, (p) => onProgress({ ...p, fraction: 0.3 + 0.7 * p.fraction }));
}
