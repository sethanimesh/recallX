import { deleteWord, patchWord, generateMnemonic } from '@/src/api/wordServerClient';
import { db } from '@/src/db/client';
import { sources, tags, words, wordTags } from '@/src/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';

export async function isDuplicateWord(word: string): Promise<boolean> {
  const rows = await db
    .select({ id: words.id })
    .from(words)
    .where(sql`lower(${words.word}) = lower(${word}) AND ${words.deleted_at} IS NULL`)
    .limit(1);
  return rows.length > 0;
}

export interface WordWithSource {
  id: string;
  word: string;
  content_revision?: number;
  definition: string;
  example_sentence: string;
  mnemonic: string | null;
  source_id: string | null;
  source?: { type: 'image' | 'pdf' | 'video'; uri: string; created_at: Date };
}

export async function fetchWordWithSource(id: string): Promise<WordWithSource | null> {
  const rows = await db.select().from(words).where(and(eq(words.id, id), isNull(words.deleted_at)));
  if (rows.length === 0) return null;

  const row = rows[0];

  if (!row.source_id) {
    return {
      id: row.id,
      word: row.word,
      content_revision: row.content_revision,
      definition: row.definition,
      example_sentence: row.example_sentence,
      mnemonic: row.mnemonic,
      source_id: null,
    };
  }

  const sourceRows = await db.select().from(sources).where(eq(sources.id, row.source_id));
  const source = sourceRows[0];

  return {
    id: row.id,
    word: row.word,
    content_revision: row.content_revision,
    definition: row.definition,
    example_sentence: row.example_sentence,
    mnemonic: row.mnemonic,
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
  field: 'word' | 'definition' | 'example_sentence' | 'mnemonic',
  value: string,
  expectedRevision?: number,
): Promise<number> {
  let updatedValue = value.trim();
  if (field === 'word') {
    updatedValue = updatedValue.replace(/^\w/, (c) => c.toUpperCase());
  }
  const existing = await db.select().from(words).where(eq(words.id, id));
  const result = await patchWord(id, { [field]: updatedValue, expected_content_revision: expectedRevision ?? existing[0]?.content_revision ?? 1 });
  if (result?.content_revision) await db.update(words).set({ content_revision: result.content_revision }).where(eq(words.id, id));
  const now = new Date();
  if (field === 'word') {
    await db.update(words).set({ word: updatedValue, updated_at: now }).where(eq(words.id, id));
  } else if (field === 'definition') {
    await db.update(words).set({ definition: updatedValue, updated_at: now }).where(eq(words.id, id));
  } else if (field === 'example_sentence') {
    await db.update(words).set({ example_sentence: updatedValue, updated_at: now }).where(eq(words.id, id));
  } else {
    await db.update(words).set({ mnemonic: updatedValue, updated_at: now }).where(eq(words.id, id));
  }
  return result?.content_revision ?? existing[0]?.content_revision ?? 1;
}

export async function softDeleteWord(id: string): Promise<void> {
  const existing = await db.select().from(words).where(eq(words.id, id));
  const result = await deleteWord(id, undefined, existing[0]?.content_revision);
  const deletedAtMs = result?.deleted_at ? new Date(result.deleted_at) : new Date();
  await db.update(words).set({ deleted_at: deletedAtMs }).where(eq(words.id, id));
}

export async function generateMnemonicForWord(id: string): Promise<string | null> {
  const result = await generateMnemonic(id);
  if (result && result.mnemonic) {
    await db.update(words).set({ mnemonic: result.mnemonic, updated_at: new Date() }).where(eq(words.id, id));
    return result.mnemonic;
  }
  return null;
}
