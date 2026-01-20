import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { tags, wordTags, words } from '@/src/db/schema';
import { eq, and, isNull, asc, sql } from 'drizzle-orm';
import {
  postTag,
  patchTag as serverPatchTag,
  deleteTag as serverDeleteTag,
  addTagToWord as serverAddTagToWord,
  removeTagFromWord as serverRemoveTagFromWord,
  WordServerError,
} from '@/src/api/wordServerClient';

export interface Tag {
  id: string;
  name: string;
}

export interface WordRow {
  id: string;
  word: string;
  definition: string;
  example_sentence: string;
  source_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export async function createOrGetTag(name: string): Promise<string> {
  const trimmed = name.trim();
  const id = Crypto.randomUUID();
  try {
    await postTag({ id, name: trimmed });
    await db.insert(tags).values({ id, name: trimmed });
    return id;
  } catch (err) {
    if (err instanceof WordServerError && err.statusCode === 409) {
      // Tag already exists on server — find it in local DB (synced on start)
      const existing = await db
        .select({ id: tags.id })
        .from(tags)
        .where(sql`lower(${tags.name}) = lower(${trimmed})`);
      if (existing.length > 0) return existing[0].id;
      throw new Error(`Tag "${trimmed}" exists on server but not found locally`);
    }
    throw err;
  }
}

export async function getAllTags(): Promise<Tag[]> {
  return db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(asc(tags.name));
}

export async function getTagsForWord(wordId: string): Promise<Tag[]> {
  const rows = await db
    .select({ id: tags.id, name: tags.name })
    .from(wordTags)
    .innerJoin(tags, eq(wordTags.tag_id, tags.id))
    .where(eq(wordTags.word_id, wordId));
  return rows;
}

export async function addTagToWord(wordId: string, tagId: string): Promise<void> {
  await serverAddTagToWord(wordId, tagId);
  await db.insert(wordTags).values({ word_id: wordId, tag_id: tagId }).onConflictDoNothing();
}

export async function removeTagFromWord(wordId: string, tagId: string): Promise<void> {
  try {
    await serverRemoveTagFromWord(wordId, tagId);
  } catch (err) {
    if (err instanceof WordServerError && err.statusCode === 404) {
      // Already gone from server — proceed with local removal
    } else {
      throw err;
    }
  }
  await db.delete(wordTags).where(and(eq(wordTags.word_id, wordId), eq(wordTags.tag_id, tagId)));
}

export async function renameTag(tagId: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  await serverPatchTag(tagId, { name: trimmed }); // throws WordServerError(409) on name collision
  await db.update(tags).set({ name: trimmed }).where(eq(tags.id, tagId));
}

export async function deleteTag(tagId: string): Promise<void> {
  await serverDeleteTag(tagId);
  await db.delete(wordTags).where(eq(wordTags.tag_id, tagId));
  await db.delete(tags).where(eq(tags.id, tagId));
}

export async function fetchWordsByTag(tagId: string): Promise<WordRow[]> {
  return db
    .select({
      id: words.id,
      word: words.word,
      definition: words.definition,
      example_sentence: words.example_sentence,
      source_id: words.source_id,
      created_at: words.created_at,
      updated_at: words.updated_at,
      deleted_at: words.deleted_at,
    })
    .from(words)
    .innerJoin(wordTags, eq(wordTags.word_id, words.id))
    .where(and(eq(wordTags.tag_id, tagId), isNull(words.deleted_at)))
    .orderBy(asc(words.word));
}

export async function fetchAllWords(): Promise<WordRow[]> {
  return db
    .select({
      id: words.id,
      word: words.word,
      definition: words.definition,
      example_sentence: words.example_sentence,
      source_id: words.source_id,
      created_at: words.created_at,
      updated_at: words.updated_at,
      deleted_at: words.deleted_at,
    })
    .from(words)
    .where(isNull(words.deleted_at))
    .orderBy(asc(words.word));
}

export async function getTagWordCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ tag_id: wordTags.tag_id, count: sql<number>`count(*)` })
    .from(wordTags)
    .groupBy(wordTags.tag_id);

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.tag_id] = Number(row.count);
  return counts;
}
