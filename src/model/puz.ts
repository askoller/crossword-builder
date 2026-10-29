// Across Lite .puz export (SPEC §7), and a reader used to validate it in tests.
// Layout: 0x34-byte header with checksums, solution, fill state, NUL-terminated strings
// (title, author, copyright, clues in number order, notes), then extra sections:
// GRBS + RTBL for rebus squares and GEXT for circles. Text is ISO-8859-1.
import { computeSlots } from './grid';
import type { Puzzle } from './types';

const MAGIC = 'ACROSS&DOWN\0';
const VERSION = '1.3\0';
const HEADER = 0x34;

export function cksum(data: Uint8Array, start = 0): number {
  let c = start & 0xffff;
  for (let i = 0; i < data.length; i++) {
    c = c & 1 ? (c >> 1) | 0x8000 : c >> 1;
    c = (c + data[i]) & 0xffff;
  }
  return c;
}

const ASCII_FOR: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '--',
  '…': '...',
  ' ': ' ',
};

/** ISO-8859-1 bytes; typographic punctuation becomes ASCII, anything else outside Latin-1 '?'. */
export function latin1(s: string): Uint8Array {
  const t = [...s.normalize('NFC')].map((ch) => ASCII_FOR[ch] ?? ch).join('');
  const out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) {
    const code = t.charCodeAt(i);
    out[i] = code < 256 ? code : 0x3f;
  }
  return out;
}

function fromLatin1(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return s;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const z = (s: string) => concat([latin1(s), new Uint8Array([0])]);

interface Strings {
  title: string;
  author: string;
  copyright: string;
  clues: string[];
  notes: string;
}

/** Checksum of the text strings, as Across Lite computes it (version 1.3). */
function textSum(s: Strings, start: number): number {
  let c = start;
  if (s.title) c = cksum(z(s.title), c);
  if (s.author) c = cksum(z(s.author), c);
  if (s.copyright) c = cksum(z(s.copyright), c);
  for (const clue of s.clues) c = cksum(latin1(clue), c);
  if (s.notes) c = cksum(z(s.notes), c);
  return c;
}

function section(name: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  head.set(latin1(name), 0);
  const v = new DataView(head.buffer);
  v.setUint16(4, data.length, true);
  v.setUint16(6, cksum(data), true);
  return concat([head, data, new Uint8Array([0])]);
}

export interface PuzOptions {
  author?: string;
  copyright?: string;
}

/** Clue keys in .puz order: by number, Across before Down at the same number. */
export function puzClueOrder(p: Puzzle): string[] {
  const { slots } = computeSlots(p.width, p.height, p.cells);
  return slots
    .slice()
    .sort((a, b) => a.number - b.number || (a.dir === b.dir ? 0 : a.dir === 'across' ? -1 : 1))
    .map((s) => s.id);
}

/** Notes: the clue notes, one line per entry that has any. */
function notesOf(p: Puzzle, order: string[]): string {
  return order
    .filter((id) => p.clues[id]?.notes?.trim())
    .map((id) => `${id.slice(1)}${id[0] === 'A' ? 'A' : 'D'}: ${p.clues[id]!.notes!.trim()}`)
    .join('\n');
}

export function exportPuz(p: Puzzle, opts: PuzOptions = {}): Uint8Array {
  const { width: w, height: h } = p;
  if (w > 255 || h > 255) throw new Error('Grid too large for .puz');
  const n = w * h;
  const solution = new Uint8Array(n);
  const fill = new Uint8Array(n);
  const rebusKeys = new Map<string, number>();
  const grbs = new Uint8Array(n);
  const gext = new Uint8Array(n);
  p.cells.forEach((c, i) => {
    if (c.b) {
      solution[i] = fill[i] = 0x2e; // '.'
      return;
    }
    const letter = (c.rebus ?? c.l ?? '').toUpperCase();
    // Unfilled squares stay '-' in the solution, the same as an empty square in the fill.
    solution[i] = letter ? latin1(letter[0])[0] : 0x2d;
    fill[i] = 0x2d; // '-'
    if (c.rebus && c.rebus.length > 1) {
      const key = c.rebus.toUpperCase();
      if (!rebusKeys.has(key)) rebusKeys.set(key, rebusKeys.size);
      grbs[i] = rebusKeys.get(key)! + 1;
    }
    if (c.circle) gext[i] = 0x80;
  });

  const order = puzClueOrder(p);
  const strings: Strings = {
    title: p.title,
    author: opts.author ?? '',
    copyright: opts.copyright ?? '',
    clues: order.map((id) => (p.clues[id]?.text ?? '').replace(/\s+/g, ' ').trim()),
    notes: notesOf(p, order),
  };

  const header = new Uint8Array(HEADER);
  const hv = new DataView(header.buffer);
  header.set(latin1(MAGIC), 0x02);
  header.set(latin1(VERSION), 0x18);
  header[0x2c] = w;
  header[0x2d] = h;
  hv.setUint16(0x2e, order.length, true);
  hv.setUint16(0x30, 1, true);
  hv.setUint16(0x32, 0, true);

  const cib = cksum(header.subarray(0x2c, 0x34));
  hv.setUint16(0x0e, cib, true);
  let overall = cksum(solution, cib);
  overall = cksum(fill, overall);
  overall = textSum(strings, overall);
  hv.setUint16(0x00, overall, true);
  const parts = [cib, cksum(solution), cksum(fill), textSum(strings, 0)];
  const mask = latin1('ICHEATED');
  for (let i = 0; i < 4; i++) {
    header[0x10 + i] = mask[i] ^ (parts[i] & 0xff);
    header[0x14 + i] = mask[i + 4] ^ (parts[i] >> 8);
  }

  const out = [header, solution, fill, z(strings.title), z(strings.author), z(strings.copyright), ...strings.clues.map(z), z(strings.notes)];
  if (rebusKeys.size) {
    out.push(section('GRBS', grbs));
    const table = [...rebusKeys].map(([word, k]) => `${String(k).padStart(2, ' ')}:${word};`).join('');
    out.push(section('RTBL', latin1(table)));
  }
  if (gext.some((x) => x)) out.push(section('GEXT', gext));
  return concat(out);
}

// ---------- reader (validation) ----------

export interface PuzFile extends Strings {
  width: number;
  height: number;
  solution: string;
  fill: string;
  /** rebus string per square index */
  rebus: Map<number, string>;
  circles: Set<number>;
  /** every checksum in the file matched */
  checksumsOk: boolean;
  sectionNames: string[];
}

export function readPuz(bytes: Uint8Array): PuzFile {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fromLatin1(bytes.subarray(0x02, 0x0e)) !== MAGIC) throw new Error('Not a .puz file');
  const w = bytes[0x2c];
  const h = bytes[0x2d];
  const nClues = v.getUint16(0x2e, true);
  const n = w * h;
  let at = HEADER;
  const solution = bytes.subarray(at, at + n);
  at += n;
  const fill = bytes.subarray(at, at + n);
  at += n;
  const str = () => {
    const end = bytes.indexOf(0, at);
    if (end < 0) throw new Error('Truncated .puz');
    const s = fromLatin1(bytes.subarray(at, end));
    at = end + 1;
    return s;
  };
  const title = str();
  const author = str();
  const copyright = str();
  const clues = Array.from({ length: nClues }, str);
  const notes = str();
  const strings: Strings = { title, author, copyright, clues, notes };

  let ok = true;
  const cib = cksum(bytes.subarray(0x2c, 0x34));
  ok &&= v.getUint16(0x0e, true) === cib;
  ok &&= v.getUint16(0x00, true) === textSum(strings, cksum(fill, cksum(solution, cib)));
  const parts = [cib, cksum(solution), cksum(fill), textSum(strings, 0)];
  const mask = latin1('ICHEATED');
  for (let i = 0; i < 4; i++) {
    ok &&= bytes[0x10 + i] === (mask[i] ^ (parts[i] & 0xff));
    ok &&= bytes[0x14 + i] === (mask[i + 4] ^ (parts[i] >> 8));
  }

  const sections = new Map<string, Uint8Array>();
  while (at + 8 <= bytes.length) {
    const name = fromLatin1(bytes.subarray(at, at + 4));
    const len = v.getUint16(at + 4, true);
    const sum = v.getUint16(at + 6, true);
    const data = bytes.subarray(at + 8, at + 8 + len);
    ok &&= cksum(data) === sum && bytes[at + 8 + len] === 0;
    sections.set(name, data);
    at += 8 + len + 1;
  }

  const rebus = new Map<number, string>();
  const grbs = sections.get('GRBS');
  const rtbl = sections.get('RTBL');
  if (grbs && rtbl) {
    const table = new Map<number, string>();
    for (const m of fromLatin1(rtbl).matchAll(/\s*(\d+):([^;]*);/g)) table.set(Number(m[1]), m[2]);
    grbs.forEach((g, i) => {
      if (g) rebus.set(i, table.get(g - 1) ?? '');
    });
  }
  const circles = new Set<number>();
  sections.get('GEXT')?.forEach((x, i) => {
    if (x & 0x80) circles.add(i);
  });

  return {
    width: w,
    height: h,
    solution: fromLatin1(solution),
    fill: fromLatin1(fill),
    ...strings,
    rebus,
    circles,
    checksumsOk: ok,
    sectionNames: [...sections.keys()],
  };
}

/** File name for a puzzle: "<slug>-<first 8 of id>". */
export function puzzleFileBase(p: Pick<Puzzle, 'id' | 'title'>): string {
  const slug =
    p.title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'untitled';
  return `${slug}-${p.id.replace(/-/g, '').slice(0, 8)}`;
}
