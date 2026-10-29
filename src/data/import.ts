// The one import entry point for data packs: local files (Settings), the Google Drive
// Picker (session 4) and the dev-only "Load fixtures" button all call importDataPack.
import { classifyFiles, runImport, type DataPackFiles, type ImportProgress, type StoredManifest } from './importCore';

export type { DataPackFiles, ImportProgress, StoredManifest };

/** Accepts File/Blob objects with names (any order) or an already classified set. */
export type DataPackInput = DataPackFiles | (Blob & { name: string })[];

function toFiles(input: DataPackInput): DataPackFiles {
  if (!Array.isArray(input)) return input;
  const roles = classifyFiles(input);
  const out: DataPackFiles = {};
  for (const [role, i] of Object.entries(roles) as [keyof DataPackFiles, number][]) if (i >= 0) out[role] = input[i];
  return out;
}

export function importDataPack(input: DataPackInput, onProgress: (p: ImportProgress) => void = () => {}): Promise<StoredManifest | null> {
  const files = toFiles(input);
  if (typeof Worker === 'undefined') return runImport(files, onProgress);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; progress?: ImportProgress; manifest?: StoredManifest | null; message?: string };
      if (m.type === 'progress' && m.progress) onProgress(m.progress);
      else if (m.type === 'done') {
        worker.terminate();
        resolve(m.manifest ?? null);
      } else if (m.type === 'error') {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Import worker failed'));
    };
    worker.postMessage({ type: 'import', files });
  });
}
