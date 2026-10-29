// Main-thread side of the fill engine: one shared worker, request/response by id, and
// streaming autofill runs. The UI thread never runs a search itself.
import type { CandidateList } from './candidates';
import type { CheckReport } from './check';
import type { AutofillScope, AutofillSettings, EngineGrid, EngineMessage, EngineRequest, FillStats, LexiconConfig } from './protocol';
import type { Puzzle, Symmetry } from '../model/types';

type Pending = (m: EngineMessage) => void;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<EngineMessage>) => pending.get(e.data.id)?.(e.data);
    worker.onerror = (e) => {
      for (const [id, cb] of pending) cb({ type: 'error', id, message: e.message || 'Engine failed' });
      pending.clear();
    };
  }
  return worker;
}

/** The engine has no word list (data pack not imported). */
export class NoDataError extends Error {
  constructor() {
    super('Import the data pack in Settings to get fill suggestions.');
  }
}

type Req<T extends EngineRequest['type']> = Omit<Extract<EngineRequest, { type: T }>, 'id'>;

function request(msg: Req<'load'> | Req<'candidates'> | Req<'check'>): Promise<EngineMessage> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (m) => {
      pending.delete(id);
      if (m.type === 'nodata') reject(new NoDataError());
      else if (m.type === 'error') reject(new Error(m.message));
      else resolve(m);
    });
    getWorker().postMessage({ ...msg, id } as EngineRequest);
  });
}

/** Strip a puzzle to what the engine needs. */
export function engineGrid(p: Puzzle): EngineGrid {
  return { width: p.width, height: p.height, cells: p.cells };
}

export async function loadEngine(config: LexiconConfig): Promise<number> {
  const m = await request({ type: 'load', config });
  return m.type === 'ready' ? m.words : 0;
}

export async function getCandidates(
  config: LexiconConfig,
  grid: EngineGrid,
  slot: string,
  o: { day: Puzzle['day']; floor: number; affixes: string[]; limit?: number },
): Promise<CandidateList | null> {
  const m = await request({ type: 'candidates', config, grid, slot, ...o });
  return m.type === 'candidates' ? m.list : null;
}

export async function runCheck(
  config: LexiconConfig,
  grid: EngineGrid,
  o: { floor: number | number[]; affixes: string[]; symmetry: Symmetry },
): Promise<CheckReport | null> {
  const m = await request({ type: 'check', config, grid, ...o });
  return m.type === 'check' ? m.report : null;
}

export interface AutofillHandlers {
  onResult: (r: { fill: Record<number, string>; stats: FillStats; index: number; replaces: boolean }) => void;
  onProgress?: (elapsed: number) => void;
  onDone: (d: { reason?: string; stopped?: boolean; noData?: boolean; error?: string }) => void;
}

export interface AutofillRun {
  stop(): void;
}

export function startAutofill(config: LexiconConfig, grid: EngineGrid, scope: AutofillScope, settings: AutofillSettings, h: AutofillHandlers): AutofillRun {
  const id = nextId++;
  pending.set(id, (m) => {
    switch (m.type) {
      case 'result':
        h.onResult(m);
        break;
      case 'progress':
        h.onProgress?.(m.elapsed);
        break;
      case 'done':
        pending.delete(id);
        h.onDone({ reason: m.reason, stopped: m.stopped });
        break;
      case 'nodata':
        pending.delete(id);
        h.onDone({ noData: true });
        break;
      case 'error':
        pending.delete(id);
        h.onDone({ error: m.message });
        break;
    }
  });
  getWorker().postMessage({ type: 'autofill', id, config, grid, scope, settings } satisfies EngineRequest);
  return { stop: () => worker?.postMessage({ type: 'stop', id } satisfies EngineRequest) };
}

/** Forget the cached lexicon (after a data import or a Notebook boost change). */
export function reloadEngine(): void {
  worker?.postMessage({ type: 'reload' } satisfies EngineRequest);
}
