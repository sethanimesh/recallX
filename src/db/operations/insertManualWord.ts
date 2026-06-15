import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { words } from '@/src/db/schema';
import { sql } from 'drizzle-orm';
import { postWord, WordServerError } from '@/src/api/wordServerClient';
import { syncFromServer } from './sync';

export async function insertManualWord(
  word: string,
  definition: string,
  exampleSentence: string,
): Promise<{ id: string; isNew: boolean }> {
  const id = Crypto.randomUUID();
  const now = Date.now();
  const nowDate = new Date(now);

  const capitalized = word.trim().replace(/^\w/, (c) => c.toUpperCase());

  // Check local db first
  let existing = await db
    .select({ id: words.id })
    .from(words)
    .where(sql`lower(${words.word}) = lower(${capitalized})`);
  if (existing.length > 0) {
    return { id: existing[0].id, isNew: false };
  }

  try {
    await postWord({
      id,
      word: capitalized,
      definition: definition.trim(),
      example_sentence: exampleSentence.trim(),
      mnemonic: null,
      source_type: null,
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    if (err instanceof WordServerError && err.statusCode === 409) {
      await syncFromServer();
      existing = await db
        .select({ id: words.id })
        .from(words)
        .where(sql`lower(${words.word}) = lower(${capitalized})`);
      if (existing.length > 0) {
        return { id: existing[0].id, isNew: false };
      }
      // If it still isn't found locally after sync, fallback to data from the error
      if (err.data?.word_id) {
        return { id: err.data.word_id, isNew: false };
      }
    }
    throw err;
  }

  await db.insert(words).values({
    id,
    word: capitalized,
    definition: definition.trim(),
    example_sentence: exampleSentence.trim(),
    mnemonic: null,
    source_id: null,
    created_at: nowDate,
    updated_at: nowDate,
  });
  return { id, isNew: true };
}
