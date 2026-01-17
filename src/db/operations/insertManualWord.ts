import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { words } from '@/src/db/schema';

export async function insertManualWord(
  word: string,
  definition: string,
  exampleSentence: string,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date();
  await db.insert(words).values({
    id,
    word: word.trim(),
    definition: definition.trim(),
    example_sentence: exampleSentence.trim(),
    source_id: null,
    created_at: now,
    updated_at: now,
  });
  return id;
}
