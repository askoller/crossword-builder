import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyCell, type Puzzle } from '../../src/model/types';
import { newPuzzle } from '../../src/model/grid';

export const FIXTURES = join(process.cwd(), 'fixtures');

export function fixtureGrid(id: string): Puzzle {
  return JSON.parse(readFileSync(join(FIXTURES, 'grids', `${id}.json`), 'utf8')) as Puzzle;
}

/** Build a puzzle from rows: '#' block, '.' empty, A–Z typed letter, a–z locked letter. */
export function fromRows(rows: string[]): Puzzle {
  const p = newPuzzle({ width: rows[0].length, height: rows.length, day: 'Tue', outlet: 'NYT' });
  p.cells = rows.join('').split('').map((ch) => {
    const c = emptyCell();
    if (ch === '#') c.b = 1;
    else if (/[A-Z]/.test(ch)) Object.assign(c, { l: ch, src: 'typed' });
    else if (/[a-z]/.test(ch)) Object.assign(c, { l: ch.toUpperCase(), lock: 1, src: 'theme' });
    return c;
  });
  return p;
}

export function rowsOf(p: Puzzle): string[] {
  const out: string[] = [];
  for (let r = 0; r < p.height; r++) {
    out.push(
      p.cells
        .slice(r * p.width, (r + 1) * p.width)
        .map((c) => (c.b ? '#' : c.l ? (c.lock ? c.l.toLowerCase() : c.l) : '.'))
        .join(''),
    );
  }
  return out;
}

let fixtureLex: import('../../src/engine/lexicon').Lexicon | null = null;

/** The fixture word list as an engine lexicon, with the fixture Notebook boosts (cached). */
export async function fixtureLexicon(): Promise<import('../../src/engine/lexicon').Lexicon> {
  if (fixtureLex) return fixtureLex;
  const { gunzipSync } = await import('node:zlib');
  const { parseWords } = await import('../../src/data/importCore');
  const { Lexicon } = await import('../../src/engine/lexicon');
  const tsv = gunzipSync(readFileSync(join(FIXTURES, 'words.tsv.gz'))).toString('utf8');
  const nb = JSON.parse(readFileSync(join(FIXTURES, 'notebook.json'), 'utf8')) as { clues: { answer: string; boost: number }[] };
  fixtureLex = new Lexicon(parseWords(tsv).values(), { notebook: nb.clues });
  return fixtureLex;
}
