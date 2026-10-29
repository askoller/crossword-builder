import { useEffect, useState } from 'preact/hooks';
import { resetWordCache } from '../data/clues';
import { getSetting } from '../data/db';
import { importDataPack, type ImportProgress, type StoredManifest } from '../data/import';
import { classifyFiles, type DataPackFiles } from '../data/importCore';
import { authState } from '../google/auth';
import { backupStatus } from '../sync/backup';
import { importFromDrive } from '../sync/driveImport';
import { dataVersion, updateReady } from '../state/app';
import { FillSettingsSection } from './FillSettings';
import { DriveSection } from './Drive';

const PACK_FILES: [keyof DataPackFiles, string][] = [
  ['manifest', 'manifest.json'],
  ['words', 'words.tsv.gz'],
  ['clues', 'clues.json.gz'],
  ['myScores', 'my-scores.json'],
  ['notebook', 'notebook.json'],
];

function fmtYmd(n: number): string {
  const s = String(n);
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s;
}

export function Settings() {
  const [manifest, setManifest] = useState<StoredManifest | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [note, setNote] = useState('');
  /** local files picked so far, one role each (picking files one at a time adds to this) */
  const [staged, setStaged] = useState<Partial<Record<keyof DataPackFiles, File>>>({});

  useEffect(() => {
    void getSetting<StoredManifest>('manifest').then((m) => setManifest(m ?? null));
    void navigator.storage?.persisted?.().then(setPersisted);
  }, [dataVersion.value]);

  const run = async (job: () => Promise<unknown>, what = 'Data pack') => {
    setError('');
    setDone('');
    setProgress({ phase: 'words', fraction: 0, message: 'Starting' });
    try {
      const result = await job();
      if (result === null) return; // cancelled
      resetWordCache();
      dataVersion.value++;
      setDone(`${what} imported.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const onFiles = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    const roles = classifyFiles(files);
    const next = { ...staged };
    for (const [role, i] of Object.entries(roles) as [keyof DataPackFiles, number][]) if (i >= 0) next[role] = files[i];
    const unknown = files.length - Object.values(roles).filter((i) => i >= 0).length;
    setStaged(next);
    setDone('');
    setError('');
    setNote(unknown ? `${unknown} file${unknown > 1 ? 's are' : ' is'} not part of a data pack (expected ${PACK_FILES.map((f) => f[1]).join(', ')}).` : '');
  };

  const stagedCount = Object.keys(staged).length;
  const importStaged = () => {
    const files = { ...staged };
    setStaged({});
    setNote('');
    void run(() => importDataPack(files, setProgress), `${stagedCount} file${stagedCount > 1 ? 's' : ''}`);
  };

  const loadFixtures = () =>
    run(async () => {
      if (!import.meta.env.DEV) return;
      const { loadFixtures } = await import('../data/fixtures');
      await loadFixtures(setProgress);
    });

  return (
    <div class="screen settings">
      <header class="topbar">
        <h1>Settings</h1>
      </header>
      <div class="scroll">
        {updateReady.value && (
          <div class="notice">
            <span>Update available</span>
            <button class="btn primary small" onClick={() => updateReady.value?.()}>
              Reload
            </button>
          </div>
        )}

        <section class="card section">
          <h2>Data</h2>
          {manifest ? (
            <dl class="facts">
              <dt>Words</dt>
              <dd>
                {manifest.words.toLocaleString('en-US')} ({manifest.neverUse.toLocaleString('en-US')} never use)
              </dd>
              <dt>Clue history</dt>
              <dd>
                {manifest.clues.toLocaleString('en-US')} clues for {manifest.clueAnswers.toLocaleString('en-US')} answers
                {manifest.clueRange[0] > 0 && ` · ${fmtYmd(manifest.clueRange[0])} to ${fmtYmd(manifest.clueRange[1])}`}
              </dd>
              <dt>Built</dt>
              <dd>
                {manifest.built ? new Date(manifest.built).toLocaleString('en-US') : 'unknown'}
                {manifest.fixture && ' · test fixtures'}
              </dd>
              <dt>Imported</dt>
              <dd>{new Date(manifest.importedAt).toLocaleString('en-US')}</dd>
            </dl>
          ) : (
            <p class="muted">No data pack imported yet. Fill suggestions and clue history need it.</p>
          )}
          {progress ? (
            <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)}>
              <div class="progress-bar">
                <div style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
              </div>
              <div class="muted small">{progress.message}</div>
            </div>
          ) : (
            <div class="button-col">
              {authState.value === 'connected' && !backupStatus.value.needsFolder && (
                <button class="btn primary" onClick={() => void run(() => importFromDrive(setProgress))}>
                  {manifest ? 'Re-import data pack from Google Drive' : 'Import data pack from Google Drive'}
                </button>
              )}
              <label class={`btn file-btn${authState.value === 'connected' ? '' : ' primary'}`}>
                {stagedCount ? 'Add another file' : manifest ? 'Re-import from files on this phone' : 'Import from files on this phone'}
                <input type="file" multiple accept=".gz,.json,application/gzip,application/json" onChange={onFiles} />
              </label>
              {stagedCount > 0 ? (
                <>
                  <ul class="pack-files" aria-label="Files to import">
                    {PACK_FILES.map(([role, name]) => (
                      <li key={role} class={staged[role] ? 'on' : ''}>
                        <span class="mono">{name}</span>
                        <span class="muted small">{staged[role] ? 'ready' : 'not picked · keeps what is stored'}</span>
                      </li>
                    ))}
                  </ul>
                  <div class="row">
                    <button class="btn primary" onClick={importStaged}>
                      Import {stagedCount} file{stagedCount > 1 ? 's' : ''}
                    </button>
                    <button class="btn" onClick={() => setStaged({})}>
                      Clear
                    </button>
                  </div>
                </>
              ) : (
                <p class="muted small">
                  {authState.value === 'connected'
                    ? 'Google Drive imports every file in Crossword Builder/data. From the phone, pick the files one at a time or several at once, then tap Import.'
                    : 'Pick manifest.json, words.tsv.gz, clues.json.gz, my-scores.json and notebook.json one at a time or several at once, then tap Import. Files you leave out keep what is stored.'}
                </p>
              )}
              {import.meta.env.DEV && (
                <button class="btn" onClick={loadFixtures}>
                  Load fixtures (dev)
                </button>
              )}
            </div>
          )}
          {note && <p class="warn-text">{note}</p>}
          {error && <p class="warn-text">Import failed: {error}</p>}
          {done && !error && <p class="ok-text">{done}</p>}
        </section>

        <DriveSection />

        <FillSettingsSection neverUseInPack={manifest?.neverUse} />

        <section class="card section">
          <h2>Storage</h2>
          <p>
            {persisted === null
              ? 'Checking storage…'
              : persisted
                ? 'Persistent storage is on: the browser will not clear your puzzles to free space.'
                : 'Persistent storage was not granted. Install the app to the home screen to protect your puzzles.'}
          </p>
        </section>

        <section class="card section">
          <h2>About</h2>
          <p class="muted">Crossword Builder {__APP_VERSION__}</p>
        </section>
      </div>
    </div>
  );
}
