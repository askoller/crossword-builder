import type { Cell, Clue, Direction, Puzzle } from './types';

/**
 * One undoable step, stored compactly: only the cells (and clues) that changed, with
 * their before and after values, plus where the cursor was so undo can put it back.
 */
export interface Diff {
  /** [cell index, before, after] */
  c: [number, Cell, Cell][];
  /** [clue key, before, after]; null = no clue */
  k?: [string, Clue | null, Clue | null][];
  /** cursor cell and direction before the step */
  at?: [number, Direction];
  /** time of the step (ms) */
  t: number;
}

export interface History {
  puzzleId: string;
  undo: Diff[];
  redo: Diff[];
}

export const HISTORY_CAP = 500;

export function emptyHistory(puzzleId: string): History {
  return { puzzleId, undo: [], redo: [] };
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.b === b.b && a.l === b.l && a.rebus === b.rebus && a.circle === b.circle && a.lock === b.lock && a.src === b.src;
}

/** Build a diff from a set of new cell values; returns null when nothing changes. */
export function makeDiff(
  p: Puzzle,
  cells: Map<number, Cell>,
  at?: [number, Direction],
  clues?: Map<string, Clue | null>,
): Diff | null {
  const c: Diff['c'] = [];
  for (const [i, to] of cells) {
    const from = p.cells[i];
    if (!sameCell(from, to)) c.push([i, { ...from }, { ...to }]);
  }
  const k: NonNullable<Diff['k']> = [];
  for (const [key, to] of clues ?? []) {
    const from = p.clues[key] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) k.push([key, from, to]);
  }
  if (!c.length && !k.length) return null;
  const d: Diff = { c, t: Date.now() };
  if (k.length) d.k = k;
  if (at) d.at = at;
  return d;
}

/** Apply a diff forwards, or backwards when `reverse` is set. Returns a new puzzle. */
export function applyDiff(p: Puzzle, d: Diff, reverse = false): Puzzle {
  const cells = p.cells.slice();
  for (const [i, from, to] of d.c) cells[i] = { ...(reverse ? from : to) };
  let clues = p.clues;
  if (d.k?.length) {
    clues = { ...p.clues };
    for (const [key, from, to] of d.k) {
      const v = reverse ? from : to;
      if (v) clues[key] = { ...v };
      else delete clues[key];
    }
  }
  return { ...p, cells, clues };
}

export function pushDiff(h: History, d: Diff): History {
  const undo = h.undo.length >= HISTORY_CAP ? h.undo.slice(h.undo.length - HISTORY_CAP + 1) : h.undo.slice();
  undo.push(d);
  return { ...h, undo, redo: [] };
}

export function undo(p: Puzzle, h: History): { puzzle: Puzzle; history: History; diff: Diff } | null {
  const d = h.undo[h.undo.length - 1];
  if (!d) return null;
  return {
    puzzle: applyDiff(p, d, true),
    history: { ...h, undo: h.undo.slice(0, -1), redo: [...h.redo, d] },
    diff: d,
  };
}

export function redo(p: Puzzle, h: History): { puzzle: Puzzle; history: History; diff: Diff } | null {
  const d = h.redo[h.redo.length - 1];
  if (!d) return null;
  return {
    puzzle: applyDiff(p, d),
    history: { ...h, undo: [...h.undo, d], redo: h.redo.slice(0, -1) },
    diff: d,
  };
}
