import { buildReviewResult } from '@/src/screens/reviewLogic';
import type { ExtractedWord } from '@/src/api/types';

const words: ExtractedWord[] = [
  { word: 'pellucid', definition: 'Translucently clear.', example_sentence: 'A pellucid explanation.' },
  { word: 'ephemeral', definition: 'Lasting briefly.', example_sentence: 'The joy was ephemeral.' },
  { word: 'lucid', definition: 'Clearly expressed.', example_sentence: 'A lucid description.' },
];

describe('buildReviewResult', () => {
  it('returns only accepted words', () => {
    const decisions = [true, false, true];
    const result = buildReviewResult(words, decisions);
    expect(result).toHaveLength(2);
    expect(result[0].word).toBe('pellucid');
    expect(result[1].word).toBe('lucid');
  });

  it('returns empty array when all rejected', () => {
    const decisions = [false, false, false];
    const result = buildReviewResult(words, decisions);
    expect(result).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it('returns all words when all accepted', () => {
    const decisions = [true, true, true];
    const result = buildReviewResult(words, decisions);
    expect(result).toHaveLength(3);
    expect(result).toEqual(words);
  });

  it('returns empty array for empty input', () => {
    const result = buildReviewResult([], []);
    expect(result).toEqual([]);
  });

  it('handles single word accepted', () => {
    const single = [words[0]];
    const result = buildReviewResult(single, [true]);
    expect(result).toEqual([words[0]]);
  });

  it('handles single word rejected', () => {
    const single = [words[0]];
    const result = buildReviewResult(single, [false]);
    expect(result).toEqual([]);
  });
});
