import { filterWords } from '@/src/screens/libraryLogic';

const words = [
  { word: 'ephemeral', definition: 'Lasting for a very short time.' },
  { word: 'pellucid', definition: 'Translucently clear.' },
  { word: 'sanguine', definition: 'Optimistic, especially in a difficult situation.' },
  { word: 'Ephemeral', definition: 'Duplicate with capital E for case test.' },
];

describe('filterWords', () => {
  it('returns all words when query is empty', () => {
    expect(filterWords(words, '')).toHaveLength(words.length);
  });

  it('returns all words when query is whitespace-only', () => {
    expect(filterWords(words, '   ')).toHaveLength(words.length);
  });

  it('matches a substring (lowercase query)', () => {
    const result = filterWords(words, 'pell');
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe('pellucid');
  });

  it('is case-insensitive (uppercase query matches lowercase word)', () => {
    const result = filterWords(words, 'SANG');
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe('sanguine');
  });

  it('is case-insensitive (lowercase query matches mixed-case word)', () => {
    // both 'ephemeral' and 'Ephemeral' should match 'ephemeral'
    const result = filterWords(words, 'ephemeral');
    expect(result).toHaveLength(2);
    expect(result.map((w) => w.word)).toContain('ephemeral');
    expect(result.map((w) => w.word)).toContain('Ephemeral');
  });

  it('returns empty array when no word matches', () => {
    const result = filterWords(words, 'zzz');
    expect(result).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty input list', () => {
    expect(filterWords([], 'anything')).toEqual([]);
  });

  it('matches full word exactly', () => {
    const result = filterWords(words, 'sanguine');
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe('sanguine');
  });
});
