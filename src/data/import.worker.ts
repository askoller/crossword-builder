/// <reference lib="webworker" />
import { runImport, type DataPackFiles } from './importCore';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<{ type: 'import'; files: DataPackFiles }>) => {
  if (e.data.type !== 'import') return;
  try {
    const manifest = await runImport(e.data.files, (progress) => self.postMessage({ type: 'progress', progress }));
    self.postMessage({ type: 'done', manifest });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
