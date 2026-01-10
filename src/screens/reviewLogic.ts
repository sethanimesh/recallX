import type { ExtractedWord } from '@/src/api/types';

/**
 * Pure helper: given a list of words and a parallel array of accept/reject
 * decisions (true = accept, false = reject), returns only the accepted words.
 *
 * @param words     - The full list of candidate words shown during review.
 * @param decisions - Boolean array where decisions[i] === true means word[i] was accepted.
 *                    Must have the same length as `words`.
 * @returns The subset of `words` where the corresponding decision was `true`.
 */
export function buildReviewResult(
  words: ExtractedWord[],
  decisions: boolean[],
): ExtractedWord[] {
  return words.filter((_, i) => decisions[i] === true);
}
