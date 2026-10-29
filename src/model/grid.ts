import { cellText, emptyCell, type Cell, type Day, type Direction, type Puzzle, type Slot, type Symmetry } from './types';

export interface SlotIndex {
  slots: Slot[];
  /** clue number per cell (0 = none) */
  numbers: number[];
  /** slot index per cell for across / down (-1 = none, e.g. block or unchecked run of 1) */
  across: number[];
  down: number[];
}

/**
 * Slots are maximal runs of 2+ open cells. Numbering goes left-to-right, top-to-bottom;
 * a cell gets a number when it starts an across or a down slot.
 */
export function computeSlots(width: number, height: number, cells: Pick<Cell, 'b'>[]): SlotIndex {
  const n = width * height;
  const numbers = new Array<number>(n).fill(0);
  const across = new Array<number>(n).fill(-1);
  const down = new Array<number>(n).fill(-1);
  const acrossSlots: Slot[] = [];
  const downSlots: Slot[] = [];
  const open = (r: number, c: number) => r >= 0 && c >= 0 && r < height && c < width && !cells[r * width + c].b;
  let num = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!open(r, c)) continue;
      const startsAcross = !open(r, c - 1) && open(r, c + 1);
      const startsDown = !open(r - 1, c) && open(r + 1, c);
      if (!startsAcross && !startsDown) continue;
      num++;
      numbers[r * width + c] = num;
      if (startsAcross) {
        const run: number[] = [];
        for (let k = c; open(r, k); k++) run.push(r * width + k);
        acrossSlots.push({ id: `A${num}`, dir: 'across', number: num, cells: run });
      }
      if (startsDown) {
        const run: number[] = [];
        for (let k = r; open(k, c); k++) run.push(k * width + c);
        downSlots.push({ id: `D${num}`, dir: 'down', number: num, cells: run });
      }
    }
  }
  const slots = [...acrossSlots, ...downSlots];
  slots.forEach((s, i) => {
    const map = s.dir === 'across' ? across : down;
    for (const cell of s.cells) map[cell] = i;
  });
  return { slots, numbers, across, down };
}

/** Cells that must change together with `index` under the given symmetry (including itself). */
export function symmetricPartners(index: number, width: number, height: number, symmetry: Symmetry): number[] {
  const r = Math.floor(index / width);
  const c = index % width;
  let partner: number | null = null;
  switch (symmetry) {
    case 'rotational':
      partner = (height - 1 - r) * width + (width - 1 - c);
      break;
    case 'left-right':
      partner = r * width + (width - 1 - c);
      break;
    case 'diagonal':
      // mirror across the main diagonal; only meaningful for square grids
      partner = width === height ? c * width + r : null;
      break;
    case 'none':
      partner = null;
  }
  return partner === null || partner === index ? [index] : [index, partner];
}

export function isSymmetric(p: Pick<Puzzle, 'width' | 'height' | 'cells'>, symmetry: Symmetry): boolean {
  if (symmetry === 'none') return true;
  return p.cells.every((cell, i) =>
    symmetricPartners(i, p.width, p.height, symmetry).every((j) => p.cells[j].b === cell.b),
  );
}

/** Pattern of a slot in the clue bar style: letters, '?' for empty cells. */
export function slotPattern(cells: Cell[], slot: Slot): string {
  return slot.cells
    .map((i) => {
      const t = cellText(cells[i]);
      return t === '' ? '?' : t.length > 1 ? `[${t}]` : t;
    })
    .join('');
}

export function slotLabel(slot: Slot): string {
  return `${slot.number}-${slot.dir === 'across' ? 'Across' : 'Down'}`;
}

export function slotAt(index: SlotIndex, cell: number, dir: Direction): Slot | null {
  const s = (dir === 'across' ? index.across : index.down)[cell];
  return s >= 0 ? index.slots[s] : null;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

export interface NewPuzzleOptions {
  width: number;
  height: number;
  day: Day;
  outlet: string;
  title?: string;
  themeId?: string | null;
}

export function newPuzzle(o: NewPuzzleOptions): Puzzle {
  const now = new Date().toISOString();
  return {
    format: 1,
    id: uuid(),
    title: o.title?.trim() || 'Untitled puzzle',
    width: o.width,
    height: o.height,
    day: o.day,
    outlet: o.outlet,
    status: 'Theme draft',
    symmetry: 'rotational',
    cells: Array.from({ length: o.width * o.height }, emptyCell),
    clues: {},
    themeId: o.themeId ?? null,
    created: now,
    updated: now,
  };
}
