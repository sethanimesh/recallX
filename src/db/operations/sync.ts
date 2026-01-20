import { db } from '@/src/db/client';
import { words, tags, wordTags } from '@/src/db/schema';
import { fetchWordsFromServer, fetchTagsFromServer } from '@/src/api/syncClient';
import type { ServerWordRecord } from '@/src/api/wordServerClient';

export async function syncFromServer(): Promise<void> {
  const [serverWords, serverTags] = await Promise.all([
    fetchWordsFromServer(),
    fetchTagsFromServer(),
  ]);

  await db.transaction(async (tx) => {
    await tx.delete(wordTags);
    await tx.delete(words);
    await tx.delete(tags);

    if (serverTags.length > 0) {
      await tx.insert(tags).values(
        serverTags.map((t) => ({ id: t.id, name: t.name })),
      );
    }

    const activeWords = serverWords.filter((w) => w.deleted_at === null);

    if (activeWords.length > 0) {
      await tx.insert(words).values(
        activeWords.map((w) => ({
          id: w.id,
          word: w.word,
          definition: w.definition,
          example_sentence: w.example_sentence,
          source_id: null,
          created_at: new Date(w.created_at),
          updated_at: new Date(w.updated_at),
          deleted_at: null,
        })),
      );
    }

    const wordTagPairs = activeWords.flatMap((w: ServerWordRecord) =>
      w.tags.map((t) => ({ word_id: w.id, tag_id: t.id })),
    );
    if (wordTagPairs.length > 0) {
      await tx.insert(wordTags).values(wordTagPairs);
    }
  });
}
