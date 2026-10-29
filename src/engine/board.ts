// Engine view of a grid (SPEC §4.2): letter codes per cell and the slots, plus how a
// search scope splits slots into variables, viability checks and fixed entries. Pure.
import { computeSlots, type SlotIndex } from '../model/grid';
import type { Puzzle, Slot } from '../model/types';
import { letterCode, MIN_LEN } from './lexicon';

export const EMPTY = 0;
/** rebus or anything that isn't a single A–Z letter */
export const OTHER = 27;
export const BLOCK = 255;

export interface Board {
  width: number;
  height: number;
  /** 0 empty, 1–26 letter, 27 rebus, 255 block */
  cells: Uint8Array;
  locked: Uint8Array;
  index: SlotIndex;
}

export function boardOf(p: Pick<Puzzle, 'width' | 'height' | 'cells'>): Board {
  const cells = new Uint8Array(p.cells.length);
  const locked = new Uint8Array(p.cells.length);
  p.cells.forEach((c, i) => {
    locked[i] = c.lock;
    if (c.b) cells[i] = BLOCK;
    else if (c.rebus && c.rebus.length > 1) cells[i] = OTHER;
    else if (/^[A-Z]$/.test(c.l)) cells[i] = letterCode(c.l);
    else if (c.l) cells[i] = OTHER;
  });
  return { width: p.width, height: p.height, cells, locked, index: computeSlots(p.width, p.height, p.cells) };
}

export const letterOf = (code: number): string => String.fromCharCode(64 + code);

/** The slot's letters as a word, or null if any cell is empty or a rebus. */
export function slotWord(cells: Uint8Array, slot: Slot): string | null {
  let w = '';
  for (const i of slot.cells) {
    const c = cells[i];
    if (c < 1 || c > 26) return null;
    w += letterOf(c);
  }
  return w;
}

export function hasOther(cells: Uint8Array, slot: Slot): boolean {
  return slot.cells.some((i) => cells[i] === OTHER);
}

/** The slot crossing `slot` at `cell`, as an index into `index.slots` (-1 = none). */
export function crosserAt(index: SlotIndex, slot: Slot, cell: number): number {
  return (slot.dir === 'across' ? index.down : index.across)[cell];
}

export type SlotKind = 'var' | 'viability' | 'fixed' | 'ignore';

export interface Problem {
  board: Board;
  /** working letters: board letters with the open cells cleared */
  cells: Uint8Array;
  open: Uint8Array;
  openCount: number;
  kinds: SlotKind[];
  /** slot indexes that are search variables */
  vars: number[];
}

/**
 * Split slots for a search over `open` cells (SPEC §4.4):
 * - var: touches an open cell and every other cell has a letter → filled by the search;
 * - viability: touches an open cell but also has empty cells outside the scope → must
 *   keep enough candidates, not filled;
 * - fixed: complete entry outside the scope (counts for dupes);
 * - ignore: anything else (partly empty and untouched, rebus, shorter than 3).
 */
export function makeProblem(board: Board, open: Uint8Array): Problem {
  const cells = board.cells.slice();
  let openCount = 0;
  for (let i = 0; i < cells.length; i++) {
    if (open[i]) {
      cells[i] = EMPTY;
      openCount++;
    }
  }
  const kinds: SlotKind[] = [];
  const vars: number[] = [];
  board.index.slots.forEach((s, k) => {
    let touches = false;
    let emptyOutside = false;
    let other = false;
    for (const i of s.cells) {
      if (open[i]) touches = true;
      else if (cells[i] === EMPTY) emptyOutside = true;
      else if (cells[i] === OTHER) other = true;
    }
    let kind: SlotKind;
    if (other || s.cells.length < MIN_LEN) kind = 'ignore';
    else if (touches) kind = emptyOutside ? 'viability' : 'var';
    else kind = emptyOutside ? 'ignore' : 'fixed';
    kinds.push(kind);
    if (kind === 'var') vars.push(k);
  });
  return { board, cells, open, openCount, kinds, vars };
}

/** Open cells for a scope: whole grid = every empty cell; selection = the selected cells. */
export function scopeMask(board: Board, scope: { kind: 'grid' } | { kind: 'selection'; cells: number[] }): Uint8Array {
  const open = new Uint8Array(board.cells.length);
  if (scope.kind === 'grid') {
    for (let i = 0; i < open.length; i++) if (board.cells[i] === EMPTY) open[i] = 1;
  } else {
    for (const i of scope.cells) if (board.cells[i] !== BLOCK && !board.locked[i]) open[i] = 1;
  }
  return open;
}
