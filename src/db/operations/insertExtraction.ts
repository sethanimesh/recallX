// @ts-nocheck
import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { sources, words as wordsTable } from '@/src/db/schema';
import type { ExtractedWord } from '@/src/api/types';
import { postWord, WordServerError } from '@/src/api/wordServerClient';
import { sql } from 'drizzle-orm';
import { syncFromServer } from './sync';

export async function insertExtraction(
  sourceUri: string,
  sourceType: 'image' | 'pdf',
  extractedWords: ExtractedWord[],
): Promise<{ id: string; word: string; isNew: boolean }[]> {
  if (extractedWords.length === 0) return [];

  const now = Date.now();
  const toInsert: Array<{ word: ExtractedWord; id: string }> = [];
  const results: Array<{ id: string; word: string; isNew: boolean }> = [];

  for (const w of extractedWords) {
    let id = Crypto.randomUUID();
    w.word = w.word.trim().replace(/^\w/, (c) => c.toUpperCase());
    
    // Check local db first
    let existing = await db
      .select({ id: wordsTable.id })
      .from(wordsTable)
      .where(sql`lower(${wordsTable.word}) = lower(${w.word}) AND ${wordsTable.definition} = ${w.definition.trim()} AND ${wordsTable.deleted_at} IS NULL`);
      
    if (existing.length > 0) {
      results.push({ id: existing[0].id, word: w.word, isNew: false });
      continue;
    }

    try {
      const saved = await postWord({
        id,
        word: w.word,
        definition: w.definition,
        example_sentence: w.example_sentence,
        mnemonic: w.mnemonic ?? null,
        source_type: sourceType,
        created_at: now,
        updated_at: now,
      });
      id = saved?.id ?? id;
      toInsert.push({ word: w, id });
      results.push({ id, word: w.word, isNew: true });
    } catch (err) {
      if (err instanceof WordServerError && err.statusCode === 409) {
        await syncFromServer();
        existing = await db
          .select({ id: wordsTable.id })
          .from(wordsTable)
          .where(sql`lower(${wordsTable.word}) = lower(${w.word}) AND ${wordsTable.definition} = ${w.definition.trim()} AND ${wordsTable.deleted_at} IS NULL`);
        
        if (existing.length > 0) {
          results.push({ id: existing[0].id, word: w.word, isNew: false });
        } else if (err.data?.word_id) {
          results.push({ id: err.data.word_id, word: w.word, isNew: false });
        } else {
          results.push({ id: '', word: w.word, isNew: false });
        }
      } else {
        throw err;
      }
    }
  }

  if (toInsert.length > 0) {
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
          mnemonic: w.mnemonic ?? null,
          source_id: sourceId,
          created_at: nowDate,
          updated_at: nowDate,
        })),
      ).onConflictDoNothing();
    });
  }

  return results;
}
