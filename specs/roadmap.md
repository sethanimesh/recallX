# Roadmap

Each phase is 1–3 days of focused work. Phases are ordered so every phase produces something runnable.

---

## Phase 0 — Skeleton ✅ (2026-04-18)
- Expo Router project initialised with TypeScript strict mode
- Navigation shell: tabs **Home**, **Practice**, **Settings** with Ionicons
- Drizzle ORM + expo-sqlite wired; WAL migration runs on startup (`[DB] Ready`)
- `ExtractionClient` interface + `StubExtractionClient` (5 hardcoded words) + `HttpExtractionClient` skeleton
- FastAPI backend (`backend/`) with stub `POST /extract`; Python venv at `backend/venv/`
- 5 Jest tests + 3 pytest tests — all passing; `tsc --noEmit` clean

**Run:** `npx expo start --ios` · `cd backend && source venv/bin/activate && uvicorn main:app --reload`  
**Spec:** `specs/2026-04-18-phase-0-skeleton/`

---

## Phase 1 — Data Model (Day 1–2)
Define and migrate the core schema:
- `words` — id, word, definition, example_sentence, source_id, created_at, updated_at, deleted_at
- `sources` — id, type (image/pdf/video), uri, created_at
- `tags` — id, name
- `word_tags` — word_id, tag_id

**Done when:** Schema compiles, migration runs, Drizzle queries return typed rows.

---

## Phase 2 — Ingestion UI ✅ (2026-04-18)
- FAB on Home tab opens ingestion modal with Camera, Photo Library, PDF pickers
- `expo-image-picker` + `expo-document-picker` wired and permission-gated
- Auto-extraction on pick (no separate confirm step)
- Three-step progress UI: Uploading → Analyzing → Done (react-native-reanimated)
- Error state with retry; modal auto-dismisses on Done
- 12 Jest tests passing; `tsc --noEmit` clean

**Spec:** `specs/2026-04-18-phase-2-ingestion-ui/`

---

## Phase 3A — LLM Provider Chain ✅ (2026-04-19)
- `LLMProvider` protocol + six adapters: Groq → OpenRouter → Ollama → Gemini → Mistral → HuggingFace
- Provider chain with automatic rate-limit failover; priority configurable via `PROVIDER_PRIORITY` env var
- Real `POST /extract` + `POST /extract/pdf` endpoints (stub replaced); `pdfminer.six` for PDF text
- `HttpExtractionClient` wired in app; `activeExtractionClient` switched from stub to HTTP
- HEIC → JPEG silent conversion via `expo-image-manipulator` before sending to backend
- iOS ATS exception added (`NSAllowsArbitraryLoads`) for local dev over HTTP
- Backend bound to `0.0.0.0` for physical device testing over local WiFi
- 17 Jest tests + 51 pytest tests passing; `tsc --noEmit` clean

**Run:** backend with `--host 0.0.0.0`; set at least one provider key (e.g. `GROQ_API_KEY`)  
**Spec:** `specs/2026-04-19-phase-3-llm-extraction/`

---

## Phase 3B — SQLite Persistence ✅ (2026-04-19)
- Persist extracted words to `words` and `sources` tables via Drizzle ORM
- Home tab displays word count after extraction
- Jest / Drizzle integration tests confirm inserts and transaction rollback

**Done when:** Pick a photo → words appear in SQLite `words` table.

---

## Phase 4 — Library Screen ✅ (2026-04-20)
- Removed auto-insert; gated SQLite writes behind a card-by-card review screen
- Accept/Reject review screen (`app/review.tsx`) — `insertExtraction` called once at end
- Library screen (`app/(tabs)/index.tsx`) — FlatList A-Z, live search, empty states
- Word detail screen (`app/words/[id].tsx`) — inline edit, soft-delete, tag chips, source row
- Manual word entry (`app/add-word.tsx`) + "Add Manually" button in ingest flow
- 54 Jest tests, 10 suites passing; `tsc --noEmit` clean

**Done when:** Words extracted in Phase 3 are browsable and searchable.

---

## Phase 5 — Tagging ✅ (2026-04-20)
- `src/db/operations/tags.ts` — createOrGetTag, getAllTags, getTagsForWord, addTagToWord, removeTagFromWord, renameTag, deleteTag, fetchWordsByTag, getTagWordCounts
- `TagPickerSheet` component — bottom-sheet with search/create input + checkbox multi-select
- Word Detail screen — interactive chips with × remove + "+ Add tag" button wired to picker
- Library screen — horizontal scrollable chip strip; single-active tag filter composes with text search
- `app/manage-tags.tsx` — rename/delete tags with word counts; wired from Settings tab
- 67 Jest tests, 11 suites passing; `tsc --noEmit` clean

**Done when:** User can group words into "GRE Prep" or "Chapter 3" tags and filter by them.

**Spec:** `specs/2026-04-20-phase-5-tagging/`

---

## Phase 6 — Review / Active Recall ✅ (2026-04-20)
- Backend `db.sqlite` word store enforces uniqueness (COLLATE NOCASE); client checks locally first; duplicate alert shown to user
- `POST /grade` FastAPI endpoint: LLM judges user answer against stored definition; structured `{ correct, feedback }` response
- `app/recall-setup.tsx` — pick tag or "All Words"; shows word count; Start disabled when pool empty
- `app/recall.tsx` — one word at a time; typed input; graded by LLM; Correct/Incorrect banner; definition + example revealed; score tracked
- `app/recall-summary.tsx` — session score, progress bar, Restart / Done actions
- Practice tab wired to recall flow
- 100 Jest tests, 99 passing (1 pre-existing `http.test` failure); 66 pytest tests, 63 passing (3 pre-existing failures)

**Done when:** Full recall loop works end-to-end for a set of words.

**Spec:** `specs/2026-04-20-phase-6-review/`

---

## Phase 7 — Review Polish (Day 8)
- Progress indicator (X of N) during a review session
- Session summary: score, words missed
- Mark a word as "mastered" (hide from future sessions unless reset)

**Done when:** Review sessions feel complete and track progress.

---

## Phase 8 — Settings (Day 9–10)
- Settings screen: configure FastAPI backend URL (default `http://localhost:8000`; stored in AsyncStorage)
- Choose preferred LLM vendor (Claude / OpenAI / Gemini) — sent as a preference to the backend, which holds the keys
- Basic app info, reset progress option

**Done when:** User can point the app at a different backend URL and switch preferred vendor without touching code.

---

## Phase 9 — Sharing (Day 11–12)
- Export a tag/deck as JSON or shareable link (deep link)
- Import a shared deck (parse JSON, merge into local DB, skip duplicates)
- Share sheet integration via `expo-sharing`

**Done when:** User can send a deck to a friend who can import it.

---

## Phase 10 — Cloud Sync Prep (Future)
- Add `synced_at` column to all tables
- Set up Supabase project, mirror schema
- Background sync worker: push local-only rows, pull remote changes
- Auth: magic link or Apple Sign-In

**Done when:** Data survives a device wipe and appears on a second device.

---

## Deferred / Nice-to-Have
- Spaced repetition (SM-2 or FSRS algorithm)
- Audio pronunciation
- Video frame extraction (beyond single keyframe)
- Word-of-the-day widget
- iCloud backup
