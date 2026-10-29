// Fill settings (SPEC §3.9) shared by the engine and the UI. Pure.
import type { Day } from '../model/types';

export interface FillSettings {
  /** lowest score allowed per word length (index = length) */
  floors: number[];
  /** dupe-rule affix exceptions (SPEC §4.5 rule 1) */
  affixes: string[];
  /** app-level never-use words, on top of the score-1 words in the data pack */
  neverUse: string[];
}

export const DEFAULT_AFFIXES = ['TION', 'SION', 'INGS', 'NESS', 'MENT', 'ABLE', 'IEST', 'IERS'];

/** 3–6 letters 30, 7+ letters 40. */
export function defaultFloors(): number[] {
  return Array.from({ length: 22 }, (_, len) => (len <= 6 ? 30 : 40));
}

export function defaultFillSettings(): FillSettings {
  return { floors: defaultFloors(), affixes: [...DEFAULT_AFFIXES], neverUse: [] };
}

export function floorFor(floor: number | number[], len: number): number {
  return typeof floor === 'number' ? floor : (floor[len] ?? floor[floor.length - 1] ?? 0);
}

/** Day weighting: negative = early week (familiar), positive = late week (fresh, long). */
export const DAY_WEIGHT: Record<Day, number> = { Mon: -1, Tue: -0.6, Wed: -0.25, Thu: 0.25, Fri: 0.6, Sat: 1, Sun: 0.1 };

/** Largest absolute day adjustment, used for optimistic bounds. */
export const DAY_ADJ_MAX = 3;

/** Small value shift by day (SPEC §3.6, §4.1): ±3 points at most. */
export function dayAdjustment(day: Day, len: number, nyt: number): number {
  const w = DAY_WEIGHT[day] ?? 0;
  // 0 for a debut, 1 around 15 NYT uses, capped at 1.5
  const familiar = Math.min(1.5, Math.log2(1 + nyt) / 4);
  let adj = w < 0 ? -w * (familiar - 0.5) * 2 : -w * (familiar - 0.75) * 2;
  if (w > 0) adj += w * Math.max(-1, Math.min(2, 0.25 * (len - 6)));
  return Math.max(-DAY_ADJ_MAX, Math.min(DAY_ADJ_MAX, adj));
}
