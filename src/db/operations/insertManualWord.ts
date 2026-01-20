import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { words } from '@/src/db/schema';
import { postWord } from '@/src/api/wordServerClient';

export async function insertManualWord(
  word: string,
  definition: string,
  exampleSentence: string,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = Date.now();
  const nowDate = new Date(now);

  // Throws WordServerError(409) if duplicate — caller surfaces as alert
  await postWord({
    id,
    word: word.trim(),
    definition: definition.trim(),
    example_sentence: exampleSentence.trim(),
    source_type: null,
    created_at: now,
    updated_at: now,
  });

  await db.insert(words).values({
    id,
    word: word.trim(),
    definition: definition.trim(),
    example_sentence: exampleSentence.trim(),
    source_id: null,
    created_at: nowDate,
    updated_at: nowDate,
  });
  return id;
}
