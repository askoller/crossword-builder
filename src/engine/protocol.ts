// Message contract for the fill engine worker (SPEC §4.4). The engine itself is built in
// session 2; the UI thread only talks to it through these messages.
import type { Puzzle } from '../model/types';

export interface AutofillSettings {
  day: Puzzle['day'];
  /** lowest score allowed, per length (index = length) or a single number */
  floor: number | number[];
  /** reject fills leaving any slot outside the scope with fewer than K candidates */
  keepOpen: number;
  maxResults: number;
}

export type AutofillScope = { kind: 'grid' } | { kind: 'selection'; cells: number[] };

export type EngineRequest =
  | { type: 'autofill'; grid: Puzzle; scope: AutofillScope; settings: AutofillSettings }
  | { type: 'stop' };

export interface FillStats {
  average: number;
  weakest: { slot: string; word: string; value: number } | null;
  underFloor: number;
}

export type EngineMessage =
  | { type: 'result'; fill: Record<number, string>; stats: FillStats }
  | { type: 'done' }
  | { type: 'error'; message: string };
