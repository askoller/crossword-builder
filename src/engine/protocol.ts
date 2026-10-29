// Message contract for the fill engine worker (SPEC §4.4). The UI thread only talks to
// the engine through these messages (see client.ts).
import type { Puzzle, Symmetry } from '../model/types';
import type { CandidateList } from './candidates';
import type { CheckReport } from './check';

export type EngineGrid = Pick<Puzzle, 'width' | 'height' | 'cells'>;

export interface AutofillSettings {
  day: Puzzle['day'];
  /** lowest score allowed, per length (index = length) or a single number */
  floor: number | number[];
  /** reject fills leaving any slot outside the scope with fewer than K candidates */
  keepOpen: number;
  maxResults: number;
  affixes: string[];
  /** search time before the worker reports done */
  timeLimitMs: number;
}

export type AutofillScope = { kind: 'grid' } | { kind: 'selection'; cells: number[] };

/** Engine-wide options sent with requests; the worker rebuilds the lexicon when they change. */
export interface LexiconConfig {
  neverUse: string[];
}

export type EngineRequest =
  | { type: 'load'; id: number; config: LexiconConfig }
  | {
      type: 'candidates';
      id: number;
      config: LexiconConfig;
      grid: EngineGrid;
      slot: string;
      day: Puzzle['day'];
      floor: number;
      affixes: string[];
      limit?: number;
    }
  | { type: 'check'; id: number; config: LexiconConfig; grid: EngineGrid; floor: number | number[]; affixes: string[]; symmetry: Symmetry }
  | { type: 'autofill'; id: number; config: LexiconConfig; grid: EngineGrid; scope: AutofillScope; settings: AutofillSettings }
  | { type: 'stop'; id: number }
  /** drop the cached lexicon (after a data import or Notebook boost change) */
  | { type: 'reload' };

export interface FillEntry {
  slot: string;
  word: string;
  value: number;
  nyt: number;
  last: number;
  /** under the floor (only possible for entries that were already in the grid) */
  under: boolean;
}

export interface FillStats {
  average: number;
  weakest: { slot: string; word: string; value: number } | null;
  /** entries in the whole grid under the floor */
  underFloor: number;
  /** the open (filled) entries */
  entries?: FillEntry[];
}

export type EngineMessage =
  | { type: 'ready'; id: number; words: number }
  | { type: 'nodata'; id: number }
  | { type: 'candidates'; id: number; list: CandidateList | null }
  | { type: 'check'; id: number; report: CheckReport }
  /** one distinct fill; `index` is its place in the result list, `replaces` = a better
   *  version of an earlier fill that was too similar to keep both */
  | { type: 'result'; id: number; fill: Record<number, string>; stats: FillStats; index: number; replaces: boolean }
  | { type: 'progress'; id: number; elapsed: number; attempts: number }
  | { type: 'done'; id: number; reason?: string; stopped?: boolean }
  | { type: 'error'; id: number; message: string };
