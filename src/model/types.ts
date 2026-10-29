// Puzzle file format (SPEC §5.2). This is also the Drive backup format.

export type CellSource = 'theme' | 'typed' | 'autofill' | null;

export interface Cell {
  /** 1 = block */
  b: 0 | 1;
  /** single letter A–Z, or '' when empty (rebus cells keep their first letter here) */
  l: string;
  /** multi-letter rebus string, or null */
  rebus: string | null;
  circle: 0 | 1;
  lock: 0 | 1;
  src: CellSource;
}

export type Symmetry = 'rotational' | 'left-right' | 'diagonal' | 'none';
export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export type Status = 'Theme draft' | 'Themers set' | 'Filling' | 'Cluing' | 'Submitted';
export type Direction = 'across' | 'down';

export const DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const STATUSES: Status[] = ['Theme draft', 'Themers set', 'Filling', 'Cluing', 'Submitted'];
export const SYMMETRIES: Symmetry[] = ['rotational', 'left-right', 'diagonal', 'none'];

export interface Clue {
  text: string;
  notes?: string;
}

export interface Puzzle {
  format: 1;
  id: string;
  title: string;
  width: number;
  height: number;
  day: Day;
  outlet: string;
  status: Status;
  symmetry: Symmetry;
  cells: Cell[];
  /** keyed "A1", "D1", ... */
  clues: Record<string, Clue>;
  themeId: string | null;
  created: string;
  updated: string;
}

export interface Slot {
  /** "A1" / "D3" */
  id: string;
  dir: Direction;
  number: number;
  cells: number[];
}

export function emptyCell(): Cell {
  return { b: 0, l: '', rebus: null, circle: 0, lock: 0, src: null };
}

export function cellText(c: Cell): string {
  return c.rebus ?? c.l;
}
