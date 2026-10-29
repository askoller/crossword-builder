/// <reference lib="webworker" />
// Fill engine worker. Loads the lexicon from IndexedDB, answers Fill / Check requests and
// runs autofill in slices so a stop message is handled within ~30 ms.
import { openDb } from '../data/db';
import { autofill, type AutofillEvent } from './autofill';
import { boardOf } from './board';
import { candidatesFor } from './candidates';
import { checkPuzzle } from './check';
import { Lexicon, type NotebookAnswer } from './lexicon';
import type { EngineMessage, EngineRequest, LexiconConfig } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const SLICE_MS = 30;
const PROGRESS_MS = 250;

let lexKey = '';
let lexPromise: Promise<Lexicon | null> | null = null;

async function loadLexicon(config: LexiconConfig): Promise<Lexicon | null> {
  const key = config.neverUse.join(',');
  if (lexPromise && key === lexKey) return lexPromise;
  lexKey = key;
  lexPromise = (async () => {
    const db = await openDb();
    const chunks = await db.getAll('lexicon');
    if (!chunks.length) return null;
    const notebook: NotebookAnswer[] = [];
    let cursor = await db.transaction('notebook').store.openCursor();
    while (cursor) {
      const v = cursor.value as Partial<NotebookAnswer> | null;
      if (String(cursor.key).startsWith('answer:') && v?.answer) notebook.push({ answer: v.answer, boost: Number(v.boost) || 0 });
      cursor = await cursor.continue();
    }
    return new Lexicon(chunks, { notebook, neverUse: config.neverUse });
  })();
  lexPromise.catch(() => (lexPromise = null));
  return lexPromise;
}

const post = (m: EngineMessage) => self.postMessage(m);

let running: { id: number; gen: Generator<AutofillEvent, void> } | null = null;
let lastProgress = 0;

function stopRunning(stopped: boolean): void {
  if (!running) return;
  const { id, gen } = running;
  running = null;
  gen.return();
  post({ type: 'done', id, stopped });
}

function pump(): void {
  const job = running;
  if (!job) return;
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < SLICE_MS) {
      const r = job.gen.next();
      if (running !== job) return;
      if (r.done) {
        running = null;
        post({ type: 'done', id: job.id });
        return;
      }
      const e = r.value;
      if (e.type === 'result') {
        post({ type: 'result', id: job.id, fill: e.result.fill, stats: e.result.stats, index: e.index, replaces: e.replaces });
      } else if (e.type === 'fail') {
        running = null;
        post({ type: 'done', id: job.id, reason: e.reason });
        return;
      } else if (Date.now() - lastProgress > PROGRESS_MS) {
        lastProgress = Date.now();
        post({ type: 'progress', id: job.id, elapsed: e.elapsed, attempts: e.attempts });
      }
    }
  } catch (err) {
    running = null;
    post({ type: 'error', id: job.id, message: err instanceof Error ? err.message : String(err) });
    return;
  }
  setTimeout(pump, 0);
}

self.onmessage = async (e: MessageEvent<EngineRequest>) => {
  const m = e.data;
  if (m.type === 'reload') {
    lexPromise = null;
    return;
  }
  if (m.type === 'stop') {
    if (running && (running.id === m.id || m.id < 0)) stopRunning(true);
    return;
  }
  try {
    const lex = await loadLexicon(m.config);
    if (!lex) {
      post({ type: 'nodata', id: m.id });
      return;
    }
    switch (m.type) {
      case 'load':
        post({ type: 'ready', id: m.id, words: lex.size });
        break;
      case 'candidates':
        post({
          type: 'candidates',
          id: m.id,
          list: candidatesFor(boardOf(m.grid), m.slot, lex, { day: m.day, floor: m.floor, affixes: m.affixes, limit: m.limit }),
        });
        break;
      case 'check':
        post({ type: 'check', id: m.id, report: checkPuzzle(m.grid, lex, { floor: m.floor, affixes: m.affixes, symmetry: m.symmetry }) });
        break;
      case 'autofill':
        stopRunning(true);
        running = {
          id: m.id,
          gen: autofill(m.grid, m.scope, lex, {
            day: m.settings.day,
            floor: m.settings.floor,
            keepOpen: m.settings.keepOpen,
            affixes: m.settings.affixes,
            maxResults: m.settings.maxResults,
            timeLimitMs: m.settings.timeLimitMs,
            seed: m.id,
          }),
        };
        setTimeout(pump, 0);
        break;
    }
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
  }
};
