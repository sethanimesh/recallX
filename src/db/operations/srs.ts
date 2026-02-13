import { db } from '@/src/db/client';
import { words, wordTags } from '@/src/db/schema';
import { isNull, lte, or, eq, and, asc } from 'drizzle-orm';
import type { WordRow } from '@/src/db/operations/tags';

export interface WordSRSRow extends WordRow {
  srs_interval: number;
  srs_ease_factor: number;
  srs_next_review_at: Date | null;
  srs_wrong_count: number;
  srs_consecutive_correct: number;
}

const SRS_COLUMNS = {
  id: words.id,
  word: words.word,
  definition: words.definition,
  example_sentence: words.example_sentence,
  source_id: words.source_id,
  created_at: words.created_at,
  updated_at: words.updated_at,
  deleted_at: words.deleted_at,
  srs_interval: words.srs_interval,
  srs_ease_factor: words.srs_ease_factor,
  srs_next_review_at: words.srs_next_review_at,
  srs_wrong_count: words.srs_wrong_count,
  srs_consecutive_correct: words.srs_consecutive_correct,
};

export async function fetchDueWords(tagId?: string): Promise<WordSRSRow[]> {
  const now = new Date();
  const dueFilter = or(isNull(words.srs_next_review_at), lte(words.srs_next_review_at, now));

  if (tagId) {
    return db
      .select(SRS_COLUMNS)
      .from(words)
      .innerJoin(wordTags, eq(wordTags.word_id, words.id))
      .where(and(eq(wordTags.tag_id, tagId), isNull(words.deleted_at), dueFilter))
      .orderBy(asc(words.word));
  }

  return db
    .select(SRS_COLUMNS)
    .from(words)
    .where(and(isNull(words.deleted_at), dueFilter))
    .orderBy(asc(words.word));
}

export async function updateWordSRS(
  wordId: string,
  interval: number,
  easeFactor: number,
  nextReviewAt: Date,
  wrongCount: number,
  consecutiveCorrect: number,
): Promise<void> {
  await db
    .update(words)
    .set({
      srs_interval: interval,
      srs_ease_factor: easeFactor,
      srs_next_review_at: nextReviewAt,
      srs_wrong_count: wrongCount,
      srs_consecutive_correct: consecutiveCorrect,
      updated_at: new Date(),
    })
    .where(eq(words.id, wordId));
}
