# Phase 8 — Review Polish Design

**Date:** 2026-04-26  
**Status:** Approved

---

## Overview

Phase 8 adds an Adaptive Buffer Algorithm (SM-2 spaced repetition + in-session priority buffer) to the recall flow, alongside Classic mode (existing linear shuffle). Words that are answered incorrectly haunt the session until answered correctly twice; correct words are spaced out across days. A missed-words list is added to the session summary.

---

## Architecture

### New files

| File | Purpose |
|------|---------|
| `src/screens/srsAlgorithm.ts` | Pure SRS math + dual-queue session management |
| `src/db/operations/srs.ts` | `fetchDueWords()` and `updateWordSRS()` |
| `src/screens/__tests__/srsAlgorithm.test.ts` | Unit tests for algorithm (no React) |

### Modified files

| File | Change |
|------|--------|
| `src/db/schema.ts` | 3 new SRS columns on `words` |
| `src/db/client.ts` | `ALTER TABLE` migration for new columns |
| `app/recall-setup.tsx` | Mode toggle (Classic / Adaptive) + due-count in Adaptive |
| `app/recall.tsx` | SRS session loop in Adaptive mode; passes `missedIds` to summary |
| `app/recall-summary.tsx` | Missed words section (word + definition) |
| `app/__tests__/recall-summary.test.tsx` | Tests for missed words rendering |

---

## DB Schema

Three new columns added to `words` via `ALTER TABLE` migration:

```sql
srs_interval       INTEGER NOT NULL DEFAULT 0
srs_ease_factor    REAL    NOT NULL DEFAULT 2.5
srs_next_review_at INTEGER NULL     DEFAULT NULL
```

- `srs_next_review_at` is a unix timestamp. `NULL` means "due immediately."
- All existing rows receive defaults automatically — they are all due on first launch.
- SRS state is client-only. No server-side schema changes (cloud sync is Phase 11).

### `fetchDueWords(tagId?: string): Promise<WordRow[]>`

Returns non-deleted words where:
```sql
deleted_at IS NULL
AND (srs_next_review_at IS NULL OR srs_next_review_at <= :now)
```
Optionally filtered by tag via existing join on `word_tags`.

### `updateWordSRS(wordId, interval, easeFactor, nextReviewAt): Promise<void>`

Plain `UPDATE` on the three SRS columns for a single word.

---

## SRS Algorithm (`src/screens/srsAlgorithm.ts`)

Pure functions, no imports from React or DB layers.

### Types

```ts
type CardState = {
  word: WordRow;
  interval: number;       // days; sourced from word.srs_interval on session start
  easeFactor: number;     // sourced from word.srs_ease_factor on session start
  inBuffer: boolean;
  successCount: number;   // consecutive correct answers while in buffer
}

type Session = {
  mainDeck: CardState[];      // words not yet answered correctly
  buffer: CardState[];        // failed words; must pass twice to graduate
  mainIndex: number;          // cursor into mainDeck
  cardsSinceBuffer: number;   // main-deck cards served since last buffer card
}

type SRSUpdate = {
  interval: number;
  easeFactor: number;
  nextReviewAt: Date;
}

type ResponseResult = {
  session: Session;
  srsUpdate: SRSUpdate;
}
```

### Functions

#### `createSession(words: WordRow[]): Session`

Shuffles words, initialises each `CardState` from the word's stored SRS values. Returns a fresh `Session` with an empty buffer.

#### `getNextCard(session: Session): CardState | null`

Interleaving rule: serve a buffer card every 3–5 main-deck cards (randomised each pick). Returns `null` when both `mainDeck` and `buffer` are empty (session complete).

#### `handleResponse(session, card, correct): ResponseResult`

**Correct answer:**
- If card is in buffer: increment `successCount`. If `successCount >= 2`, graduate: remove from buffer, reset interval to 1 day, set `nextReviewAt = now + 1 day`.
- If card is in mainDeck: apply SM-2 — `interval = max(1, interval * easeFactor)`, set `nextReviewAt = now + interval days`; remove from mainDeck.
- In both cases: `easeFactor` is unchanged on correct.

**Incorrect / blank answer:**
- Reset `interval = 0`, `easeFactor = max(1.3, easeFactor - 0.2)`.
- Set `inBuffer = true`, `successCount = 0`.
- Re-insert card into `buffer` at position `min(currentBufferIndex + 3, buffer.length)`.
- `nextReviewAt = now` (due immediately next session too).

Returns new immutable `Session` (spread copies) and `SRSUpdate` values to persist.

**SM-2 spacing formula:**
```
interval(n) = interval(n-1) * easeFactor
```
First correct from new card: `interval = 1`. Second: `interval = easeFactor`. Thereafter multiplicative.

#### `isSessionComplete(session: Session): boolean`

`session.mainDeck.length === 0 && session.buffer.length === 0`

---

## Setup Screen (`recall-setup.tsx`)

- Segmented toggle: **Classic | Adaptive** (default: Adaptive).
- **Classic:** word count = total non-deleted words in selected deck (existing behaviour).
- **Adaptive:** word count = due words today via `fetchDueWords(tagId?)`. If 0, shows "All caught up! No words due today" and disables Start.
- Mode passed to `/recall` as `mode` param (`'classic' | 'adaptive'`).

---

## Recall Screen (`recall.tsx`)

### Mode-aware loading

- Classic: `fetchAllWords()` / `fetchWordsByTag()` (unchanged).
- Adaptive: `fetchDueWords(tagId?)`.

### Progress indicator

- Classic: `{currentIndex + 1} / {deck.length}` (unchanged).
- Adaptive: `{remaining} left · {buffer.length} to retry` where `remaining = mainDeck.length`.

### Session loop (Adaptive only)

- Session stored in `useRef<Session>` (avoids re-render on every state mutation).
- Current card stored in `useState<CardState | null>`.
- After grading: call `handleResponse()` → get new session + srsUpdate; store new session in ref; update card state.
- On "Next": call `updateWordSRS(srsUpdate)` (fire-and-forget), then `getNextCard(session)` to advance.
- When `getNextCard` returns `null`: navigate to summary.

### Missed words tracking

- `missedIds` accumulated in `useRef<string[]>` — appended on first incorrect result per unique word ID.
- Passed to summary as `missedIds` URL param (comma-separated).

### Classic mode

Existing `currentIndex` linear cursor logic is untouched.

---

## Summary Screen (`recall-summary.tsx`)

- Receives `missedIds` param (comma-separated word IDs).
- On mount: fetch all words, filter to matched IDs.
- Renders "Missed Words (N)" section below the progress bar — only when `missedIds` is non-empty.
- Each row: word bold, definition in smaller grey text. Read-only `FlatList`.
- Restart re-navigates to `/recall` with same `tagId` and `mode` params (Adaptive re-fetches due words fresh).

---

## Data Flow

```
RecallSetup → (tagId, mode) → RecallScreen
RecallScreen → fetchDueWords / fetchAllWords → createSession
  → getNextCard → show card
  → user answers → gradeAnswer → handleResponse
  → updateWordSRS (fire-and-forget)
  → getNextCard → next card OR isSessionComplete
  → navigate to RecallSummary (score, total, missedIds)
RecallSummary → fetchAllWords → filter missedIds → render list
```

---

## Error Handling

- `updateWordSRS` failure is silent (fire-and-forget) — SRS state is best-effort; a failed write just means the word comes up again next session.
- `fetchDueWords` failure falls back to empty deck, showing "No words due today."
- Migration failure on startup is handled by existing DB client error boundary.

---

## Testing

- `src/screens/__tests__/srsAlgorithm.test.ts` — unit tests for `createSession`, `getNextCard`, `handleResponse`, `isSessionComplete` with deterministic inputs (no mocks needed, pure functions).
- `app/__tests__/recall-summary.test.tsx` — updated to test missed words section renders correctly.
- Existing `recall.test.tsx` tests remain valid for Classic mode path; Adaptive path tested via srsAlgorithm unit tests.

---

## Out of Scope

- Server-side SRS schema (Phase 11 cloud sync)
- Push notifications for due reviews
- FSRS algorithm (SM-2 is sufficient for Phase 8)
- Statistics / heatmap screens
