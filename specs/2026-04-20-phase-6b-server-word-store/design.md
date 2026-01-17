# Phase 6b — Server Word Store: Design

## Problem

The server currently stores only word text (for duplicate detection). Full word data — definitions, example sentences, tags — lives exclusively in the device's local SQLite database. There is no single source of truth: if the device is wiped or the app is reinstalled, all vocabulary is lost.

## Goal

Make the FastAPI backend the single source of truth for all words and tags. The app keeps a local SQLite cache for offline reading (library browsing, recall sessions) and syncs from the server on launch. All mutations (add, edit, delete, tag) write to the server first, then mirror locally.

---

## Architecture

### Write Path

```
User action (ingest / edit / tag)
  → App calls server endpoint  (e.g. POST /words)
  → Server writes to backend/db.sqlite, returns saved record
  → App writes returned record to local SQLite
  → UI reads from local SQLite as normal
```

If the server is unreachable, the mutation fails with an error alert. No silent local-only writes.

### Read Path

Always local SQLite — no change from today. Library, recall sessions, word detail: all unchanged.

### Sync on App Start

```
_layout.tsx → runMigrations() → syncFromServer()
  GET /words → replace all local words
  GET /tags  → replace all local tags + word_tags
```

- Shows a loading indicator during sync.
- If server unreachable: proceeds with stale local data, shows a dismissable "Could not sync — showing cached data" banner.

### Migration Strategy

"Start fresh" — on first launch of this version, local tables are emptied and repopulated from the server (which starts empty). No data migration from old local DB.

---

## Server DB Schema (`backend/db.sqlite`)

Replaces the current single-column `words (word TEXT PRIMARY KEY COLLATE NOCASE)` table.

```sql
CREATE TABLE IF NOT EXISTS words (
  id               TEXT PRIMARY KEY,
  word             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  definition       TEXT NOT NULL,
  example_sentence TEXT NOT NULL,
  source_type      TEXT,                        -- 'image' | 'pdf' | null
  created_at       INTEGER NOT NULL,            -- Unix ms
  updated_at       INTEGER NOT NULL,
  deleted_at       INTEGER                      -- null = not deleted (soft delete)
);

CREATE TABLE IF NOT EXISTS tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS word_tags (
  word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (word_id, tag_id)
);
```

IDs are client-generated UUIDs (expo-crypto) — no server-assigned IDs, avoids a round-trip.

Duplicate detection: `UNIQUE COLLATE NOCASE` on `words.word` replaces the old `insert_word()` logic. A `409 Conflict` response signals a duplicate.

---

## API Endpoints

All new endpoints live in two new routers: `backend/routers/words.py` and `backend/routers/tags.py`.

### Words

| Method   | Path               | Body / Params                                  | Response                  |
|----------|--------------------|------------------------------------------------|---------------------------|
| `POST`   | `/words`           | `{ id, word, definition, example_sentence, source_type?, created_at, updated_at }` | `WordRecord` or 409 |
| `GET`    | `/words`           | —                                              | `WordRecord[]` (with tags) |
| `PATCH`  | `/words/{id}`      | `{ definition?, example_sentence? }`          | `WordRecord`              |
| `DELETE` | `/words/{id}`      | —                                              | 204 (soft delete)         |

### Tags

| Method   | Path                          | Body / Params         | Response       |
|----------|-------------------------------|-----------------------|----------------|
| `POST`   | `/tags`                       | `{ id, name }`        | `TagRecord`    |
| `GET`    | `/tags`                       | —                     | `TagRecord[]` (with word counts) |
| `PATCH`  | `/tags/{id}`                  | `{ name }`            | `TagRecord` or 409 on name collision |
| `DELETE` | `/tags/{id}`                  | —                     | 204            |
| `POST`   | `/words/{id}/tags/{tag_id}`   | —                     | 204            |
| `DELETE` | `/words/{id}/tags/{tag_id}`   | —                     | 204            |

---

## Client Changes

### New files

| File | Purpose |
|------|---------|
| `src/api/wordServerClient.ts` | Typed HTTP client for all word/tag mutations. Exports one function per endpoint. Throws `WordServerError(message, statusCode)` on non-2xx. |
| `src/api/syncClient.ts` | Thin client for `GET /words` and `GET /tags`. Used only by the sync-on-start flow. |

### Updated files

| File | Change |
|------|--------|
| `src/db/operations/insertExtraction.ts` | Call `POST /words` per word before local insert. 409 → treat as duplicate (existing behaviour). |
| `src/db/operations/insertManualWord.ts` | Call `POST /words` before local insert. |
| `src/db/operations/wordDetail.ts` | `updateWordField` → `PATCH /words/{id}` first. `softDeleteWord` → `DELETE /words/{id}` first. |
| `src/db/operations/tags.ts` | `createOrGetTag` → `POST /tags` first. `addTagToWord` / `removeTagFromWord` → server first. `renameTag` → `PATCH /tags/{id}` first. `deleteTag` → `DELETE /tags/{id}` first. |
| `app/_layout.tsx` | After `runMigrations()`, call `syncFromServer()`. Show loading + error banner. |

### No screen changes

All screens read local SQLite. No changes to Library, Word Detail, Recall, Tags, or Settings screens.

---

## What's Out

- Multi-device sync / conflict resolution (Phase 10)
- Auth (Phase 10)
- Offline write queue / retry (future — failures alert the user today)
- Partial sync / incremental updates (full replace on start is sufficient at this scale)

---

## Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| ID origin | Client-generated UUID | No round-trip; consistent with current Drizzle schema |
| Offline mutations | Fail with alert | Keeps server authoritative; retry is manual |
| Duplicate signal | 409 from server | Replaces `insert_word()` bool; consistent HTTP semantics |
| Sync strategy | Full replace on start | Simple; no conflict resolution needed for single-user |
| Start fresh | Wipe local on first sync | No migration complexity; user accepted data loss |
| Soft delete | Server sets `deleted_at`; client mirrors | Consistent with existing schema design |
