/**
 * Pure helper: filter a list of word rows by a search query.
 *
 * @param words - Array of objects that have at least a `word` string field.
 * @param query - The search string typed by the user.
 * @returns The subset of `words` whose `word` field contains `query` (case-insensitive).
 *          Returns the full list when `query` is empty or whitespace-only.
 */
export function filterWords<T extends { word: string }>(
  words: T[],
  query: string,
): T[] {
  if (!query.trim()) return words;
  const lower = query.toLowerCase();
  return words.filter((w) => w.word.toLowerCase().includes(lower));
}
