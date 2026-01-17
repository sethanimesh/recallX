import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { sources, words as wordsTable } from '@/src/db/schema';
import type { ExtractedWord } from '@/src/api/types';

export async function insertExtraction(
  sourceUri: string,
  sourceType: 'image' | 'pdf',
  extractedWords: ExtractedWord[],
): Promise<string[]> {
  if (extractedWords.length === 0) return [];

  const now = new Date();
  const sourceId = Crypto.randomUUID();
  const wordIds = extractedWords.map(() => Crypto.randomUUID());

  await db.transaction(async (tx) => {
    await tx.insert(sources).values({
      id: sourceId,
      type: sourceType,
      uri: sourceUri,
      created_at: now,
    });

    await tx.insert(wordsTable).values(
      extractedWords.map((w, i) => ({
        id: wordIds[i],
        word: w.word,
        definition: w.definition,
        example_sentence: w.example_sentence,
        source_id: sourceId,
        created_at: now,
        updated_at: now,
      })),
    );
  });

  return wordIds;
}
