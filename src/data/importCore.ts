// Data pack import (SPEC §6, docs/DATA-PACK.md). Runs inside the import worker in the app
// and directly in unit tests. No DOM access.
import { openDb, type ClueEntry, type LexiconChunk } from './db';

export interface Manifest {
  format: number;
  built: string;
  words: number;
  neverUse: number;
  handRatings: number;
  themeFillBans: number;
  clueAnswers: number;
  clues: number;
  clueRange: [number, number];
  files: Record<string, number>;
  fixture?: boolean;
}

export interface StoredManifest extends Manifest {
  importedAt: string;
}

export interface DataPackFiles {
  manifest?: Blob;
  words?: Blob;
  clues?: Blob;
  myScores?: Blob;
  notebook?: Blob;
}

export interface ImportProgress {
  phase: 'words' | 'clues' | 'notebook' | 'done';
  /** 0..1 across the whole import */
  fraction: number;
  message: string;
}

export const CLUE_BATCH = 2000;

/** Map files picked by the user (any order) to their data pack role by name. */
export function classifyFiles(files: { name: string }[]): Record<keyof DataPackFiles, number> {
  const roles: Record<keyof DataPackFiles, number> = { manifest: -1, words: -1, clues: -1, myScores: -1, notebook: -1 };
  files.forEach((f, i) => {
    const n = f.name.toLowerCase();
    if (n.startsWith('manifest')) roles.manifest = i;
    else if (n.startsWith('words')) roles.words = i;
    else if (n.startsWith('clues')) roles.clues = i;
    else if (n.startsWith('my-scores')) roles.myScores = i;
    else if (n.startsWith('notebook')) roles.notebook = i;
  });
  return roles;
}

/** Read a Blob as text, gunzipping it when it starts with the gzip magic bytes. */
export async function readText(blob: Blob): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return blob.text();
}

/** Parse words.tsv into per-length packed chunks. Invalid rows are skipped. */
export function parseWords(tsv: string): Map<number, LexiconChunk> {
  const byLen = new Map<number, { words: string[]; score: number[]; nyt: number[]; last: number[] }>();
  const lines = tsv.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || (i === 0 && line.startsWith('word'))) continue;
    const [w, s, n, l] = line.replace(/\r$/, '').split('\t');
    if (!w || !/^[A-Z]{3,21}$/.test(w)) continue;
    const score = Number(s);
    if (!Number.isInteger(score) || score < 1 || score > 60) continue;
    let b = byLen.get(w.length);
    if (!b) byLen.set(w.length, (b = { words: [], score: [], nyt: [], last: [] }));
    b.words.push(w);
    b.score.push(score);
    b.nyt.push(Math.min(65535, Number(n) || 0));
    b.last.push(Number(l) || 0);
  }
  const out = new Map<number, LexiconChunk>();
  for (const [len, b] of byLen) {
    out.set(len, {
      len,
      count: b.words.length,
      words: b.words.join(''),
      score: Uint8Array.from(b.score),
      nyt: Uint16Array.from(b.nyt),
      last: Uint16Array.from(b.last),
    });
  }
  return out;
}

export function lexiconWord(chunk: LexiconChunk, i: number): string {
  return chunk.words.slice(i * chunk.len, (i + 1) * chunk.len);
}

export function notebookKey(item: { answer?: string; id?: string }, kind: 'answer' | 'theme'): string {
  return kind === 'answer' ? `answer:${(item.answer ?? '').toUpperCase().replace(/[^A-Z]/g, '')}` : `theme:${item.id}`;
}

/** Import whatever data pack files are given. Missing files leave existing data alone. */
/**
 * Import whatever data pack files are given. Missing files leave existing data alone.
 * Without manifest.json the stored manifest is kept and only the counts of what was
 * imported are replaced (word counts from words.tsv.gz, clue counts from clues.json.gz),
 * so importing files one at a time never resets the others' numbers.
 */
export async function runImport(files: DataPackFiles, progress: (p: ImportProgress) => void = () => {}): Promise<StoredManifest | null> {
  const db = await openDb();
  let manifest: Manifest | null = null;
  let patch: Partial<Manifest> | null = null;
  const sizes: Record<string, number> = {};
  if (files.manifest) manifest = JSON.parse(await readText(files.manifest)) as Manifest;

  if (files.words) {
    progress({ phase: 'words', fraction: 0.02, message: 'Reading word list' });
    const chunks = parseWords(await readText(files.words));
    progress({ phase: 'words', fraction: 0.2, message: 'Saving word list' });
    const tx = db.transaction('lexicon', 'readwrite');
    await tx.store.clear();
    for (const c of chunks.values()) await tx.store.put(c);
    await tx.done;
    let words = 0;
    let neverUse = 0;
    for (const c of chunks.values()) {
      words += c.count;
      for (const s of c.score) if (s === 1) neverUse++;
    }
    patch = { ...patch, words, neverUse };
    sizes['words.tsv.gz'] = files.words.size;
  }
  progress({ phase: 'clues', fraction: 0.3, message: 'Reading clue history' });

  if (files.clues) {
    const data = JSON.parse(await readText(files.clues)) as Record<string, ClueEntry[]>;
    const entries = Object.entries(data);
    progress({ phase: 'clues', fraction: 0.4, message: `Saving clues for ${entries.length.toLocaleString('en-US')} answers` });
    await db.clear('clues');
    let clues = 0;
    let lo = 0;
    let hi = 0;
    for (const [, list] of entries) {
      clues += list.length;
      for (const [, ymd] of list) {
        if (!ymd) continue;
        if (!lo || ymd < lo) lo = ymd;
        if (ymd > hi) hi = ymd;
      }
    }
    for (let i = 0; i < entries.length; i += CLUE_BATCH) {
      const tx = db.transaction('clues', 'readwrite');
      for (const [answer, list] of entries.slice(i, i + CLUE_BATCH)) void tx.store.put(list, answer);
      await tx.done;
      progress({
        phase: 'clues',
        fraction: 0.4 + 0.55 * Math.min(1, (i + CLUE_BATCH) / entries.length),
        message: `Saving clues ${Math.min(entries.length, i + CLUE_BATCH).toLocaleString('en-US')} of ${entries.length.toLocaleString('en-US')}`,
      });
    }
    patch = { ...patch, clueAnswers: entries.length, clues, clueRange: [lo, hi] };
    sizes['clues.json.gz'] = files.clues.size;
  }

  progress({ phase: 'notebook', fraction: 0.96, message: 'Notebook and ratings' });
  if (files.myScores) await db.put('settings', JSON.parse(await readText(files.myScores)), 'myScores');
  if (files.notebook) {
    const nb = JSON.parse(await readText(files.notebook)) as {
      clues?: { answer: string }[];
      themes?: { id: string }[];
    };
    // Kept for creating the shared Drive notebook.json (SPEC §5.4) when it doesn't exist yet.
    await db.put('settings', nb, 'datapackNotebook');
    // Seed the local notebook only when it's empty, so local edits are never overwritten.
    if ((await db.count('notebook')) === 0) {
      const tx = db.transaction('notebook', 'readwrite');
      for (const a of nb.clues ?? []) void tx.store.put(a, notebookKey(a, 'answer'));
      for (const t of nb.themes ?? []) void tx.store.put(t, notebookKey(t, 'theme'));
      await tx.done;
    }
  }

  if (!manifest && patch) {
    const old = await db.get('settings', 'manifest') as StoredManifest | undefined;
    const base: Manifest = old
      ? (({ importedAt: _i, ...m }) => m)(old)
      : { format: 1, built: '', words: 0, neverUse: 0, handRatings: 0, themeFillBans: 0, clueAnswers: 0, clues: 0, clueRange: [0, 0], files: {} };
    manifest = { ...base, ...patch, files: { ...base.files, ...sizes } };
  }

  let stored: StoredManifest | null = null;
  if (manifest) {
    stored = { ...manifest, importedAt: new Date().toISOString() };
    await db.put('settings', stored, 'manifest');
  }
  progress({ phase: 'done', fraction: 1, message: 'Import complete' });
  return stored;
}
