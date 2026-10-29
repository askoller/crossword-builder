// Theme entries in the grid: place a Notebook theme entry as a locked slot, and find
// where entries already sit. Pure.
import type { SlotIndex } from './grid';
import { letters } from './notebook';
import { cellText, type Cell, type Puzzle, type Slot } from './types';

export type PlaceResult = { ok: true; changes: Map<number, Cell> } | { ok: false; reason: string };

/** Write an entry into a slot as theme letters, locked. Crossing locked letters must agree. */
export function placeThemeEntry(p: Puzzle, slot: Slot, answer: string): PlaceResult {
  const word = letters(answer);
  if (word.length !== slot.cells.length) return { ok: false, reason: `${word.length} letters don't fit a ${slot.cells.length}-letter slot` };
  const changes = new Map<number, Cell>();
  for (let k = 0; k < word.length; k++) {
    const i = slot.cells[k];
    const c = p.cells[i];
    if (c.lock && cellText(c) && cellText(c) !== word[k]) return { ok: false, reason: `Crosses a locked ${cellText(c)} where ${word[k]} would go` };
    changes.set(i, { ...c, l: word[k], rebus: null, lock: 1, src: 'theme' });
  }
  return { ok: true, changes };
}

/** Remove an entry's lock (letters stay, now typed) so it can be moved or edited. */
export function unlockSlot(p: Puzzle, slot: Slot, idx: SlotIndex): Map<number, Cell> {
  const changes = new Map<number, Cell>();
  for (const i of slot.cells) {
    const c = p.cells[i];
    if (!c.lock) continue;
    // Keep the lock where a crossing locked slot still needs the letter.
    const crossing = [idx.across[i], idx.down[i]].map((s) => idx.slots[s]).filter((s) => s && s.id !== slot.id);
    if (crossing.some((s) => s.cells.every((j) => p.cells[j].lock))) continue;
    changes.set(i, { ...c, lock: 0, src: c.l ? 'typed' : null });
  }
  return changes;
}

/** Slots whose letters spell the answer. */
export function findPlaced(p: Puzzle, idx: SlotIndex, answer: string): Slot[] {
  const word = letters(answer);
  return idx.slots.filter((s) => s.cells.length === word.length && s.cells.map((i) => cellText(p.cells[i])).join('') === word);
}
