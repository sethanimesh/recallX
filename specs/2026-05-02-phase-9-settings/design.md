# Phase 9 — Settings Design Spec

**Date:** 2026-05-02  
**Status:** Approved  
**Scope:** Backend URL config, LLM provider preference, app info, reset SRS progress

---

## Problem

The backend URL is hardcoded in `src/api/http.ts`. There is no way to switch LLM providers or reset spaced-repetition progress without touching code.

---

## Goals

1. User can configure the backend URL, stored in AsyncStorage, used by all API clients
2. User can pick a preferred LLM provider from those actually configured on the backend (`GET /providers`)
3. App version is visible in Settings
4. User can reset SRS progress (zeroes SRS state on all words, clears session history) — words and tags are kept

---

## Architecture

Four concerns wired through a single settings module:

| Concern | Location |
|---|---|
| Persistence + in-memory cache | `src/config/settings.ts` |
| Backend provider discovery | `backend/routers/providers.py` + `GET /providers` |
| Settings UI | `app/(tabs)/settings.tsx` + `app/settings-url.tsx` |
| SRS reset | `src/config/settings.ts` → Drizzle transaction |

---

## Settings Module (`src/config/settings.ts`)

```ts
initSettings(): Promise<void>
getBackendUrl(): string
setBackendUrl(url: string): Promise<void>
getPreferredProvider(): string | null   // null = no preference
setPreferredProvider(p: string | null): Promise<void>
resetSRSProgress(): Promise<void>
```

**Init:** Called once in `app/_layout.tsx` on app start. Loads `backendUrl` and `preferredProvider` from AsyncStorage into module-level variables. Falls back to `DEFAULT_BASE_URL` and `null` if AsyncStorage fails.

**Preferred provider header:** All backend requests include `X-Preferred-Provider: <value>` when a provider is set. The backend ignores this header for now — it is a no-op until the backend wires it into the provider chain.

**resetSRSProgress:** Runs a single Drizzle transaction that:
- Sets `srs_interval = 0`, `srs_ease_factor = 2.5`, `srs_wrong_count = 0`, `fc_interval = 0`, `fc_ease_factor = 2.5`, `fc_wrong_count = 0` on every row in `words`
- Deletes all rows from `session_results`
- Deletes all rows from `sessions`

Words and tags are untouched.

---

## Backend: `GET /providers`

New FastAPI endpoint in `backend/routers/providers.py`:

```json
// Response
{ "providers": ["groq", "gemini", "mistral"] }
```

Returns the names of providers that have an API key set in the environment. Implementation: iterate over the known provider list (Groq, OpenRouter, Ollama, Gemini, Mistral, HuggingFace) and include any whose env var is non-empty.

---

## Settings UI

### `app/(tabs)/settings.tsx`

Two sections added below existing rows:

**Connection**
- **Backend URL** — current URL shown as subtitle; chevron; navigates to `app/settings-url.tsx`
- **AI Provider** — subtitle shows selected provider or "None (auto)"; tap opens `ActionSheetIOS` listing providers from `GET /providers` plus a "None (auto)" option; shows "Loading…" while fetching, "Unavailable" on error

**App**
- **Version** — static; reads `Constants.expoConfig.version`; no chevron, no tap
- **Reset SRS Progress** — red label; tap shows confirmation `Alert`; on confirm calls `resetSRSProgress()`; shows brief success message

### `app/settings-url.tsx`

Single text input pre-filled with current URL. Validates that the value starts with `http://` or `https://` before saving. Shows an inline error on invalid input. On save: calls `setBackendUrl()`, navigates back.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| AsyncStorage read fails on init | Fall back to `DEFAULT_BASE_URL` and `null` provider — app boots normally |
| `GET /providers` fails | Show "Unavailable" in provider row; no crash; retry on next settings open |
| Invalid URL entered | Inline validation error before save; nothing persisted |
| `resetSRSProgress` DB error | Alert "Reset failed, try again"; transaction rolled back — no partial state |

---

## Testing

### Frontend (`src/config/__tests__/settings.test.ts`)
- `initSettings` falls back to defaults when AsyncStorage throws
- `setBackendUrl` / `getBackendUrl` round-trip
- `setPreferredProvider` / `getPreferredProvider` round-trip including `null`
- `resetSRSProgress` — inserts SRS data + sessions, calls reset, confirms zeroes and empty tables

### Backend (`backend/tests/test_providers.py`)
- `GET /providers` returns only providers whose env var is set
- Returns empty list when no keys configured

---

## Files Changed

| File | Change |
|---|---|
| `src/config/settings.ts` | New file — settings singleton |
| `src/config/__tests__/settings.test.ts` | New file — unit + integration tests |
| `app/_layout.tsx` | Call `initSettings()` on app start |
| `src/api/http.ts` | `getBackendUrl()` replaces `DEFAULT_BASE_URL`; add `X-Preferred-Provider` header |
| `src/api/gradeClient.ts` | Use `getBackendUrl()` |
| `src/api/wordServerClient.ts` | Use `getBackendUrl()` |
| `src/api/statsClient.ts` | Use `getBackendUrl()` |
| `app/(tabs)/settings.tsx` | Add four new rows |
| `app/settings-url.tsx` | New file — URL edit screen |
| `backend/routers/providers.py` | New file — `GET /providers` |
| `backend/main.py` | Register providers router |
| `backend/tests/test_providers.py` | New file — provider endpoint tests |
