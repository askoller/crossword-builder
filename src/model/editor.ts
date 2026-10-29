// Pure editing operations. Each returns the cells to change (if any) and the new cursor;
// the store turns the changes into an undoable diff.
import { slotAt, symmetricPartners, type SlotIndex } from './grid';
import { cellText, type Cell, type Direction, type Puzzle, type Slot } from './types';

export interface Cursor {
  cell: number;
  dir: Direction;
}

export interface EditResult {
  changes: Map<number, Cell>;
  cursor: Cursor;
}

const other = (d: Direction): Direction => (d === 'across' ? 'down' : 'across');

function result(cursor: Cursor, changes = new Map<number, Cell>()): EditResult {
  return { changes, cursor };
}

/** The slot under the cursor, falling back to the other direction for runs of one. */
export function currentSlot(idx: SlotIndex, cur: Cursor): Slot | null {
  return slotAt(idx, cur.cell, cur.dir);
}

export function typeLetter(p: Puzzle, idx: SlotIndex, cur: Cursor, letter: string): EditResult {
  const L = letter.toUpperCase();
  if (!/^[A-Z]$/.test(L) || p.cells[cur.cell].b) return result(cur);
  const slot = currentSlot(idx, cur);
  const cells = slot ? slot.cells : [cur.cell];
  const pos = Math.max(0, cells.indexOf(cur.cell));
  let target = -1;
  for (let k = pos; k < cells.length; k++) {
    if (!p.cells[cells[k]].lock) {
      target = k;
      break;
    }
  }
  if (target < 0) return result(cur);
  const i = cells[target];
  const changes = new Map([[i, { ...p.cells[i], l: L, rebus: null, src: 'typed' as const }]]);
  let next = i;
  for (let k = target + 1; k < cells.length; k++) {
    if (!p.cells[cells[k]].lock) {
      next = cells[k];
      break;
    }
  }
  return result({ cell: next, dir: cur.dir }, changes);
}

function cleared(c: Cell): Cell {
  return { ...c, l: '', rebus: null, src: null };
}

export function backspace(p: Puzzle, idx: SlotIndex, cur: Cursor): EditResult {
  const here = p.cells[cur.cell];
  if (here.b) return result(cur);
  if (!here.lock && cellText(here) !== '') {
    return result(cur, new Map([[cur.cell, cleared(here)]]));
  }
  const slot = currentSlot(idx, cur);
  if (!slot) return result(cur);
  for (let k = slot.cells.indexOf(cur.cell) - 1; k >= 0; k--) {
    const i = slot.cells[k];
    if (p.cells[i].lock) continue;
    return result({ cell: i, dir: cur.dir }, new Map([[i, cleared(p.cells[i])]]));
  }
  return result(cur);
}

/** Toggle a block on the cursor cell and its symmetric partner. Locked cells never change. */
export function toggleBlock(p: Puzzle, cur: Cursor): EditResult {
  const here = p.cells[cur.cell];
  if (here.lock) return result(cur);
  const makeBlock = !here.b;
  const changes = new Map<number, Cell>();
  for (const i of symmetricPartners(cur.cell, p.width, p.height, p.symmetry)) {
    const c = p.cells[i];
    if (c.lock || !!c.b === makeBlock) continue;
    changes.set(i, makeBlock ? { b: 1, l: '', rebus: null, circle: 0, lock: 0, src: null } : { ...c, b: 0 });
  }
  return result(cur, changes);
}

export function toggleCircle(p: Puzzle, cur: Cursor): EditResult {
  const c = p.cells[cur.cell];
  if (c.b) return result(cur);
  return result(cur, new Map([[cur.cell, { ...c, circle: c.circle ? 0 : 1 }]]));
}

/** Lock or unlock the current word (all its cells). Locked cells are theme cells. */
export function toggleLockWord(p: Puzzle, idx: SlotIndex, cur: Cursor): EditResult {
  if (p.cells[cur.cell].b) return result(cur);
  const slot = currentSlot(idx, cur);
  const cells = slot ? slot.cells : [cur.cell];
  const lock = !cells.every((i) => p.cells[i].lock);
  const changes = new Map<number, Cell>();
  for (const i of cells) {
    const c = p.cells[i];
    const filled = cellText(c) !== '';
    changes.set(i, { ...c, lock: lock ? 1 : 0, src: filled ? (lock ? 'theme' : 'typed') : null });
  }
  return result(cur, changes);
}

/** Set the cell's rebus text (A–Z, any length). One letter or less is a normal cell. */
export function setRebus(p: Puzzle, cur: Cursor, text: string): EditResult {
  const c = p.cells[cur.cell];
  if (c.b || c.lock) return result(cur);
  const t = text.toUpperCase().replace(/[^A-Z]/g, '');
  const next: Cell = { ...c, l: t.slice(0, 1), rebus: t.length > 1 ? t : null, src: t ? 'typed' : null };
  return result(cur, new Map([[cur.cell, next]]));
}

/** Tap on a cell: select it, or switch direction when it's already selected. */
export function tapCell(p: Puzzle, idx: SlotIndex, cur: Cursor, cell: number): Cursor {
  if (cell === cur.cell) return switchDirection(idx, cur);
  let dir = cur.dir;
  if (!p.cells[cell].b && !slotAt(idx, cell, dir) && slotAt(idx, cell, other(dir))) dir = other(dir);
  return { cell, dir };
}

export function switchDirection(idx: SlotIndex, cur: Cursor): Cursor {
  const dir = other(cur.dir);
  // keep the direction when the other way is a single unchecked square but this way isn't
  if (!slotAt(idx, cur.cell, dir) && slotAt(idx, cur.cell, cur.dir)) return cur;
  return { cell: cur.cell, dir };
}

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/** Arrow keys: the first press in the other axis switches direction, then moves skip blocks. */
export function arrow(p: Puzzle, cur: Cursor, key: Arrow): Cursor {
  const dir: Direction = key === 'ArrowLeft' || key === 'ArrowRight' ? 'across' : 'down';
  if (dir !== cur.dir) return { cell: cur.cell, dir };
  const dr = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  const dc = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  let r = Math.floor(cur.cell / p.width) + dr;
  let c = (cur.cell % p.width) + dc;
  while (r >= 0 && c >= 0 && r < p.height && c < p.width) {
    const i = r * p.width + c;
    if (!p.cells[i].b) return { cell: i, dir };
    r += dr;
    c += dc;
  }
  return cur;
}

/** Previous / next entry in clue order (all across, then all down, wrapping). */
export function stepEntry(p: Puzzle, idx: SlotIndex, cur: Cursor, delta: 1 | -1): Cursor {
  const slots = idx.slots;
  if (!slots.length) return cur;
  const here = currentSlot(idx, cur) ?? slotAt(idx, cur.cell, other(cur.dir));
  let k: number;
  if (here) {
    k = (slots.indexOf(here) + delta + slots.length) % slots.length;
  } else {
    // on a block: next slot that starts after this cell in the current direction
    const pool = slots.filter((s) => s.dir === cur.dir);
    const after = pool.find((s) => s.cells[0] > cur.cell) ?? pool[0] ?? slots[0];
    k = slots.indexOf(after);
  }
  const s = slots[k];
  const firstEmpty = s.cells.find((i) => cellText(p.cells[i]) === '' && !p.cells[i].lock);
  return { cell: firstEmpty ?? s.cells[0], dir: s.dir };
}

/** A sensible starting cursor: the first open cell, across. */
export function initialCursor(p: Puzzle): Cursor {
  const first = p.cells.findIndex((c) => !c.b);
  return { cell: Math.max(0, first), dir: 'across' };
}
