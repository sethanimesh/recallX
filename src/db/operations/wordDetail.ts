import { db } from '@/src/db/client';
import { words, sources, tags, wordTags } from '@/src/db/schema';
import { eq } from 'drizzle-orm';

export interface WordWithSource {
  id: string;
  word: string;
  definition: string;
  example_sentence: string;
  source_id: string | null;
  source?: { type: 'image' | 'pdf' | 'video'; uri: string; created_at: Date };
}

export async function fetchWordWithSource(id: string): Promise<WordWithSource | null> {
  const rows = await db.select().from(words).where(eq(words.id, id));
  if (rows.length === 0) return null;

  const row = rows[0];

  if (!row.source_id) {
    return {
      id: row.id,
      word: row.word,
      definition: row.definition,
      example_sentence: row.example_sentence,
      source_id: null,
    };
  }

  const sourceRows = await db.select().from(sources).where(eq(sources.id, row.source_id));
  const source = sourceRows[0];

  return {
    id: row.id,
    word: row.word,
    definition: row.definition,
    example_sentence: row.example_sentence,
    source_id: row.source_id,
    source: source
      ? { type: source.type, uri: source.uri, created_at: source.created_at }
      : undefined,
  };
}

export async function fetchWordTags(wordId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(wordTags)
    .innerJoin(tags, eq(wordTags.tag_id, tags.id))
    .where(eq(wordTags.word_id, wordId));

  return rows.map((r) => r.name);
}

export async function updateWordField(
  id: string,
  field: 'definition' | 'example_sentence',
  value: string,
): Promise<void> {
  const now = new Date();
  if (field === 'definition') {
    await db.update(words).set({ definition: value, updated_at: now }).where(eq(words.id, id));
  } else {
    await db
      .update(words)
      .set({ example_sentence: value, updated_at: now })
      .where(eq(words.id, id));
  }
}

export async function softDeleteWord(id: string): Promise<void> {
  await db.update(words).set({ deleted_at: new Date() }).where(eq(words.id, id));
}
