// Data pack import from Google Drive (SPEC §3.9) in one step: every data pack file in
// "Crossword Builder/data" is downloaded and handed to the same importDataPack() that
// local files use. Under drive.file the app may not see files the laptop put there, so
// when the folder looks empty Andrew picks the data folder once in the Picker (which
// shares it with the app); if its files still can't be listed, he selects them instead.
import { classifyFiles } from '../data/importCore';
import { importDataPack, type ImportProgress, type StoredManifest } from '../data/import';
import { FOLDER_MIME, q, type Drive, type DriveFile } from '../google/drive';
import { pickFiles, pickFolder, type PickedDoc } from '../google/picker';
import { FolderNotSet, getDrive, getIds, setIds } from './backup';

export interface Pickers {
  folder(title: string, query?: string, parent?: string): Promise<PickedDoc | null>;
  files(title: string, parent?: string): Promise<PickedDoc[]>;
}
export type Importer = typeof importDataPack;

const defaultPickers: Pickers = { folder: pickFolder, files: pickFiles };

/** The data pack files in a folder, newest first wins when a name appears twice. */
export async function listDataPack(d: Drive, folder: string): Promise<DriveFile[]> {
  const files = (await d.list(`${q(folder)} in parents and trashed = false`))
    .filter((f) => f.mimeType !== FOLDER_MIME)
    .sort((a, b) => (a.modifiedTime ?? '').localeCompare(b.modifiedTime ?? ''));
  return Object.values(classifyFiles(files))
    .filter((i) => i >= 0)
    .map((i) => files[i]);
}

/**
 * Returns null when Andrew cancels a Picker. Downloads count as the first 30% of the
 * progress bar; the import itself reports the rest.
 */
export async function importFromDrive(
  onProgress: (p: ImportProgress) => void,
  d: Drive = getDrive(),
  run: Importer = importDataPack,
  pick: Pickers = defaultPickers,
): Promise<StoredManifest | null> {
  const ids = await getIds();
  const root = ids.folders?.root;
  if (!root) throw new FolderNotSet('Choose the Crossword Builder folder in Settings first');
  onProgress({ phase: 'words', fraction: 0, message: 'Looking in Crossword Builder/data' });

  let dataId = ids.data;
  if (dataId) {
    try {
      await d.get(dataId);
    } catch {
      dataId = undefined;
    }
  }
  dataId ??= (await d.findFolder('data', root))?.id;
  let docs: PickedDoc[] = dataId ? await listDataPack(d, dataId) : [];

  if (!docs.length) {
    const folder = await pick.folder('Choose the data folder in Crossword Builder', undefined, root);
    if (!folder) return null;
    dataId = folder.id;
    docs = await listDataPack(d, dataId);
  }
  if (dataId !== ids.data) await setIds({ ...(await getIds()), data: dataId });
  if (!docs.length) {
    docs = await pick.files('Select all the files in Crossword Builder/data', dataId);
    if (!docs.length) return null;
  }

  const files: File[] = [];
  for (const [i, doc] of docs.entries()) {
    onProgress({ phase: 'words', fraction: (0.3 * i) / docs.length, message: `Downloading ${doc.name} (${i + 1} of ${docs.length})` });
    files.push(new File([await d.download(doc.id)], doc.name));
  }
  return run(files, (p) => onProgress({ ...p, fraction: 0.3 + 0.7 * p.fraction }));
}
