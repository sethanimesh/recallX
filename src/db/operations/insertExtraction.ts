import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { sources, words as wordsTable } from '@/src/db/schema';
import type { ExtractedWord } from '@/src/api/types';
import { isDuplicateWord } from '@/src/db/operations/wordDetail';
export { isDuplicateWord } from '@/src/db/operations/wordDetail';

export async function insertExtraction(
  sourceUri: string,
  sourceType: 'image' | 'pdf',
  extractedWords: ExtractedWord[],
): Promise<{ insertedIds: string[]; duplicates: string[] }> {
  if (extractedWords.length === 0) return { insertedIds: [], duplicates: [] };

  // Check for duplicates before the transaction
  const duplicates: string[] = [];
  const nonDuplicateWords: ExtractedWord[] = [];
  for (const w of extractedWords) {
    if (await isDuplicateWord(w.word)) {
      duplicates.push(w.word);
    } else {
      nonDuplicateWords.push(w);
    }
  }

  const now = new Date();
  const sourceId = Crypto.randomUUID();
  const wordIds = nonDuplicateWords.map(() => Crypto.randomUUID());

  await db.transaction(async (tx) => {
    await tx.insert(sources).values({
      id: sourceId,
      type: sourceType,
      uri: sourceUri,
      created_at: now,
    });

    if (nonDuplicateWords.length > 0) {
      await tx.insert(wordsTable).values(
        nonDuplicateWords.map((w, i) => ({
          id: wordIds[i],
          word: w.word,
          definition: w.definition,
          example_sentence: w.example_sentence,
          source_id: sourceId,
          created_at: now,
          updated_at: now,
        })),
      );
    }
  });

  return { insertedIds: wordIds, duplicates };
}
