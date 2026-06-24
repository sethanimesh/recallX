// @ts-nocheck
import { db } from '@/src/db/client';
import { sessions, sessionResults, words, wordTags } from '@/src/db/schema';
import { eq, and, isNull, gte, desc } from 'drizzle-orm';
import type { WordSRSRow } from '@/src/db/operations/srs';

const RECALL_TODAY_COLUMNS = {
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
  fc_wrong_count: words.fc_wrong_count,
  mnemonic: words.mnemonic,
};

const FLASHCARD_TODAY_COLUMNS = {
  id: words.id,
  word: words.word,
  definition: words.definition,
  example_sentence: words.example_sentence,
  source_id: words.source_id,
  created_at: words.created_at,
  updated_at: words.updated_at,
  deleted_at: words.deleted_at,
  srs_interval: words.fc_interval,
  srs_ease_factor: words.fc_ease_factor,
  srs_next_review_at: words.fc_next_review_at,
  srs_wrong_count: words.fc_wrong_count,
  srs_consecutive_correct: words.fc_consecutive_correct,
  fc_wrong_count: words.fc_wrong_count,
  mnemonic: words.mnemonic,
};

export interface SessionResultRow {
  word_id: string;
  correct: number;
  attempt_number: number;
  answered_at: Date;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function insertSession(
  id: string,
  mode: 'recall' | 'flashcard',
  tagId: string | undefined,
): Promise<void> {
  await db.insert(sessions).values({
    id,
    mode,
    tag_id: tagId ?? null,
    started_at: new Date(),
  });
}

export async function closeSession(id: string): Promise<void> {
  await db.update(sessions).set({ ended_at: new Date() }).where(eq(sessions.id, id));
}

export async function insertSessionResult(
  sessionId: string,
  wordId: string,
  correct: boolean,
  attemptNumber: number,
): Promise<void> {
  await db.insert(sessionResults).values({
    id: generateId(),
    session_id: sessionId,
    word_id: wordId,
    correct: correct ? 1 : 0,
    attempt_number: attemptNumber,
    answered_at: new Date(),
  });
}

export async function fetchLastSessionStartTime(mode: 'recall' | 'flashcard'): Promise<Date> {
  const result = await db
    .select({ started_at: sessions.started_at })
    .from(sessions)
    .where(eq(sessions.mode, mode))
    .orderBy(desc(sessions.started_at))
    .limit(1);
  return result[0]?.started_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
}

export async function fetchRecentlyWrongIds(
  mode: 'recall' | 'flashcard',
  dueWordIds: string[],
): Promise<string[]> {
  if (dueWordIds.length === 0) return [];
  const sinceTimestamp = await fetchLastSessionStartTime(mode);

  const wrongRows = await db
    .select({ word_id: sessionResults.word_id })
    .from(sessionResults)
    .innerJoin(sessions, eq(sessionResults.session_id, sessions.id))
    .where(
      and(
        eq(sessions.mode, mode),
        eq(sessionResults.correct, 0),
        gte(sessionResults.answered_at, sinceTimestamp),
      ),
    );

  const dueSet = new Set(dueWordIds);
  const wrongSet = new Set(wrongRows.map(r => r.word_id));
  return dueWordIds.filter(id => wrongSet.has(id) && dueSet.has(id));
}

export async function fetchTodayWordIds(dueWordIds: string[]): Promise<string[]> {
  if (dueWordIds.length === 0) return [];
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayRows = await db
    .select({ id: words.id })
    .from(words)
    .where(and(isNull(words.deleted_at), gte(words.created_at, todayStart)));

  const dueSet = new Set(dueWordIds);
  return todayRows.map(w => w.id).filter(id => dueSet.has(id));
}

export async function fetchTodayWordCount(): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: words.id })
    .from(words)
    .where(and(isNull(words.deleted_at), gte(words.created_at, todayStart)));
  return rows.length;
}

export async function fetchWordHistory(wordId: string, limit: number): Promise<SessionResultRow[]> {
  return db
    .select({
      word_id: sessionResults.word_id,
      correct: sessionResults.correct,
      attempt_number: sessionResults.attempt_number,
      answered_at: sessionResults.answered_at,
    })
    .from(sessionResults)
    .where(eq(sessionResults.word_id, wordId))
    .orderBy(desc(sessionResults.answered_at))
    .limit(limit);
}

export async function fetchWordsCreatedTodayForRecall(tagId?: string): Promise<WordSRSRow[]> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (tagId) {
    return db
      .select(RECALL_TODAY_COLUMNS)
      .from(words)
      .innerJoin(wordTags, eq(wordTags.word_id, words.id))
      .where(and(eq(wordTags.tag_id, tagId), isNull(words.deleted_at), gte(words.created_at, todayStart)));
  }
  return db
    .select(RECALL_TODAY_COLUMNS)
    .from(words)
    .where(and(isNull(words.deleted_at), gte(words.created_at, todayStart)));
}

export async function fetchWordsCreatedTodayForFlashcard(tagId?: string): Promise<WordSRSRow[]> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (tagId) {
    return db
      .select(FLASHCARD_TODAY_COLUMNS)
      .from(words)
      .innerJoin(wordTags, eq(wordTags.word_id, words.id))
      .where(and(eq(wordTags.tag_id, tagId), isNull(words.deleted_at), gte(words.created_at, todayStart)));
  }
  return db
    .select(FLASHCARD_TODAY_COLUMNS)
    .from(words)
    .where(and(isNull(words.deleted_at), gte(words.created_at, todayStart)));
}
