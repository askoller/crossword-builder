// Turning crossword files from other apps into puzzles (Puzzles → New puzzle → Import).
// Pure: bytes in, a Puzzle and a list of what couldn't be imported out.
import { computeSlots, isSymmetric, newPuzzle } from './grid';
import { puzClueOrder, readPuz, type PuzFile } from './puz';
import { SYMMETRIES, type Cell, type Day, type Puzzle } from './types';

export interface ImportOptions {
  day: Day;
  outlet: string;
  /** title to use instead of the file's */
  title?: string;
  /** lock every imported letter (they show as theme letters and autofill keeps them) */
  lock: boolean;
}

export interface ImportedGrid {
  puzzle: Puzzle;
  /** human-readable notes on what was skipped or changed */
  skipped: string[];
  /** e.g. "15×15 · 78 clues · 2 rebus · 3 circles" */
  summary: string;
}

export const MAX_IMPORT_SIZE = 25;

/** Input to gridToPuzzle: one entry per square, row by row. */
export interface RawGrid {
  width: number;
  height: number;
  title: string;
  /** '#' block, '' empty, else the letter or rebus string */
  squares: string[];
  circles: Set<number>;
  /** clue text by slot id ("A1"), from the file's own numbering */
  clues: Record<string, string>;
  notes?: Record<string, string>;
}

/** The symmetry the blocks follow, preferring rotational. */
export function detectSymmetry(p: Pick<Puzzle, 'width' | 'height' | 'cells'>): Puzzle['symmetry'] {
  return SYMMETRIES.find((s) => s !== 'none' && (s !== 'diagonal' || p.width === p.height) && isSymmetric(p, s)) ?? 'none';
}

export function gridToPuzzle(raw: RawGrid, o: ImportOptions, skipped: string[] = []): ImportedGrid {
  const { width: w, height: h } = raw;
  if (w < 2 || h < 2 || w > MAX_IMPORT_SIZE || h > MAX_IMPORT_SIZE) throw new Error(`Grid is ${w}×${h}; the app handles up to ${MAX_IMPORT_SIZE}×${MAX_IMPORT_SIZE}`);
  const p = newPuzzle({ width: w, height: h, day: o.day, outlet: o.outlet, title: o.title?.trim() || raw.title.trim() || 'Imported puzzle' });
  let letters = 0;
  let rebus = 0;
  let odd = 0;
  p.cells = raw.squares.map((sq, i): Cell => {
    if (sq === '#') return { b: 1, l: '', rebus: null, circle: 0, lock: 0, src: null };
    const text = sq.toUpperCase().replace(/[^A-Z]/g, '');
    if (text.length < sq.length) odd++;
    const circle = raw.circles.has(i) ? 1 : 0;
    if (!text) return { b: 0, l: '', rebus: null, circle, lock: 0, src: null };
    letters++;
    if (text.length > 1) rebus++;
    return { b: 0, l: text[0], rebus: text.length > 1 ? text : null, circle, lock: o.lock ? 1 : 0, src: o.lock ? 'theme' : 'typed' };
  });
  if (odd) skipped.push(`${odd} square${odd > 1 ? 's' : ''} had characters other than A–Z (digits or symbols); only the letters were kept`);
  p.symmetry = detectSymmetry(p);

  const ids = new Set(computeSlots(w, h, p.cells).slots.map((s) => s.id));
  let clueCount = 0;
  for (const [id, text] of Object.entries(raw.clues)) {
    if (!ids.has(id) || !text.trim()) continue;
    p.clues[id] = { text: text.trim(), ...(raw.notes?.[id] ? { notes: raw.notes[id] } : {}) };
    clueCount++;
  }
  for (const [id, note] of Object.entries(raw.notes ?? {})) if (ids.has(id) && !p.clues[id]) p.clues[id] = { text: '', notes: note };

  const open = p.cells.filter((c) => !c.b).length;
  p.status = letters === 0 ? 'Theme draft' : letters < open ? 'Filling' : 'Cluing';
  const circles = p.cells.filter((c) => c.circle).length;
  const summary = [
    `${w}×${h}`,
    `${clueCount} clue${clueCount === 1 ? '' : 's'}`,
    letters < open ? `${letters} of ${open} squares filled` : '',
    rebus ? `${rebus} rebus` : '',
    circles ? `${circles} circle${circles > 1 ? 's' : ''}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return { puzzle: p, skipped, summary };
}

/** Clue notes as exportPuz writes them ("17A: note" per line); anything else is reported. */
function parseNotes(notes: string): { byId: Record<string, string>; rest: string } {
  const byId: Record<string, string> = {};
  const rest: string[] = [];
  for (const line of notes.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s*([AD])\s*:\s*(.+)$/i);
    if (m) byId[`${m[2].toUpperCase()}${m[1]}`] = m[3].trim();
    else if (line.trim()) rest.push(line.trim());
  }
  return { byId, rest: rest.join(' ') };
}

export function puzzleFromPuzFile(f: PuzFile, o: ImportOptions): ImportedGrid {
  const skipped: string[] = [];
  const n = f.width * f.height;
  const squares: string[] = [];
  for (let i = 0; i < n; i++) {
    const ch = f.solution[i];
    if (ch === '.' || ch === ':') squares.push('#');
    else if (f.scrambled || ch === '-') squares.push('');
    else squares.push(f.rebus.get(i) || ch);
  }
  if (f.scrambled) skipped.push('The solution is scrambled (locked in Across Lite), so the grid was imported without letters');
  if (!f.checksumsOk) skipped.push('Some checksums in the file did not match; check the grid and clues');

  // .puz clues come in number order with Across first at a shared number, the same order
  // puzClueOrder gives for the imported blocks.
  const order = puzClueOrder({ width: f.width, height: f.height, cells: squares.map((s) => ({ b: s === '#' ? (1 as const) : (0 as const) })) });
  const clues: Record<string, string> = {};
  order.forEach((id, i) => {
    if (i < f.clues.length) clues[id] = f.clues[i];
  });
  if (f.clues.length !== order.length) skipped.push(`The file has ${f.clues.length} clues for ${order.length} entries; clues were matched in order`);

  const { byId, rest } = parseNotes(f.notes);
  if (rest) skipped.push(`Puzzle notes not imported: “${rest.length > 80 ? `${rest.slice(0, 80)}…` : rest}”`);
  const credits = [f.author && `author “${f.author}”`, f.copyright && `copyright “${f.copyright}”`].filter(Boolean);
  if (credits.length) skipped.push(`No place for the ${credits.join(' and ')} in a puzzle here; not imported`);
  const known = new Set(['GRBS', 'RTBL', 'GEXT']);
  const other = f.sectionNames.filter((s) => !known.has(s));
  if (other.length) skipped.push(`Extra sections not imported: ${other.join(', ')}`);

  const circles = new Set([...f.circles].filter((i) => squares[i] !== '#'));
  return gridToPuzzle({ width: f.width, height: f.height, title: f.title, squares, circles, clues, notes: byId }, o, skipped);
}

export function importPuzBytes(bytes: Uint8Array, o: ImportOptions): ImportedGrid {
  return puzzleFromPuzFile(readPuz(bytes), o);
}

/** Pick the parser by file name or magic bytes. */
export function importGridFile(name: string, bytes: Uint8Array, o: ImportOptions): ImportedGrid {
  const lower = name.toLowerCase();
  if (lower.endsWith('.puz') || String.fromCharCode(...bytes.subarray(2, 13)) === 'ACROSS&DOWN') return importPuzBytes(bytes, o);
  throw new Error(`${name} is not a .puz file`);
}
