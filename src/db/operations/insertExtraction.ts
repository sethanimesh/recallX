import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { sources, words as wordsTable } from '@/src/db/schema';
import type { ExtractedWord } from '@/src/api/types';
import { postWord, WordServerError } from '@/src/api/wordServerClient';

export async function insertExtraction(
  sourceUri: string,
  sourceType: 'image' | 'pdf',
  extractedWords: ExtractedWord[],
): Promise<{ insertedIds: string[]; duplicates: string[] }> {
  if (extractedWords.length === 0) return { insertedIds: [], duplicates: [] };

  const now = Date.now();
  const duplicates: string[] = [];
  const toInsert: Array<{ word: ExtractedWord; id: string }> = [];

  for (const w of extractedWords) {
    const id = Crypto.randomUUID();
    try {
      await postWord({
        id,
        word: w.word,
        definition: w.definition,
        example_sentence: w.example_sentence,
        source_type: sourceType,
        created_at: now,
        updated_at: now,
      });
      toInsert.push({ word: w, id });
    } catch (err) {
      if (err instanceof WordServerError && err.statusCode === 409) {
        duplicates.push(w.word);
      } else {
        throw err;
      }
    }
  }

  if (toInsert.length === 0) return { insertedIds: [], duplicates };

  const sourceId = Crypto.randomUUID();
  const nowDate = new Date(now);

  await db.transaction(async (tx) => {
    await tx.insert(sources).values({
      id: sourceId,
      type: sourceType,
      uri: sourceUri,
      created_at: nowDate,
    });
    await tx.insert(wordsTable).values(
      toInsert.map(({ word: w, id }) => ({
        id,
        word: w.word,
        definition: w.definition,
        example_sentence: w.example_sentence,
        source_id: sourceId,
        created_at: nowDate,
        updated_at: nowDate,
      })),
    );
  });

  return { insertedIds: toInsert.map((x) => x.id), duplicates };
}
