# Phase 8 — Review Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Adaptive Buffer Algorithm (SM-2 + priority buffer dual-queue) and Classic mode to the recall flow, persist SRS state to SQLite, and show a missed-words list in the session summary.

**Architecture:** A pure `srsAlgorithm.ts` module handles all SRS math and session queue logic. A new `srs.ts` DB operations file handles `fetchDueWords` and `updateWordSRS`. The recall setup screen gains a segmented mode toggle, the recall screen routes through either Adaptive or Classic logic, and the summary screen gains a missed-words list (word + definition).

**Tech Stack:** Expo React Native, Drizzle ORM, expo-sqlite, TypeScript strict, Jest + react-test-renderer

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `src/db/schema.ts` | Add 3 SRS columns to `words` |
| Modify | `src/db/client.ts` | ALTER TABLE migration for new columns |
| Create | `src/db/operations/srs.ts` | `fetchDueWords`, `updateWordSRS`, `WordSRSRow` type |
| Create | `src/db/operations/__tests__/srs.test.ts` | Unit tests for DB operations |
| Create | `src/screens/srsAlgorithm.ts` | Pure SRS math: createSession, getNextCard, handleResponse, isSessionComplete |
| Create | `src/screens/__tests__/srsAlgorithm.test.ts` | Unit tests for the algorithm |
| Modify | `app/recall-setup.tsx` | Mode toggle + due-count in Adaptive |
| Modify | `app/__tests__/recall-setup.test.tsx` | Add fetchDueWords mock, update for Adaptive default |
| Modify | `app/recall.tsx` | Adaptive session loop; missedIds tracking; updated progress |
| Modify | `app/__tests__/recall.test.tsx` | Add mocks for srs + srsAlgorithm modules |
| Modify | `app/recall-summary.tsx` | Missed-words section + pass mode to Restart |
| Modify | `app/__tests__/recall-summary.test.tsx` | Tests for missed words, updated Restart assertion |

---

## Task 1: DB Schema — Add SRS Columns

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/client.ts`

- [ ] **Step 1: Update `src/db/schema.ts`**

Replace the entire file:

```ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['image', 'pdf', 'video'] }).notNull(),
  uri: text('uri').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const words = sqliteTable('words', {
  id: text('id').primaryKey(),
  word: text('word').notNull(),
  definition: text('definition').notNull(),
  example_sentence: text('example_sentence').notNull(),
  source_id: text('source_id').references(() => sources.id),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
  deleted_at: integer('deleted_at', { mode: 'timestamp' }),
  srs_interval: integer('srs_interval').notNull().default(0),
  srs_ease_factor: real('srs_ease_factor').notNull().default(2.5),
  srs_next_review_at: integer('srs_next_review_at', { mode: 'timestamp' }),
});

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const wordTags = sqliteTable('word_tags', {
  word_id: text('word_id').notNull().references(() => words.id),
  tag_id: text('tag_id').notNull().references(() => tags.id),
});
```

- [ ] **Step 2: Add ALTER TABLE migration to `src/db/client.ts`**

Inside `runMigrations()`, add these three statements immediately after the `word_tags` CREATE TABLE block and before the `console.log('[DB] Ready')`:

```ts
  // SRS columns — ALTER TABLE errors if column already exists; suppress with try/catch
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN srs_interval INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN srs_ease_factor REAL NOT NULL DEFAULT 2.5;'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN srs_next_review_at INTEGER;'); } catch {}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts src/db/client.ts
git commit -m "feat: add SRS columns to words table (interval, ease_factor, next_review_at)"
```

---

## Task 2: SRS DB Operations

**Files:**
- Create: `src/db/operations/srs.ts`
- Create: `src/db/operations/__tests__/srs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/db/operations/__tests__/srs.test.ts`:

```ts
const mockOrderBy = jest.fn().mockResolvedValue([]);
const mockWhereAll = jest.fn().mockReturnValue({ orderBy: mockOrderBy });
const mockWhereTag = jest.fn().mockReturnValue({ orderBy: mockOrderBy });
const mockInnerJoin = jest.fn().mockReturnValue({ where: mockWhereTag });
const mockFrom = jest.fn().mockReturnValue({ where: mockWhereAll, innerJoin: mockInnerJoin });
const mockSelect = jest.fn().mockReturnValue({ from: mockFrom });

const mockUpdateWhere = jest.fn().mockResolvedValue(undefined);
const mockSet = jest.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = jest.fn().mockReturnValue({ set: mockSet });

jest.mock('@/src/db/client', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

import { fetchDueWords, updateWordSRS } from '../srs';

describe('fetchDueWords', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls db.select and resolves to an array', async () => {
    const result = await fetchDueWords();
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(Array.isArray(result)).toBe(true);
  });

  it('uses innerJoin when tagId is provided', async () => {
    await fetchDueWords('tag-123');
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
  });

  it('does not use innerJoin when no tagId', async () => {
    await fetchDueWords();
    expect(mockInnerJoin).not.toHaveBeenCalled();
  });
});

describe('updateWordSRS', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls db.update with correct SRS values', async () => {
    await updateWordSRS('word-1', 3, 2.3, new Date('2026-05-01'));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ srs_interval: 3, srs_ease_factor: 2.3 }),
    );
  });

  it('resolves without throwing', async () => {
    await expect(updateWordSRS('w1', 0, 2.5, new Date())).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/db/operations/__tests__/srs.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '../srs'`

- [ ] **Step 3: Create `src/db/operations/srs.ts`**

```ts
import { db } from '@/src/db/client';
import { words, wordTags } from '@/src/db/schema';
import { isNull, lte, or, eq, and, asc } from 'drizzle-orm';

export interface WordSRSRow {
  id: string;
  word: string;
  definition: string;
  example_sentence: string;
  source_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  srs_interval: number;
  srs_ease_factor: number;
  srs_next_review_at: Date | null;
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
): Promise<void> {
  await db
    .update(words)
    .set({ srs_interval: interval, srs_ease_factor: easeFactor, srs_next_review_at: nextReviewAt })
    .where(eq(words.id, wordId));
}
```

- [ ] **Step 4: Run to verify tests pass**

Run: `npx jest src/db/operations/__tests__/srs.test.ts --no-coverage`
Expected: PASS — 5 tests

- [ ] **Step 5: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/db/operations/srs.ts src/db/operations/__tests__/srs.test.ts
git commit -m "feat: add fetchDueWords and updateWordSRS DB operations"
```

---

## Task 3: SRS Algorithm

**Files:**
- Create: `src/screens/srsAlgorithm.ts`
- Create: `src/screens/__tests__/srsAlgorithm.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/screens/__tests__/srsAlgorithm.test.ts`:

```ts
import {
  createSession,
  getNextCard,
  handleResponse,
  isSessionComplete,
} from '../srsAlgorithm';
import type { WordSRSRow } from '@/src/db/operations/srs';

function makeWord(id: string, interval = 0, easeFactor = 2.5): WordSRSRow {
  return {
    id,
    word: `word-${id}`,
    definition: `def-${id}`,
    example_sentence: `ex-${id}`,
    source_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    srs_interval: interval,
    srs_ease_factor: easeFactor,
    srs_next_review_at: null,
  };
}

describe('createSession', () => {
  it('puts all words in mainDeck with empty buffer', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    expect(session.mainDeck).toHaveLength(2);
    expect(session.buffer).toHaveLength(0);
  });

  it('initialises CardState from word SRS values', () => {
    const session = createSession([makeWord('a', 5, 2.3)]);
    expect(session.mainDeck[0].interval).toBe(5);
    expect(session.mainDeck[0].easeFactor).toBe(2.3);
    expect(session.mainDeck[0].inBuffer).toBe(false);
    expect(session.mainDeck[0].successCount).toBe(0);
  });

  it('starts cardsSinceBuffer at 0', () => {
    const session = createSession([makeWord('a')]);
    expect(session.cardsSinceBuffer).toBe(0);
  });
});

describe('isSessionComplete', () => {
  it('returns true when both queues are empty', () => {
    expect(isSessionComplete(createSession([]))).toBe(true);
  });

  it('returns false when mainDeck has cards', () => {
    expect(isSessionComplete(createSession([makeWord('a')]))).toBe(false);
  });

  it('returns false when buffer has cards and mainDeck is empty', () => {
    const session = createSession([]);
    const bufferSession = { ...session, buffer: [{ word: makeWord('a'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0 }] };
    expect(isSessionComplete(bufferSession)).toBe(false);
  });
});

describe('getNextCard', () => {
  it('returns null when session is complete', () => {
    expect(getNextCard(createSession([]))).toBeNull();
  });

  it('returns mainDeck[0] when buffer is empty', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const card = getNextCard(session);
    expect(card).not.toBeNull();
    expect(card!.inBuffer).toBe(false);
  });

  it('returns buffer[0] when cardsSinceBuffer >= 5 (always over any threshold)', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const bufferCard = { word: makeWord('x'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0 };
    const sessionWithBuffer = { ...session, buffer: [bufferCard], cardsSinceBuffer: 5 };
    const card = getNextCard(sessionWithBuffer);
    expect(card!.inBuffer).toBe(true);
  });

  it('returns mainDeck card when only buffer exists but cardsSinceBuffer is 0', () => {
    const session = createSession([makeWord('a')]);
    const bufferCard = { word: makeWord('x'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0 };
    const sessionWithBuffer = { ...session, buffer: [bufferCard], cardsSinceBuffer: 0 };
    // cardsSinceBuffer=0, threshold min is 3, so mainDeck card should be served first
    const card = getNextCard(sessionWithBuffer);
    expect(card!.inBuffer).toBe(false);
  });

  it('returns buffer card when mainDeck is empty', () => {
    const session = createSession([]);
    const bufferCard = { word: makeWord('x'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0 };
    const bufferSession = { ...session, buffer: [bufferCard] };
    const card = getNextCard(bufferSession);
    expect(card!.inBuffer).toBe(true);
  });
});

describe('handleResponse — correct, main deck card', () => {
  it('removes card from mainDeck', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const card = session.mainDeck[0];
    const { session: next } = handleResponse(session, card, true);
    expect(next.mainDeck.find(c => c.word.id === card.word.id)).toBeUndefined();
  });

  it('applies SM-2: new interval = max(1, round(interval * easeFactor))', () => {
    const session = createSession([makeWord('a', 4, 2.5)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    expect(srsUpdate.interval).toBe(10); // max(1, round(4 * 2.5))
  });

  it('sets interval to 1 for new cards (interval=0)', () => {
    const session = createSession([makeWord('a', 0, 2.5)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    expect(srsUpdate.interval).toBe(1); // max(1, 0)
  });

  it('sets nextReviewAt to ~interval days from now', () => {
    const session = createSession([makeWord('a', 2, 2.5)]);
    const before = Date.now();
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    const expectedMs = 5 * 24 * 60 * 60 * 1000; // interval=max(1, round(2*2.5))=5 days
    expect(srsUpdate.nextReviewAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 1000);
    expect(srsUpdate.nextReviewAt.getTime()).toBeLessThanOrEqual(Date.now() + expectedMs + 1000);
  });

  it('increments cardsSinceBuffer', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const { session: next } = handleResponse(session, session.mainDeck[0], true);
    expect(next.cardsSinceBuffer).toBe(1);
  });
});

describe('handleResponse — incorrect, main deck card', () => {
  it('moves card to buffer with inBuffer=true', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const card = session.mainDeck[0];
    const { session: next } = handleResponse(session, card, false);
    expect(next.mainDeck.find(c => c.word.id === card.word.id)).toBeUndefined();
    expect(next.buffer.some(c => c.word.id === card.word.id)).toBe(true);
    expect(next.buffer.find(c => c.word.id === card.word.id)!.inBuffer).toBe(true);
  });

  it('decreases easeFactor by 0.2', () => {
    const session = createSession([makeWord('a', 0, 2.0)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], false);
    expect(srsUpdate.easeFactor).toBeCloseTo(1.8, 5);
  });

  it('does not reduce easeFactor below 1.3', () => {
    const session = createSession([makeWord('a', 0, 1.3)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], false);
    expect(srsUpdate.easeFactor).toBe(1.3);
  });

  it('sets interval to 0', () => {
    const session = createSession([makeWord('a', 5, 2.5)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], false);
    expect(srsUpdate.interval).toBe(0);
  });

  it('sets nextReviewAt to now (within 200ms)', () => {
    const session = createSession([makeWord('a')]);
    const before = Date.now();
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], false);
    expect(srsUpdate.nextReviewAt.getTime()).toBeGreaterThanOrEqual(before - 100);
    expect(srsUpdate.nextReviewAt.getTime()).toBeLessThanOrEqual(Date.now() + 100);
  });

  it('resets cardsSinceBuffer to 0', () => {
    const session = { ...createSession([makeWord('a'), makeWord('b')]), cardsSinceBuffer: 4 };
    const { session: next } = handleResponse(session, session.mainDeck[0], false);
    expect(next.cardsSinceBuffer).toBe(0);
  });
});

describe('handleResponse — buffer card lifecycle', () => {
  function bufferSession() {
    const base = createSession([makeWord('a')]);
    const bufferCard = { ...base.mainDeck[0], inBuffer: true, successCount: 0 };
    return { session: { ...base, mainDeck: [], buffer: [bufferCard] }, card: bufferCard };
  }

  it('increments successCount on first correct but keeps card in buffer', () => {
    const { session, card } = bufferSession();
    const { session: next } = handleResponse(session, card, true);
    expect(next.buffer).toHaveLength(1);
    expect(next.buffer[0].successCount).toBe(1);
  });

  it('graduates card after 2 consecutive correct answers', () => {
    const base = createSession([makeWord('a')]);
    const bufferCard = { ...base.mainDeck[0], inBuffer: true, successCount: 1 };
    const sess = { ...base, mainDeck: [], buffer: [bufferCard] };
    const { session: next, srsUpdate } = handleResponse(sess, bufferCard, true);
    expect(next.buffer).toHaveLength(0);
    expect(srsUpdate.interval).toBe(1);
  });

  it('resets successCount and stays in buffer on incorrect', () => {
    const base = createSession([makeWord('a')]);
    const bufferCard = { ...base.mainDeck[0], inBuffer: true, successCount: 1 };
    const sess = { ...base, mainDeck: [], buffer: [bufferCard] };
    const { session: next } = handleResponse(sess, bufferCard, false);
    expect(next.buffer[0].successCount).toBe(0);
    expect(next.buffer[0].inBuffer).toBe(true);
  });

  it('resets cardsSinceBuffer to 0 after any buffer card interaction', () => {
    const { session, card } = bufferSession();
    const sessionWith = { ...session, cardsSinceBuffer: 4 };
    const { session: next } = handleResponse(sessionWith, card, true);
    expect(next.cardsSinceBuffer).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/screens/__tests__/srsAlgorithm.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '../srsAlgorithm'`

- [ ] **Step 3: Create `src/screens/srsAlgorithm.ts`**

```ts
import type { WordSRSRow } from '@/src/db/operations/srs';

export interface CardState {
  word: WordSRSRow;
  interval: number;
  easeFactor: number;
  inBuffer: boolean;
  successCount: number;
}

export interface Session {
  mainDeck: CardState[];
  buffer: CardState[];
  mainIndex: number;
  cardsSinceBuffer: number;
}

export interface SRSUpdate {
  interval: number;
  easeFactor: number;
  nextReviewAt: Date;
}

export interface ResponseResult {
  session: Session;
  srsUpdate: SRSUpdate;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function createSession(words: WordSRSRow[]): Session {
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  return {
    mainDeck: shuffled.map(w => ({
      word: w,
      interval: w.srs_interval,
      easeFactor: w.srs_ease_factor,
      inBuffer: false,
      successCount: 0,
    })),
    buffer: [],
    mainIndex: 0,
    cardsSinceBuffer: 0,
  };
}

export function getNextCard(session: Session): CardState | null {
  if (session.mainDeck.length === 0 && session.buffer.length === 0) return null;

  // Serve a buffer card every 3–5 main-deck cards
  const threshold = 3 + Math.floor(Math.random() * 3);
  if (session.buffer.length > 0 && session.cardsSinceBuffer >= threshold) {
    return session.buffer[0];
  }

  if (session.mainDeck.length > 0) return session.mainDeck[0];

  // Only buffer remains
  return session.buffer[0];
}

export function handleResponse(
  session: Session,
  card: CardState,
  correct: boolean,
): ResponseResult {
  const now = new Date();

  if (card.inBuffer) {
    if (correct) {
      const newSuccessCount = card.successCount + 1;
      if (newSuccessCount >= 2) {
        // Graduate from buffer
        return {
          session: {
            ...session,
            buffer: session.buffer.filter(c => c.word.id !== card.word.id),
            cardsSinceBuffer: 0,
          },
          srsUpdate: { interval: 1, easeFactor: card.easeFactor, nextReviewAt: new Date(now.getTime() + MS_PER_DAY) },
        };
      }
      // Still needs one more correct — keep in buffer
      return {
        session: {
          ...session,
          buffer: session.buffer.map(c =>
            c.word.id === card.word.id ? { ...c, successCount: newSuccessCount } : c,
          ),
          cardsSinceBuffer: 0,
        },
        srsUpdate: { interval: card.interval, easeFactor: card.easeFactor, nextReviewAt: now },
      };
    } else {
      // Incorrect buffer card — reset successCount
      const newEaseFactor = Math.max(1.3, card.easeFactor - 0.2);
      return {
        session: {
          ...session,
          buffer: session.buffer.map(c =>
            c.word.id === card.word.id ? { ...c, easeFactor: newEaseFactor, successCount: 0 } : c,
          ),
          cardsSinceBuffer: 0,
        },
        srsUpdate: { interval: 0, easeFactor: newEaseFactor, nextReviewAt: now },
      };
    }
  }

  // Main deck card
  if (correct) {
    const newInterval = Math.max(1, Math.round(card.interval * card.easeFactor));
    return {
      session: {
        ...session,
        mainDeck: session.mainDeck.filter(c => c.word.id !== card.word.id),
        cardsSinceBuffer: session.cardsSinceBuffer + 1,
      },
      srsUpdate: {
        interval: newInterval,
        easeFactor: card.easeFactor,
        nextReviewAt: new Date(now.getTime() + newInterval * MS_PER_DAY),
      },
    };
  } else {
    const newEaseFactor = Math.max(1.3, card.easeFactor - 0.2);
    const bufferCard: CardState = { ...card, easeFactor: newEaseFactor, interval: 0, inBuffer: true, successCount: 0 };
    const insertAt = Math.min(3, session.buffer.length);
    return {
      session: {
        ...session,
        mainDeck: session.mainDeck.filter(c => c.word.id !== card.word.id),
        buffer: [...session.buffer.slice(0, insertAt), bufferCard, ...session.buffer.slice(insertAt)],
        cardsSinceBuffer: 0,
      },
      srsUpdate: { interval: 0, easeFactor: newEaseFactor, nextReviewAt: now },
    };
  }
}

export function isSessionComplete(session: Session): boolean {
  return session.mainDeck.length === 0 && session.buffer.length === 0;
}
```

- [ ] **Step 4: Run to verify tests pass**

Run: `npx jest src/screens/__tests__/srsAlgorithm.test.ts --no-coverage`
Expected: PASS — all ~22 tests green

- [ ] **Step 5: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/screens/srsAlgorithm.ts src/screens/__tests__/srsAlgorithm.test.ts
git commit -m "feat: add SRS algorithm (SM-2 + adaptive buffer dual-queue)"
```

---

## Task 4: Update Recall Setup Screen

**Files:**
- Modify: `app/recall-setup.tsx`
- Modify: `app/__tests__/recall-setup.test.tsx`

- [ ] **Step 1: Replace `app/recall-setup.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ListRenderItemInfo,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllTags, fetchAllWords, fetchWordsByTag, type Tag } from '@/src/db/operations/tags';
import { fetchDueWords } from '@/src/db/operations/srs';

type DeckOption = { id: string | null; name: string };
export type Mode = 'adaptive' | 'classic';

export default function RecallSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [mode, setMode] = useState<Mode>('adaptive');

  useFocusEffect(
    useCallback(() => {
      getAllTags().then(setTags);
    }, [])
  );

  useEffect(() => {
    let cancelled = false;
    async function computeCount() {
      if (mode === 'adaptive') {
        const rows = selectedTagId !== null
          ? await fetchDueWords(selectedTagId)
          : await fetchDueWords();
        if (!cancelled) setWordCount(rows.length);
      } else {
        const rows = selectedTagId === null
          ? await fetchAllWords()
          : await fetchWordsByTag(selectedTagId);
        if (!cancelled) setWordCount(rows.length);
      }
    }
    computeCount().catch(() => {});
    return () => { cancelled = true; };
  }, [selectedTagId, mode]);

  const handleStart = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push({ pathname: '/recall' as any, params: { tagId: selectedTagId ?? '', mode } });
  }, [router, selectedTagId, mode]);

  const deckOptions: DeckOption[] = [{ id: null, name: 'All Words' }, ...tags];

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<DeckOption>) => {
      const isSelected = item.id === selectedTagId;
      return (
        <TouchableOpacity
          style={[styles.row, isSelected && styles.rowSelected]}
          onPress={() => setSelectedTagId(item.id)}
          accessibilityRole="radio"
          accessibilityState={{ selected: isSelected }}
        >
          <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>{item.name}</Text>
        </TouchableOpacity>
      );
    },
    [selectedTagId],
  );

  const allCaughtUp = mode === 'adaptive' && wordCount === 0;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <Text style={styles.heading}>Choose a deck</Text>

      <View style={styles.modeToggle}>
        {(['adaptive', 'classic'] as Mode[]).map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.modeButton, mode === m && styles.modeButtonActive]}
            onPress={() => setMode(m)}
            testID={`mode-${m}`}
          >
            <Text style={[styles.modeButtonText, mode === m && styles.modeButtonTextActive]}>
              {m === 'adaptive' ? 'Adaptive' : 'Classic'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={deckOptions}
        keyExtractor={(item) => item.id ?? '__all__'}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        style={styles.list}
        contentContainerStyle={styles.listContent}
      />

      <Text style={styles.wordCount} testID="word-count-label">
        {wordCount} {wordCount === 1 ? 'word' : 'words'}
        {mode === 'adaptive' ? ' due today' : ''}
      </Text>

      {allCaughtUp && (
        <Text style={styles.caughtUpLabel} testID="caught-up-label">
          All caught up! No words due today.
        </Text>
      )}

      {wordCount === 0 && mode === 'classic' && (
        <Text style={styles.noWordsLabel} testID="no-words-label">
          No words to review
        </Text>
      )}

      <TouchableOpacity
        style={[styles.startButton, wordCount === 0 && styles.startButtonDisabled]}
        onPress={handleStart}
        disabled={wordCount === 0}
        accessibilityRole="button"
        accessibilityState={{ disabled: wordCount === 0 }}
        testID="start-button"
      >
        <Text style={[styles.startButtonText, wordCount === 0 && styles.startButtonTextDisabled]}>
          Start
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 20, paddingTop: 16 },
  heading: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  modeButton: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  modeButtonActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  modeButtonText: { fontSize: 14, fontWeight: '500', color: '#6B7280' },
  modeButtonTextActive: { color: '#111827', fontWeight: '700' },
  list: { flex: 1 },
  listContent: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  row: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#F9FAFB' },
  rowSelected: { backgroundColor: '#3B82F6' },
  rowText: { fontSize: 16, color: '#111827' },
  rowTextSelected: { color: '#fff', fontWeight: '600' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB' },
  wordCount: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 12, marginBottom: 4 },
  caughtUpLabel: { fontSize: 14, color: '#22c55e', textAlign: 'center', marginBottom: 8 },
  noWordsLabel: { fontSize: 14, color: '#EF4444', textAlign: 'center', marginBottom: 8 },
  startButton: { marginTop: 12, backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  startButtonDisabled: { backgroundColor: '#E5E7EB' },
  startButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  startButtonTextDisabled: { color: '#9CA3AF' },
});
```

- [ ] **Step 2: Replace `app/__tests__/recall-setup.test.tsx`**

The existing tests check `'No words to review'` which only appears in Classic mode. We need to add a `fetchDueWords` mock and update the tests for the new Adaptive default.

```tsx
import React from 'react';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
    SafeAreaView: ({ children, ...props }: any) => <View {...props}>{children}</View>,
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => { cb(); },
}));

const mockGetAllTags = jest.fn();
const mockFetchWordsByTag = jest.fn();
const mockFetchAllWords = jest.fn();
jest.mock('@/src/db/operations/tags', () => ({
  getAllTags: (...args: unknown[]) => mockGetAllTags(...args),
  fetchWordsByTag: (...args: unknown[]) => mockFetchWordsByTag(...args),
  fetchAllWords: (...args: unknown[]) => mockFetchAllWords(...args),
}));

const mockFetchDueWords = jest.fn();
jest.mock('@/src/db/operations/srs', () => ({
  fetchDueWords: (...args: unknown[]) => mockFetchDueWords(...args),
}));

import RecallSetupScreen from '../recall-setup';

function collectText(
  node: renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] | null,
): string[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(collectText);
  const children = node.children ?? [];
  return [
    ...children.filter((child): child is string => typeof child === 'string'),
    ...children.flatMap((child) =>
      typeof child === 'string' ? [] : collectText(child),
    ),
  ];
}

describe('RecallSetupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetAllTags.mockResolvedValue([]);
    mockFetchAllWords.mockResolvedValue([]);
    mockFetchDueWords.mockResolvedValue([]);
  });

  afterEach(() => {
    act(() => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
  });

  it('shows "All caught up!" when Adaptive mode has 0 due words', async () => {
    mockFetchDueWords.mockResolvedValue([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('All caught up! No words due today.');
  });

  it('Start button is disabled when word count is 0', async () => {
    mockFetchDueWords.mockResolvedValue([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    const startBtn = tree.root.findByProps({ testID: 'start-button' });
    expect(startBtn.props.disabled).toBe(true);
  });

  it('Start button is enabled when Adaptive has due words', async () => {
    mockFetchDueWords.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    const startBtn = tree.root.findByProps({ testID: 'start-button' });
    expect(startBtn.props.disabled).toBe(false);
  });

  it('switches to Classic mode and shows "No words to review" when Classic deck is empty', async () => {
    mockFetchDueWords.mockResolvedValue([]);
    mockFetchAllWords.mockResolvedValue([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    // Tap Classic toggle
    await act(async () => {
      tree.root.findByProps({ testID: 'mode-classic' }).props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('No words to review');
  });

  it('Start button passes mode param to router', async () => {
    mockFetchDueWords.mockResolvedValue([{ id: 'w1' }]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'start-button' }).props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ mode: 'adaptive' }) })
    );
  });
});
```

- [ ] **Step 3: Run recall-setup tests**

Run: `npx jest app/__tests__/recall-setup.test.tsx --no-coverage`
Expected: PASS — all 5 tests

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add app/recall-setup.tsx app/__tests__/recall-setup.test.tsx
git commit -m "feat: add Classic/Adaptive mode toggle and due-today count to recall setup"
```

---

## Task 5: Update Recall Screen

**Files:**
- Modify: `app/recall.tsx`
- Modify: `app/__tests__/recall.test.tsx`

- [ ] **Step 1: Replace `app/recall.tsx`**

```tsx
import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { fetchAllWords, fetchWordsByTag, type WordRow } from '@/src/db/operations/tags';
import { fetchDueWords, updateWordSRS, type WordSRSRow } from '@/src/db/operations/srs';
import { gradeAnswer, type GradeResult } from '@/src/api/gradeClient';
import { useVoiceInput } from '@/src/audio/useVoiceInput';
import { VoiceInputButton } from '@/src/components/VoiceInputButton';
import {
  createSession,
  getNextCard,
  handleResponse,
  type Session,
  type CardState,
  type SRSUpdate,
} from '@/src/screens/srsAlgorithm';

type Phase = 'input' | 'result';
type Mode = 'adaptive' | 'classic';

export default function RecallScreen() {
  const router = useRouter();
  const { tagId, mode: modeParam } = useLocalSearchParams<{ tagId: string; mode: string }>();
  const mode: Mode = modeParam === 'classic' ? 'classic' : 'adaptive';

  // Classic mode
  const [deck, setDeck] = useState<WordRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Adaptive mode
  const [adaptiveSession, setAdaptiveSession] = useState<Session | null>(null);
  const [adaptiveCard, setAdaptiveCard] = useState<CardState | null>(null);
  const [adaptiveNextCard, setAdaptiveNextCard] = useState<CardState | null | undefined>(undefined);
  const pendingSRSUpdate = useRef<{ wordId: string; update: SRSUpdate } | null>(null);
  const missedIdsRef = useRef<string[]>([]);

  // Shared
  const [deckLoaded, setDeckLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>('input');
  const [userAnswer, setUserAnswer] = useState('');
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  const voiceInput = useVoiceInput();

  useEffect(() => {
    async function loadDeck() {
      if (mode === 'adaptive') {
        const words = tagId && tagId.length > 0
          ? await fetchDueWords(tagId)
          : await fetchDueWords();
        const session = createSession(words);
        setAdaptiveSession(session);
        setAdaptiveCard(getNextCard(session));
      } else {
        const words = tagId && tagId.length > 0
          ? await fetchWordsByTag(tagId)
          : await fetchAllWords();
        setDeck([...words].sort(() => Math.random() - 0.5));
      }
      setDeckLoaded(true);
    }
    loadDeck().catch(() => setDeckLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (voiceInput.state === 'done' && voiceInput.transcript) {
      setUserAnswer(voiceInput.transcript);
      handleSubmit(voiceInput.transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceInput.state]);

  useEffect(() => {
    if (phase !== 'result' || !gradeResult?.correct) {
      setCountdown(null);
      return;
    }
    let count = 10;
    let cancelled = false;
    setCountdown(count);
    const id = setInterval(() => {
      if (cancelled) return;
      count -= 1;
      if (count <= 0) { clearInterval(id); setCountdown(null); handleNext(); }
      else setCountdown(count);
    }, 1000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, gradeResult?.correct]);

  const currentWord: WordRow | WordSRSRow | null =
    mode === 'adaptive' ? (adaptiveCard?.word ?? null) : (deck[currentIndex] ?? null);

  async function handleSubmit(answerOverride?: string) {
    const answer = answerOverride ?? userAnswer;
    if (!currentWord || loading) return;
    setLoading(true);
    try {
      const result = await gradeAnswer(currentWord.word, answer, currentWord.definition);
      setGradeResult(result);
      setTotal(t => t + 1);
      if (result.correct) setScore(s => s + 1);

      if (mode === 'adaptive' && adaptiveCard && adaptiveSession) {
        const { session: newSession, srsUpdate } = handleResponse(adaptiveSession, adaptiveCard, result.correct);
        setAdaptiveSession(newSession);
        pendingSRSUpdate.current = { wordId: adaptiveCard.word.id, update: srsUpdate };
        if (!result.correct && !missedIdsRef.current.includes(adaptiveCard.word.id)) {
          missedIdsRef.current.push(adaptiveCard.word.id);
        }
        setAdaptiveNextCard(getNextCard(newSession));
      }

      setPhase('result');
    } catch {
      Alert.alert('Error', 'Could not reach server. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleNext() {
    voiceInput.reset();

    if (mode === 'adaptive') {
      if (pendingSRSUpdate.current) {
        const { wordId, update } = pendingSRSUpdate.current;
        updateWordSRS(wordId, update.interval, update.easeFactor, update.nextReviewAt).catch(() => {});
        pendingSRSUpdate.current = null;
      }
      if (adaptiveNextCard == null) {
        navigateToSummary();
      } else {
        setAdaptiveCard(adaptiveNextCard);
        setAdaptiveNextCard(undefined);
        setPhase('input');
        setUserAnswer('');
        setGradeResult(null);
      }
    } else {
      if (currentIndex + 1 < deck.length) {
        setCurrentIndex(i => i + 1);
        setPhase('input');
        setUserAnswer('');
        setGradeResult(null);
      } else {
        navigateToSummary();
      }
    }
  }

  function navigateToSummary() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace({
      pathname: '/recall-summary' as any,
      params: {
        score: String(score),
        total: String(total),
        tagId: tagId ?? '',
        mode,
        missedIds: missedIdsRef.current.join(','),
      },
    });
  }

  if (!deckLoaded) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  const isEmpty = mode === 'adaptive' ? adaptiveCard === null : deck.length === 0;
  if (isEmpty) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No words to review</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isLastCard =
    mode === 'adaptive' ? adaptiveNextCard === null : currentIndex + 1 >= deck.length;

  const progressText =
    mode === 'adaptive' && adaptiveSession
      ? `${adaptiveSession.mainDeck.length} left · ${adaptiveSession.buffer.length} to retry`
      : `${currentIndex + 1} / ${deck.length}`;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.progress}>{progressText}</Text>
      <Text style={styles.scoreText}>Score: {score} / {total}</Text>

      <Text style={styles.wordText} testID="word-display">{currentWord!.word}</Text>

      {phase === 'input' && (
        <View style={styles.inputSection}>
          <TextInput
            style={styles.textInput}
            placeholder="Type the meaning…"
            value={userAnswer}
            onChangeText={text => {
              setUserAnswer(text);
              if (voiceInput.state === 'done') voiceInput.reset();
            }}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => handleSubmit()}
            editable={
              !loading &&
              (voiceInput.state === 'idle' || voiceInput.state === 'done' || voiceInput.state === 'error')
            }
            testID="answer-input"
          />
          {loading && <ActivityIndicator style={styles.spinner} size="small" color="#3B82F6" testID="loading-indicator" />}
          <VoiceInputButton state={voiceInput.state} onPress={voiceInput.start} />
          {voiceInput.state === 'listening' && <Text style={styles.voiceLabel}>Listening…</Text>}
          {voiceInput.state === 'speech_detected' && <Text style={styles.voiceLabel}>Got it, keep going…</Text>}
          {voiceInput.state === 'error' && (
            <View style={styles.voiceErrorRow}>
              <Text style={styles.voiceError}>Couldn't understand, try again</Text>
              <TouchableOpacity onPress={voiceInput.start} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity
            style={[
              styles.submitButton,
              (loading || voiceInput.state === 'connecting' || voiceInput.state === 'transcribing' ||
                voiceInput.state === 'listening' || voiceInput.state === 'speech_detected') &&
                styles.submitButtonDisabled,
            ]}
            onPress={() => handleSubmit()}
            disabled={
              loading || voiceInput.state === 'connecting' || voiceInput.state === 'transcribing' ||
              voiceInput.state === 'listening' || voiceInput.state === 'speech_detected'
            }
            testID="submit-button"
          >
            <Text style={styles.submitButtonText}>Submit</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'result' && gradeResult && (
        <View style={styles.resultSection}>
          <View
            style={[styles.banner, gradeResult.correct ? styles.bannerCorrect : styles.bannerIncorrect]}
            testID="result-banner"
          >
            <Text style={[styles.bannerText, gradeResult.correct ? styles.bannerTextCorrect : styles.bannerTextIncorrect]}>
              {gradeResult.correct ? 'Correct ✓' : 'Incorrect ✗'}
            </Text>
          </View>
          <Text style={styles.feedbackText} testID="feedback-text">{gradeResult.feedback}</Text>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Definition:</Text>
            <Text style={styles.infoText}>{currentWord!.definition}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Example:</Text>
            <Text style={styles.infoText}>{currentWord!.example_sentence}</Text>
          </View>
          <TouchableOpacity
            style={styles.nextButton}
            onPress={() => { setCountdown(null); handleNext(); }}
            testID="next-button"
          >
            <Text style={styles.nextButtonText}>
              {isLastCard ? 'See Results' : countdown !== null ? `Next in ${countdown}s` : 'Next Word →'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#fff', flexGrow: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 24 },
  progress: { fontSize: 13, color: '#9CA3AF', textAlign: 'right', marginBottom: 4 },
  scoreText: { fontSize: 13, color: '#6B7280', textAlign: 'right', marginBottom: 24 },
  wordText: { fontSize: 32, fontWeight: 'bold', color: '#111827', marginBottom: 32, textAlign: 'center' },
  inputSection: { gap: 16 },
  textInput: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: '#111827', backgroundColor: '#F9FAFB',
  },
  spinner: { alignSelf: 'center' },
  submitButton: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#E5E7EB' },
  submitButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  resultSection: { gap: 16 },
  banner: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  bannerCorrect: { backgroundColor: '#DCFCE7' },
  bannerIncorrect: { backgroundColor: '#FEE2E2' },
  bannerText: { fontSize: 20, fontWeight: '700' },
  bannerTextCorrect: { color: '#22c55e' },
  bannerTextIncorrect: { color: '#ef4444' },
  feedbackText: { fontSize: 14, color: '#6B7280', textAlign: 'center' },
  infoBlock: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 16, gap: 4 },
  infoLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoText: { fontSize: 15, color: '#111827', lineHeight: 22 },
  nextButton: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  nextButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  emptyText: { fontSize: 18, color: '#6B7280', marginBottom: 24, textAlign: 'center' },
  backButton: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32 },
  backButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  voiceLabel: { fontSize: 13, color: '#3B82F6', textAlign: 'center' },
  voiceErrorRow: { alignItems: 'center', gap: 8 },
  voiceError: { fontSize: 13, color: '#ef4444', textAlign: 'center' },
  retryButton: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#FEE2E2', borderRadius: 8 },
  retryButtonText: { fontSize: 13, fontWeight: '600', color: '#ef4444' },
});
```

- [ ] **Step 2: Update `app/__tests__/recall.test.tsx` — add mocks for new imports**

Add the following three `jest.mock` blocks after the existing `jest.mock('@/src/api/gradeClient', ...)` block and before the `import RecallScreen` line:

```ts
// Mock SRS DB operations
const mockFetchDueWords = jest.fn();
jest.mock('@/src/db/operations/srs', () => ({
  fetchDueWords: (...args: unknown[]) => mockFetchDueWords(...args),
  updateWordSRS: jest.fn().mockResolvedValue(undefined),
}));

// Mock SRS algorithm — minimal stubs; classic-mode tests never call these
jest.mock('@/src/screens/srsAlgorithm', () => ({
  createSession: jest.fn((words: unknown[]) => ({
    mainDeck: words.map((w: unknown) => ({
      word: w, interval: 0, easeFactor: 2.5, inBuffer: false, successCount: 0,
    })),
    buffer: [],
    mainIndex: 0,
    cardsSinceBuffer: 0,
  })),
  getNextCard: jest.fn((session: { mainDeck: unknown[] }) =>
    session.mainDeck.length > 0 ? session.mainDeck[0] : null),
  handleResponse: jest.fn((session: { mainDeck: unknown[]; buffer: unknown[] }, card: unknown, correct: boolean) => ({
    session: {
      ...session,
      mainDeck: correct ? session.mainDeck.filter((c: unknown) => c !== card) : session.mainDeck,
      buffer: correct ? session.buffer : [card, ...session.buffer],
    },
    srsUpdate: { interval: 1, easeFactor: 2.5, nextReviewAt: new Date() },
  })),
  isSessionComplete: jest.fn((s: { mainDeck: unknown[]; buffer: unknown[] }) =>
    s.mainDeck.length === 0 && s.buffer.length === 0),
}));
```

Also update `mockParams` default and `beforeEach` so existing tests run in Classic mode:

```ts
// Change the initial value of mockParams to include mode: 'classic'
let mockParams: Record<string, string> = { tagId: 'tag1', mode: 'classic' };
```

And in `beforeEach`:
```ts
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockFetchWordsByTag.mockResolvedValue([WORD_A, WORD_B]);
  mockFetchAllWords.mockResolvedValue([WORD_A, WORD_B]);
  mockFetchDueWords.mockResolvedValue([]);
  mockParams = { tagId: 'tag1', mode: 'classic' };
});
```

- [ ] **Step 3: Run recall tests**

Run: `npx jest app/__tests__/recall.test.tsx --no-coverage`
Expected: PASS — all existing tests pass

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add app/recall.tsx app/__tests__/recall.test.tsx
git commit -m "feat: add Adaptive mode session loop to recall screen"
```

---

## Task 6: Update Summary Screen

**Files:**
- Modify: `app/recall-summary.tsx`
- Modify: `app/__tests__/recall-summary.test.tsx`

- [ ] **Step 1: Replace `app/recall-summary.tsx`**

```tsx
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  ListRenderItemInfo,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { fetchAllWords, type WordRow } from '@/src/db/operations/tags';

export default function RecallSummaryScreen() {
  const router = useRouter();
  const { score: scoreStr, total: totalStr, tagId, mode, missedIds } = useLocalSearchParams<{
    score: string;
    total: string;
    tagId: string;
    mode: string;
    missedIds: string;
  }>();

  const score = parseInt(scoreStr ?? '0', 10);
  const total = parseInt(totalStr ?? '0', 10);
  const pct = total > 0 ? score / total : 0;

  const [missedWords, setMissedWords] = useState<WordRow[]>([]);

  useEffect(() => {
    if (!missedIds || missedIds.length === 0) return;
    const ids = new Set(missedIds.split(',').filter(Boolean));
    fetchAllWords()
      .then(all => setMissedWords(all.filter(w => ids.has(w.id))))
      .catch(() => {});
  }, [missedIds]);

  function handleRestart() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace({ pathname: '/recall' as any, params: { tagId: tagId ?? '', mode: mode ?? 'adaptive' } });
  }

  function handleDone() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace('/(tabs)/practice' as any);
  }

  const renderMissedItem = ({ item }: ListRenderItemInfo<WordRow>) => (
    <View style={styles.missedRow} testID={`missed-row-${item.id}`}>
      <Text style={styles.missedWord}>{item.word}</Text>
      <Text style={styles.missedDefinition}>{item.definition}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>Session Complete</Text>

        <Text style={styles.fraction} testID="score-fraction">{score} / {total}</Text>

        <View style={styles.barTrack} testID="progress-bar">
          <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` as any }]} />
        </View>

        <Text style={styles.pctText}>{total > 0 ? `${Math.round(pct * 100)}%` : '—'}</Text>

        {missedWords.length > 0 && (
          <View style={styles.missedSection}>
            <Text style={styles.missedHeading} testID="missed-heading">
              Missed Words ({missedWords.length})
            </Text>
            <FlatList
              data={missedWords}
              keyExtractor={item => item.id}
              renderItem={renderMissedItem}
              ItemSeparatorComponent={() => <View style={styles.missedSeparator} />}
              scrollEnabled={false}
            />
          </View>
        )}
      </ScrollView>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={styles.restartButton}
          onPress={handleRestart}
          testID="restart-button"
          accessibilityRole="button"
        >
          <Text style={styles.restartText}>Restart</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={handleDone}
          testID="done-button"
          accessibilityRole="button"
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 24 },
  scrollArea: { flex: 1 },
  scrollContent: { alignItems: 'center', paddingTop: 48, gap: 24, paddingBottom: 16 },
  heading: { fontSize: 28, fontWeight: 'bold', color: '#111827', textAlign: 'center' },
  fraction: { fontSize: 56, fontWeight: 'bold', color: '#111827', textAlign: 'center' },
  barTrack: { width: '100%', height: 16, backgroundColor: '#E5E7EB', borderRadius: 8, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#22c55e', borderRadius: 8 },
  pctText: { fontSize: 16, color: '#6B7280' },
  missedSection: { width: '100%', marginTop: 8 },
  missedHeading: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  missedRow: { paddingVertical: 10, gap: 4 },
  missedWord: { fontSize: 15, fontWeight: '700', color: '#111827' },
  missedDefinition: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  missedSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB' },
  buttons: { gap: 12, marginBottom: 16, marginTop: 8 },
  restartButton: { backgroundColor: '#22c55e', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  restartText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  doneButton: {
    borderWidth: 1.5, borderColor: '#6B7280', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', backgroundColor: 'transparent',
  },
  doneText: { fontSize: 17, fontWeight: '600', color: '#6B7280' },
});
```

- [ ] **Step 2: Replace `app/__tests__/recall-summary.test.tsx`**

```tsx
import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));

const mockFetchAllWords = jest.fn();
jest.mock('@/src/db/operations/tags', () => ({
  fetchAllWords: (...args: unknown[]) => mockFetchAllWords(...args),
}));

let mockParams: Record<string, string> = {
  score: '7', total: '10', tagId: 'tag1', mode: 'adaptive', missedIds: '',
};

import RecallSummaryScreen from '../recall-summary';

function collectText(node: any): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node?.props?.children) return collectText(node.props.children);
  return '';
}

describe('RecallSummaryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAllWords.mockResolvedValue([]);
    mockParams = { score: '7', total: '10', tagId: 'tag1', mode: 'adaptive', missedIds: '' };
  });

  it('renders score fraction correctly', async () => {
    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    const fractionNode = tree.root.findAll((n: any) => n.props?.testID === 'score-fraction')[0];
    expect(collectText(fractionNode)).toContain('7');
    expect(collectText(fractionNode)).toContain('10');
  });

  it('Done button navigates to practice tab', async () => {
    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    const doneBtn = tree.root.findAll((n: any) => n.props?.testID === 'done-button')[0];
    await act(async () => { doneBtn.props.onPress(); });
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('practice'));
  });

  it('Restart button navigates back to recall with tagId and mode', async () => {
    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    const restartBtn = tree.root.findAll((n: any) => n.props?.testID === 'restart-button')[0];
    await act(async () => { restartBtn.props.onPress(); });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recall',
      params: { tagId: 'tag1', mode: 'adaptive' },
    });
  });

  it('renders without crashing when total is 0', async () => {
    mockParams = { score: '0', total: '0', tagId: '', mode: 'adaptive', missedIds: '' };
    await act(async () => { renderer.create(<RecallSummaryScreen />); });
  });

  it('does not render missed section when missedIds is empty', async () => {
    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    await act(async () => { await Promise.resolve(); });
    const missed = tree.root.findAll((n: any) => n.props?.testID === 'missed-heading');
    expect(missed).toHaveLength(0);
  });

  it('renders missed words section with word and definition', async () => {
    mockParams = { score: '3', total: '5', tagId: 'tag1', mode: 'adaptive', missedIds: 'w1,w2' };
    mockFetchAllWords.mockResolvedValue([
      {
        id: 'w1', word: 'ephemeral', definition: 'Lasting for a very short time',
        example_sentence: 'ex', source_id: null, created_at: new Date(),
        updated_at: new Date(), deleted_at: null,
      },
      {
        id: 'w2', word: 'tenacious', definition: 'Holding fast; persistent',
        example_sentence: 'ex', source_id: null, created_at: new Date(),
        updated_at: new Date(), deleted_at: null,
      },
    ]);

    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    await act(async () => { await Promise.resolve(); });

    const headings = tree.root.findAll((n: any) => n.props?.testID === 'missed-heading');
    expect(headings).toHaveLength(1);
    expect(collectText(headings[0])).toContain('Missed Words (2)');

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('ephemeral');
    expect(texts).toContain('Lasting for a very short time');
    expect(texts).toContain('tenacious');
  });

  it('only shows words whose IDs are in missedIds (filters correctly)', async () => {
    mockParams = { score: '4', total: '5', tagId: '', mode: 'adaptive', missedIds: 'w2' };
    mockFetchAllWords.mockResolvedValue([
      {
        id: 'w1', word: 'ephemeral', definition: 'Short-lived',
        example_sentence: 'ex', source_id: null, created_at: new Date(),
        updated_at: new Date(), deleted_at: null,
      },
      {
        id: 'w2', word: 'tenacious', definition: 'Holding fast',
        example_sentence: 'ex', source_id: null, created_at: new Date(),
        updated_at: new Date(), deleted_at: null,
      },
    ]);

    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).not.toContain('ephemeral');
    expect(texts).toContain('tenacious');
  });
});
```

- [ ] **Step 3: Run summary tests**

Run: `npx jest app/__tests__/recall-summary.test.tsx --no-coverage`
Expected: PASS — all 7 tests

- [ ] **Step 4: Run the full test suite**

Run: `npx jest --no-coverage`
Expected: same pass count as before Phase 8 plus new tests (the 1 pre-existing `http.test` failure is expected; all other suites green)

- [ ] **Step 5: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add app/recall-summary.tsx app/__tests__/recall-summary.test.tsx
git commit -m "feat: add missed words list to recall summary screen"
```

---

## Final Verification

- [ ] Run full suite one more time: `npx jest --no-coverage`
- [ ] Run TypeScript check: `npx tsc --noEmit`
- [ ] Confirm git log shows 7 new commits (Tasks 1–6 + design doc)
- [ ] Update `specs/roadmap.md` to mark Phase 8 as ✅ with today's date (2026-04-26)
