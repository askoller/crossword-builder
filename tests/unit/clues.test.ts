import { describe, expect, it } from 'vitest';
import { clusterAngles, contentWords, filterHistory, formatYmd, nearDuplicates, type HistoryClue } from '../../src/model/clues';

const H: HistoryClue[] = [
  ['Long period of time', 20240304, 0],
  ['Historical period', 20221110, 3],
  ['Jazz ___', 20180505, 5],
  ['Baseball stat', 20120102, 0],
  ['Pitching stat, briefly', 20090606, 5],
  ['Geologic period', 20011201, 5],
  ['Victorian ___', 19990101, 4],
];

describe('near-duplicate matcher', () => {
  it('flags clues sharing most content words', () => {
    const m = nearDuplicates('Long time period', H);
    expect(m.map((x) => x.index)).toContain(0);
    expect(m[0].index).toBe(0);
    expect(m[0].overlap).toBeCloseTo(1);
  });

  it('ignores case, punctuation and stop words', () => {
    expect(nearDuplicates('A GEOLOGIC PERIOD!', H).map((x) => x.index)).toEqual([5]);
    expect(nearDuplicates('Pitching stat', H).map((x) => x.index)).toContain(4);
  });

  it('flags containment as whole words', () => {
    const m = nearDuplicates('Long period', H);
    expect(m.find((x) => x.index === 0)?.contains).toBe(true);
    expect(nearDuplicates('Baseball stat leader, often', H).find((x) => x.index === 3)?.contains).toBe(true);
  });

  it('does not flag fresh angles or one-word partial drafts', () => {
    expect(nearDuplicates('Reign of Elizabeth II, e.g.', H)).toEqual([]);
    expect(nearDuplicates('period', H).filter((x) => x.contains)).toEqual([]);
    expect(nearDuplicates('', H)).toEqual([]);
    // 1 of 3 shared content words is below 0.6
    expect(nearDuplicates('Period piece costume', H)).toEqual([]);
  });

  it('extracts content words', () => {
    expect(contentWords("Andrew’s go-to stat, in the majors")).toEqual(['andrews', 'go', 'stat', 'majors']);
  });
});

describe('angle split', () => {
  it('clusters by the most shared content word, then other', () => {
    const a = clusterAngles(H);
    expect(a[0]).toEqual({ label: 'period', indices: [0, 1, 5] });
    expect(a[1]).toEqual({ label: 'stat', indices: [3, 4] });
    expect(a.at(-1)).toEqual({ label: 'other', indices: [2, 6] });
    expect(a.reduce((n, x) => n + x.indices.length, 0)).toBe(H.length);
  });

  it('caps at 3 clusters and needs 2 clues per cluster', () => {
    const many: HistoryClue[] = ['a fox', 'b fox', 'c owl', 'd owl', 'e elk', 'f elk', 'g yak', 'h yak', 'solo'].map((c, i) => [c, 20200101 + i, 0]);
    const a = clusterAngles(many);
    expect(a.map((x) => x.label)).toEqual(['elk', 'fox', 'owl', 'other']);
    expect(a.at(-1)!.label).toBe('other');
    expect(a.at(-1)!.indices).toEqual([6, 7, 8]);
    expect(clusterAngles([['Only one', 20200101, 0]])).toEqual([{ label: 'other', indices: [0] }]);
  });
});

describe('history filters', () => {
  it('filters since 2015 and Thu–Sat', () => {
    expect(filterHistory(H, 'all').length).toBe(7);
    expect(filterHistory(H, 'since2015')).toEqual([0, 1, 2]);
    expect(filterHistory(H, 'late')).toEqual([1, 2, 4, 5, 6]);
    expect(formatYmd(20240304)).toBe('Mar 4, 2024');
  });
});
