// Clue history lookups (one key read per answer) and word facts from the lexicon.
import { lexiconWord } from './importCore';
import { openDb, type ClueEntry, type LexiconChunk } from './db';

export async function getClueHistory(answer: string): Promise<ClueEntry[]> {
  return (await (await openDb()).get('clues', answer.toUpperCase())) ?? [];
}

/** Answers in the clue history starting with a prefix, for the Clues browser. */
export async function suggestAnswers(prefix: string, limit = 30): Promise<string[]> {
  const p = prefix.toUpperCase().replace(/[^A-Z]/g, '');
  if (!p) return [];
  return (await openDb()).getAllKeys('clues', IDBKeyRange.bound(p, p + '￿'), limit);
}

export interface WordFacts {
  score: number;
  nyt: number;
  last: number;
}

const chunks = new Map<number, Promise<LexiconChunk | undefined>>();

/** Forget cached lexicon chunks (after an import). */
export function resetWordCache(): void {
  chunks.clear();
}

/** Score, NYT count and last year for one word, or null when it isn't in the word list. */
export async function wordFacts(word: string): Promise<WordFacts | null> {
  const w = word.toUpperCase();
  if (!/^[A-Z]{3,21}$/.test(w)) return null;
  let chunk = chunks.get(w.length);
  if (!chunk) chunks.set(w.length, (chunk = openDb().then((db) => db.get('lexicon', w.length))));
  const c = await chunk;
  if (!c) return null;
  // Words within a length are stored concatenated; only hits on a word boundary count.
  for (let at = c.words.indexOf(w); at >= 0; at = c.words.indexOf(w, at + 1)) {
    if (at % c.len === 0) {
      const i = at / c.len;
      if (lexiconWord(c, i) === w) return { score: c.score[i], nyt: c.nyt[i], last: c.last[i] };
    }
  }
  return null;
}
