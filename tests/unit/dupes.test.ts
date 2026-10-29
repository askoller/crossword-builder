// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { dupeOf, DupeTracker, Segmenter, shared4, type DupeOptions } from '../../src/engine/dupes';
import { DEFAULT_AFFIXES } from '../../src/engine/settings';
import { fixtureLexicon } from './helpers';

let o: DupeOptions;
beforeAll(async () => {
  o = { affixes: DEFAULT_AFFIXES, segmenter: Segmenter.forLexicon(await fixtureLexicon()) };
});

describe('dupe rules (SPEC §4.5)', () => {
  it('rule 1: shared 4-letter strings', () => {
    expect(dupeOf('SPOUSE', 'SPOUSES', o)).toEqual({ rule: 'substring', detail: 'SPOU' });
    expect(dupeOf('PARTS', 'APART', o)).toEqual({ rule: 'substring', detail: 'PART' });
    expect(shared4('CAT', 'CATS', DEFAULT_AFFIXES)).toBeNull();
  });

  it('rule 1: affix exception at the same end (NATION / RATION)', () => {
    expect(dupeOf('NATION', 'RATION', o)).toBeNull();
    // without the affix list they share ATIO
    expect(shared4('NATION', 'RATION', [])).toBe('ATIO');
    // the shared string must be at the same end of both words
    expect(shared4('TIONAL', 'NATION', DEFAULT_AFFIXES)).toBe('TION');
    // sharing more than the affix (plus 3 letters) is still a dupe
    expect(shared4('STATION', 'NOTATION', DEFAULT_AFFIXES)).toBeNull();
    expect(shared4('CREATION', 'RECREATION', DEFAULT_AFFIXES)).toBe('CREA');
  });

  it('rule 2: word inside a phrase', () => {
    expect(dupeOf('ERE', 'ERENOW', o)).toEqual({ rule: 'phrase', detail: 'ERE' });
    expect(dupeOf('ERENOW', 'ERE', o)).toEqual({ rule: 'phrase', detail: 'ERE' });
    // TEA PARTY is a Notebook answer typed with a space
    expect(dupeOf('TEA', 'TEAPARTY', o)).toEqual({ rule: 'phrase', detail: 'TEA' });
  });

  it('rule 2: plain substrings that are not component words are fine (AND / STANDUP)', () => {
    expect(o.segmenter.parts('STANDUP')).toEqual(['STAND', 'UP']);
    expect(dupeOf('AND', 'STANDUP', o)).toBeNull();
  });

  it('rule 3: the same entry twice', () => {
    expect(dupeOf('ERA', 'ERA', o)).toEqual({ rule: 'same', detail: 'ERA' });
  });

  it('tracker reports the owner of the clashing entry', () => {
    const t = new DupeTracker(o);
    t.add('SPOUSE', 3);
    t.add('ERENOW', -1);
    t.add('NATION', 5);
    expect(t.conflict('SPOUSES')?.owner).toBe(3);
    expect(t.conflict('ERE')).toMatchObject({ owner: -1, with: 'ERENOW', dupe: { rule: 'phrase' } });
    expect(t.conflict('RATION')).toBeNull();
    expect(t.conflict('AND')).toBeNull();
    t.remove('SPOUSE', 3);
    expect(t.conflict('SPOUSES')).toBeNull();
    expect(t.conflict('NATION')?.dupe.rule).toBe('same');
  });
});
