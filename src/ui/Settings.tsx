import { useEffect, useState } from 'preact/hooks';
import { resetWordCache } from '../data/clues';
import { getSetting } from '../data/db';
import { importDataPack, type ImportProgress, type StoredManifest } from '../data/import';
import { dataVersion, updateReady } from '../state/app';
import { IconCloud } from './icons';

function fmtYmd(n: number): string {
  const s = String(n);
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s;
}

export function Settings() {
  const [manifest, setManifest] = useState<StoredManifest | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void getSetting<StoredManifest>('manifest').then((m) => setManifest(m ?? null));
    void navigator.storage?.persisted?.().then(setPersisted);
  }, [dataVersion.value]);

  const run = async (job: () => Promise<unknown>) => {
    setError('');
    setProgress({ phase: 'words', fraction: 0, message: 'Starting' });
    try {
      await job();
      resetWordCache();
      dataVersion.value++;
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
    if (files.length) void run(() => importDataPack(files, setProgress));
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
              <label class="btn primary file-btn">
                {manifest ? 'Re-import data pack from files' : 'Import data pack from files'}
                <input type="file" multiple accept=".gz,.json,application/gzip,application/json" onChange={onFiles} />
              </label>
              <p class="muted small">Pick manifest.json, words.tsv.gz, clues.json.gz, my-scores.json and notebook.json from the Crossword Builder/data folder.</p>
              {import.meta.env.DEV && (
                <button class="btn" onClick={loadFixtures}>
                  Load fixtures (dev)
                </button>
              )}
            </div>
          )}
          {error && <p class="warn-text">Import failed: {error}</p>}
        </section>

        <section class="card section">
          <h2>Google Drive</h2>
          <div class="row">
            <IconCloud />
            <div>
              <div class="strong">Not connected</div>
              <div class="muted small">Backup to the Crossword Builder folder is coming in a later update.</div>
            </div>
          </div>
        </section>

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
