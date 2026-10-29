// New puzzle → Import: a .puz from the phone's files or from Google Drive (Picker).
import { useMemo, useState } from 'preact/hooks';
import { authState } from '../google/auth';
import { pickFiles } from '../google/picker';
import { importGridFile, type ImportedGrid, type ImportOptions } from '../model/importGrid';
import { getDrive } from '../sync/backup';
import { Chips } from './common';
import { Thumb } from './Grid';

export const IMPORT_ACCEPT = '.puz,application/x-crossword';

export interface LoadedFile {
  name: string;
  bytes: Uint8Array;
}

/** Parse the loaded file with the dialog's current options; errors become a message. */
export function useImported(file: LoadedFile | null, o: ImportOptions): { result: ImportedGrid | null; error: string } {
  return useMemo(() => {
    if (!file) return { result: null, error: '' };
    try {
      return { result: importGridFile(file.name, file.bytes, o), error: '' };
    } catch (e) {
      return { result: null, error: `${file.name}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }, [file, o.day, o.outlet, o.title, o.lock]);
}

export function ImportGridPane({
  file,
  setFile,
  lock,
  setLock,
  result,
  error,
}: {
  file: LoadedFile | null;
  setFile: (f: LoadedFile | null) => void;
  lock: boolean;
  setLock: (b: boolean) => void;
  result: ImportedGrid | null;
  error: string;
}) {
  const [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState('');

  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setLoadError('');
    setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  };

  const fromDrive = async () => {
    setLoadError('');
    setBusy('Opening Google Drive');
    try {
      const [doc] = await pickFiles('Choose a .puz file');
      if (!doc) return;
      setBusy(`Downloading ${doc.name}`);
      const blob = await getDrive().download(doc.id);
      setFile({ name: doc.name, bytes: new Uint8Array(await blob.arrayBuffer()) });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div class="import-grid">
      <div class="row wrap">
        <label class={`btn file-btn${file ? '' : ' primary'}`}>
          {file ? 'Choose another file' : 'From phone files'}
          <input type="file" accept={IMPORT_ACCEPT} aria-label="Crossword file" onChange={onFile} />
        </label>
        {authState.value === 'connected' && (
          <button class="btn" disabled={!!busy} onClick={() => void fromDrive()}>
            From Google Drive
          </button>
        )}
      </div>
      {busy && <p class="muted small">{busy}…</p>}
      {!file && !busy && <p class="muted small">Across Lite .puz: grid, letters, clues, circles and rebus squares.</p>}
      {(loadError || error) && <p class="warn-text">{loadError || error}</p>}
      {result && (
        <div class="card import-preview">
          <Thumb cells={result.puzzle.cells} width={result.puzzle.width} height={result.puzzle.height} size={72} />
          <div>
            <div class="strong title-line">{result.puzzle.title}</div>
            <div class="muted small">{file?.name}</div>
            <div class="small">{result.summary}</div>
          </div>
        </div>
      )}
      {result && result.skipped.length > 0 && (
        <div class="notice-inline" role="note">
          <span class="strong">Not imported</span>
          <ul>
            {result.skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      <label class="label">Imported letters</label>
      <Chips
        label="Imported letters"
        options={[
          { value: 'open', label: 'Editable' },
          { value: 'lock', label: 'Locked' },
        ]}
        value={lock ? 'lock' : 'open'}
        onChange={(v) => setLock(v === 'lock')}
      />
      {lock && <p class="muted small">Locked letters show as theme letters; typing and autofill leave them alone. Unlock a word later with long-press Block → Lock word.</p>}
    </div>
  );
}
