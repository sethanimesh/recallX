# Phase 9 — Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend URL and LLM provider preference configurable in Settings, expose app version, and allow resetting SRS progress.

**Architecture:** A `src/config/settings.ts` singleton loads config from AsyncStorage on app start and provides `getBackendUrl()` / `getCommonHeaders()` / `resetSRSProgress()`. All API clients call `getBackendUrl()` at request time. A new `GET /providers` backend endpoint returns which providers have API keys configured. The Settings tab gains four new rows (Backend URL, AI Provider, Version, Reset SRS).

**Tech Stack:** `@react-native-async-storage/async-storage`, `ActionSheetIOS` (iOS built-in), FastAPI, Drizzle ORM.

---

## File Map

| File | Action |
|---|---|
| `src/config/settings.ts` | Create — settings singleton |
| `src/config/__tests__/settings.test.ts` | Create — unit tests |
| `app/_layout.tsx` | Modify — call `initSettings()` first in init sequence; register `settings-url` screen |
| `src/api/http.ts` | Modify — use `getBackendUrl()` + `getCommonHeaders()` |
| `src/api/gradeClient.ts` | Modify — use `getBackendUrl()` + `getCommonHeaders()` |
| `src/api/wordServerClient.ts` | Modify — use `getBackendUrl()` + `getCommonHeaders()` |
| `src/api/statsClient.ts` | Modify — use `getBackendUrl()` + `getCommonHeaders()` |
| `app/settings-url.tsx` | Create — URL edit screen |
| `app/(tabs)/settings.tsx` | Modify — add 4 new rows |
| `backend/routers/providers.py` | Create — `GET /providers` |
| `backend/main.py` | Modify — register providers router |
| `backend/tests/test_providers.py` | Create — provider endpoint tests |

---

## Task 1: Install AsyncStorage

**Files:**
- Modify: `package.json` (via npx expo install)

- [ ] **Step 1: Install the package**

```bash
cd /Users/animesh/Animesh/Projects/RecallX
npx expo install @react-native-async-storage/async-storage
```

Expected: package added to `package.json` and `node_modules`.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @react-native-async-storage/async-storage"
```

---

## Task 2: Backend `GET /providers` endpoint

**Files:**
- Create: `backend/routers/providers.py`
- Create: `backend/tests/test_providers.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_providers.py`:

```python
"""Tests for GET /providers endpoint."""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch


def test_providers_returns_configured_providers(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OLLAMA_API_KEY", raising=False)
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)
    monkeypatch.delenv("HF_API_KEY", raising=False)

    from main import app
    client = TestClient(app)
    resp = client.get("/providers")
    assert resp.status_code == 200
    data = resp.json()
    assert set(data["providers"]) == {"groq", "gemini"}


def test_providers_returns_empty_when_no_keys_set(monkeypatch):
    for env_var in ["GROQ_API_KEY", "OPENROUTER_API_KEY", "OLLAMA_API_KEY",
                    "GEMINI_API_KEY", "MISTRAL_API_KEY", "HF_API_KEY"]:
        monkeypatch.delenv(env_var, raising=False)

    from main import app
    client = TestClient(app)
    resp = client.get("/providers")
    assert resp.status_code == 200
    assert resp.json()["providers"] == []


def test_providers_preserves_order(monkeypatch):
    for env_var in ["GROQ_API_KEY", "OPENROUTER_API_KEY", "OLLAMA_API_KEY",
                    "GEMINI_API_KEY", "MISTRAL_API_KEY", "HF_API_KEY"]:
        monkeypatch.setenv(env_var, "key")

    from main import app
    client = TestClient(app)
    resp = client.get("/providers")
    assert resp.status_code == 200
    assert resp.json()["providers"] == ["groq", "openrouter", "ollama", "gemini", "mistral", "huggingface"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/animesh/Animesh/Projects/RecallX/backend
source venv/bin/activate
pytest tests/test_providers.py -v
```

Expected: FAIL — `ImportError` or route not found.

- [ ] **Step 3: Create the providers router**

Create `backend/routers/providers.py`:

```python
import os
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

_PROVIDER_ENV_VARS: list[tuple[str, str]] = [
    ("groq", "GROQ_API_KEY"),
    ("openrouter", "OPENROUTER_API_KEY"),
    ("ollama", "OLLAMA_API_KEY"),
    ("gemini", "GEMINI_API_KEY"),
    ("mistral", "MISTRAL_API_KEY"),
    ("huggingface", "HF_API_KEY"),
]


class ProvidersResponse(BaseModel):
    providers: list[str]


@router.get("/providers", response_model=ProvidersResponse)
def list_providers() -> ProvidersResponse:
    available = [name for name, env_var in _PROVIDER_ENV_VARS if os.environ.get(env_var)]
    return ProvidersResponse(providers=available)
```

- [ ] **Step 4: Register the router in `backend/main.py`**

```python
from routers import extract, grade, words, tags, transcribe, pronunciations, stats, providers

# ...existing code...

app.include_router(providers.router)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_providers.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/providers.py backend/tests/test_providers.py backend/main.py
git commit -m "feat: add GET /providers endpoint"
```

---

## Task 3: Settings module

**Files:**
- Create: `src/config/settings.ts`
- Create: `src/config/__tests__/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/config/__tests__/settings.test.ts`:

```ts
// Mocks must be declared before imports

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRemoveItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: mockGetItem,
  setItem: mockSetItem,
  removeItem: mockRemoveItem,
}));

const mockSet = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockReturnValue({ set: mockSet });
const mockDelete = jest.fn().mockResolvedValue(undefined);
const mockTx = { delete: mockDelete, update: mockUpdate };

jest.mock('@/src/db/client', () => ({
  db: {
    transaction: jest.fn((fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
  },
}));

jest.mock('@/src/db/schema', () => ({
  words: 'words-table',
  sessions: 'sessions-table',
  sessionResults: 'session-results-table',
}));

import {
  initSettings,
  getBackendUrl,
  setBackendUrl,
  getPreferredProvider,
  setPreferredProvider,
  getCommonHeaders,
  resetSRSProgress,
  DEFAULT_BACKEND_URL,
} from '../settings';

beforeEach(() => {
  mockGetItem.mockReset();
  mockSetItem.mockReset();
  mockRemoveItem.mockReset();
  mockDelete.mockReset().mockResolvedValue(undefined);
  mockUpdate.mockReset().mockReturnValue({ set: mockSet });
  mockSet.mockReset().mockResolvedValue(undefined);
});

describe('initSettings', () => {
  it('loads backendUrl and preferredProvider from AsyncStorage', async () => {
    mockGetItem
      .mockResolvedValueOnce('http://192.168.1.50:8000')
      .mockResolvedValueOnce('gemini');
    await initSettings();
    expect(getBackendUrl()).toBe('http://192.168.1.50:8000');
    expect(getPreferredProvider()).toBe('gemini');
  });

  it('falls back to defaults when AsyncStorage returns null', async () => {
    mockGetItem.mockResolvedValue(null);
    await initSettings();
    expect(getBackendUrl()).toBe(DEFAULT_BACKEND_URL);
    expect(getPreferredProvider()).toBeNull();
  });

  it('falls back to defaults when AsyncStorage throws', async () => {
    mockGetItem.mockRejectedValue(new Error('Storage unavailable'));
    await initSettings();
    expect(getBackendUrl()).toBe(DEFAULT_BACKEND_URL);
    expect(getPreferredProvider()).toBeNull();
  });
});

describe('setBackendUrl / getBackendUrl', () => {
  it('updates the in-memory URL and persists to AsyncStorage', async () => {
    await setBackendUrl('http://10.0.0.1:8000');
    expect(getBackendUrl()).toBe('http://10.0.0.1:8000');
    expect(mockSetItem).toHaveBeenCalledWith('recallx:backendUrl', 'http://10.0.0.1:8000');
  });
});

describe('setPreferredProvider / getPreferredProvider', () => {
  it('stores a provider name and persists it', async () => {
    await setPreferredProvider('groq');
    expect(getPreferredProvider()).toBe('groq');
    expect(mockSetItem).toHaveBeenCalledWith('recallx:preferredProvider', 'groq');
  });

  it('clears the provider when set to null and removes from AsyncStorage', async () => {
    await setPreferredProvider('groq');
    await setPreferredProvider(null);
    expect(getPreferredProvider()).toBeNull();
    expect(mockRemoveItem).toHaveBeenCalledWith('recallx:preferredProvider');
  });
});

describe('getCommonHeaders', () => {
  it('returns empty object when no provider is set', async () => {
    await setPreferredProvider(null);
    expect(getCommonHeaders()).toEqual({});
  });

  it('returns X-Preferred-Provider header when a provider is set', async () => {
    await setPreferredProvider('gemini');
    expect(getCommonHeaders()).toEqual({ 'X-Preferred-Provider': 'gemini' });
  });
});

describe('resetSRSProgress', () => {
  it('deletes session_results and sessions, then resets all SRS fields on words', async () => {
    await resetSRSProgress();
    expect(mockDelete).toHaveBeenCalledWith('session-results-table');
    expect(mockDelete).toHaveBeenCalledWith('sessions-table');
    expect(mockUpdate).toHaveBeenCalledWith('words-table');
    expect(mockSet).toHaveBeenCalledWith({
      srs_interval: 0,
      srs_ease_factor: 2.5,
      srs_wrong_count: 0,
      srs_consecutive_correct: 0,
      srs_next_review_at: null,
      fc_interval: 0,
      fc_ease_factor: 2.5,
      fc_wrong_count: 0,
      fc_consecutive_correct: 0,
      fc_next_review_at: null,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/animesh/Animesh/Projects/RecallX
npx jest src/config/__tests__/settings.test.ts --no-coverage
```

Expected: FAIL — module `../settings` not found.

- [ ] **Step 3: Create the settings module**

Create `src/config/settings.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '@/src/db/client';
import { words, sessions, sessionResults } from '@/src/db/schema';

const BACKEND_URL_KEY = 'recallx:backendUrl';
const PREFERRED_PROVIDER_KEY = 'recallx:preferredProvider';

export const DEFAULT_BACKEND_URL = 'http://192.168.68.104:8000';

let _backendUrl: string = DEFAULT_BACKEND_URL;
let _preferredProvider: string | null = null;

export async function initSettings(): Promise<void> {
  try {
    const [url, provider] = await Promise.all([
      AsyncStorage.getItem(BACKEND_URL_KEY),
      AsyncStorage.getItem(PREFERRED_PROVIDER_KEY),
    ]);
    if (url) _backendUrl = url;
    if (provider) _preferredProvider = provider;
  } catch {
    // fall back to defaults — app must boot regardless
  }
}

export function getBackendUrl(): string {
  return _backendUrl;
}

export async function setBackendUrl(url: string): Promise<void> {
  _backendUrl = url;
  await AsyncStorage.setItem(BACKEND_URL_KEY, url);
}

export function getPreferredProvider(): string | null {
  return _preferredProvider;
}

export async function setPreferredProvider(provider: string | null): Promise<void> {
  _preferredProvider = provider;
  if (provider === null) {
    await AsyncStorage.removeItem(PREFERRED_PROVIDER_KEY);
  } else {
    await AsyncStorage.setItem(PREFERRED_PROVIDER_KEY, provider);
  }
}

export function getCommonHeaders(): Record<string, string> {
  if (_preferredProvider) {
    return { 'X-Preferred-Provider': _preferredProvider };
  }
  return {};
}

export async function resetSRSProgress(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(sessionResults);
    await tx.delete(sessions);
    await tx.update(words).set({
      srs_interval: 0,
      srs_ease_factor: 2.5,
      srs_wrong_count: 0,
      srs_consecutive_correct: 0,
      srs_next_review_at: null,
      fc_interval: 0,
      fc_ease_factor: 2.5,
      fc_wrong_count: 0,
      fc_consecutive_correct: 0,
      fc_next_review_at: null,
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/config/__tests__/settings.test.ts --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/settings.ts src/config/__tests__/settings.test.ts
git commit -m "feat: add settings singleton with AsyncStorage persistence"
```

---

## Task 4: Wire `initSettings()` into app startup

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Update `_layout.tsx` to call `initSettings()` first**

In `app/_layout.tsx`, add the import and call `initSettings()` before `runMigrations()`:

```ts
import { initSettings } from '@/src/config/settings';
```

Update the `init` function inside `useEffect`:

```ts
async function init() {
  const minDelay = new Promise<void>((r) => setTimeout(r, 2800));
  try {
    await initSettings();
  } catch (err) {
    console.warn('[Settings] Init error:', err);
  }
  try {
    await runMigrations();
  } catch (err) {
    console.error('[DB] Migration error:', err);
  }
  try {
    await syncFromServer();
  } catch (err) {
    console.warn('[Sync] Failed — using cached data:', err);
    setSyncError(true);
  }
  await minDelay;
  setReady(true);
}
```

Also add the `settings-url` screen to the Stack (inside the `<Stack>` element):

```tsx
<Stack.Screen name="settings-url" options={{ title: 'Backend URL', headerBackTitle: 'Settings' }} />
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat: call initSettings on app start, register settings-url screen"
```

---

## Task 5: Update API clients to use `getBackendUrl()` and `getCommonHeaders()`

**Files:**
- Modify: `src/api/http.ts`
- Modify: `src/api/gradeClient.ts`
- Modify: `src/api/wordServerClient.ts`
- Modify: `src/api/statsClient.ts`

- [ ] **Step 1: Update `src/api/http.ts`**

Replace the file with:

```ts
import type { ExtractedWord, ExtractionClient, ImageInput, TextInput } from './types';
import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';

export { DEFAULT_BACKEND_URL } from '@/src/config/settings';

export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export class HttpExtractionClient implements ExtractionClient {
  private readonly baseUrl?: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl;
  }

  async extractWords(input: ImageInput | TextInput): Promise<ExtractedWord[]> {
    const base = (this.baseUrl ?? getBackendUrl()).replace(/\/$/, '');
    const body =
      input.type === 'image'
        ? { input_type: 'image' as const, content: input.base64, mime_type: input.mimeType }
        : { input_type: 'text' as const, content: input.content, mime_type: null };

    const url = `${base}/extract`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        detail = err?.detail ?? detail;
      } catch {}
      throw new ExtractionError(`Extraction failed: ${detail}`, response.status);
    }

    const data = await response.json();
    return data as ExtractedWord[];
  }
}

export async function lookupWord(word: string, baseUrl?: string): Promise<ExtractedWord> {
  const base = (baseUrl ?? getBackendUrl()).replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
      body: JSON.stringify({ input_type: 'word', content: word }),
    });
  } catch {
    throw new ExtractionError('Network error', 0);
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? detail;
    } catch {}
    throw new ExtractionError(`Lookup failed: ${detail}`, response.status);
  }
  const data = await response.json() as ExtractedWord[];
  if (!data || data.length === 0) {
    throw new ExtractionError('No result returned for word lookup', 0);
  }
  return data[0];
}
```

- [ ] **Step 2: Update `src/api/gradeClient.ts`**

Replace the file with:

```ts
import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';

export interface GradeResult {
  correct: boolean;
  feedback: string;
}

export class GradeError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'GradeError';
  }
}

export async function gradeAnswer(
  word: string,
  userAnswer: string,
  storedDefinition: string,
  baseUrl?: string,
): Promise<GradeResult> {
  const url = `${(baseUrl ?? getBackendUrl()).replace(/\/$/, '')}/grade`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
    body: JSON.stringify({ word, user_answer: userAnswer, stored_definition: storedDefinition }),
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? detail;
    } catch {}
    throw new GradeError(`Grade failed: ${detail}`, response.status);
  }
  return (await response.json()) as GradeResult;
}
```

- [ ] **Step 3: Update `src/api/wordServerClient.ts`**

Update the `request` function at the top (line 45) and all functions that accept `baseUrl`. Replace the top-level constant and `request` function:

```ts
import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';

// ... keep all interfaces (ServerTagRecord, ServerWordRecord, etc.) unchanged ...

async function request<T>(url: string, options: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...getCommonHeaders(), ...(options.headers ?? {}) },
    });
  } catch {
    throw new WordServerError('Network error', 0);
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? detail;
    } catch {}
    throw new WordServerError(`Request failed: ${detail}`, response.status);
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    return undefined as T;
  }
}
```

Remove `const DEFAULT_BASE_URL = ...` at the top. Change all function signatures from `baseUrl = DEFAULT_BASE_URL` to `baseUrl?: string` and replace `${baseUrl}/` with `${(baseUrl ?? getBackendUrl())/`:

```ts
export function postWord(payload: CreateWordPayload, baseUrl?: string) {
  return request<ServerWordRecord>(`${(baseUrl ?? getBackendUrl())}/words`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getWords(baseUrl?: string) {
  return request<ServerWordRecord[]>(`${(baseUrl ?? getBackendUrl())}/words`, { method: 'GET' });
}

export function patchWord(
  id: string,
  updates: { definition?: string; example_sentence?: string },
  baseUrl?: string,
) {
  return request<ServerWordRecord>(`${(baseUrl ?? getBackendUrl())}/words/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export function deleteWord(id: string, baseUrl?: string) {
  return request<ServerWordRecord>(`${(baseUrl ?? getBackendUrl())}/words/${id}`, { method: 'DELETE' });
}

export function postTag(payload: { id: string; name: string }, baseUrl?: string) {
  return request<ServerTagRecord>(`${(baseUrl ?? getBackendUrl())}/tags`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getTags(baseUrl?: string) {
  return request<ServerTagRecord[]>(`${(baseUrl ?? getBackendUrl())}/tags`, { method: 'GET' });
}

export function patchTag(id: string, payload: { name: string }, baseUrl?: string) {
  return request<ServerTagRecord>(`${(baseUrl ?? getBackendUrl())}/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteTag(id: string, baseUrl?: string) {
  return request<void>(`${(baseUrl ?? getBackendUrl())}/tags/${id}`, { method: 'DELETE' });
}

export function mergeTag(sourceTagId: string, targetTagId: string, baseUrl?: string) {
  return request<ServerTagRecord>(`${(baseUrl ?? getBackendUrl())}/tags/${sourceTagId}/merge`, {
    method: 'POST',
    body: JSON.stringify({ target_tag_id: targetTagId }),
  });
}

export function addTagToWord(wordId: string, tagId: string, baseUrl?: string) {
  return request<void>(`${(baseUrl ?? getBackendUrl())}/words/${wordId}/tags/${tagId}`, { method: 'POST' });
}

export function removeTagFromWord(wordId: string, tagId: string, baseUrl?: string) {
  return request<void>(`${(baseUrl ?? getBackendUrl())}/words/${wordId}/tags/${tagId}`, { method: 'DELETE' });
}

export function getPronunciation(word: string, baseUrl?: string) {
  return request<PronunciationRecord>(
    `${(baseUrl ?? getBackendUrl())}/pronunciations/${encodeURIComponent(word)}`,
    { method: 'GET' },
  );
}
```

- [ ] **Step 4: Update `src/api/statsClient.ts`**

Replace the import and function signature:

```ts
import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';

// ... keep all interfaces (Period, ProviderCount, LlmCall, LlmStatsResponse, StatsError) unchanged ...

export async function fetchLlmStats(
  period: Period,
  baseUrl?: string,
): Promise<LlmStatsResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${(baseUrl ?? getBackendUrl()).replace(/\/$/, '')}/stats/llm?period=${period}`,
      { headers: getCommonHeaders() },
    );
  } catch {
    throw new StatsError('Network error', 0);
  }
  if (!response.ok) {
    throw new StatsError(`Failed to fetch LLM stats: HTTP ${response.status}`, response.status);
  }
  return response.json() as Promise<LlmStatsResponse>;
}
```

- [ ] **Step 5: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run existing API client tests**

```bash
npx jest src/api --no-coverage
```

Expected: all existing tests PASS (they pass explicit `baseUrl` so the new default doesn't affect them).

- [ ] **Step 7: Commit**

```bash
git add src/api/http.ts src/api/gradeClient.ts src/api/wordServerClient.ts src/api/statsClient.ts
git commit -m "feat: use getBackendUrl() and getCommonHeaders() in all API clients"
```

---

## Task 6: URL edit screen

**Files:**
- Create: `app/settings-url.tsx`

- [ ] **Step 1: Create `app/settings-url.tsx`**

```tsx
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBackendUrl, setBackendUrl } from '@/src/config/settings';

export default function SettingsUrlScreen() {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState(getBackendUrl());
  const [error, setError] = useState<string | null>(null);

  function validate(value: string): string | null {
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      return 'URL must start with http:// or https://';
    }
    return null;
  }

  async function handleSave() {
    const err = validate(url.trim());
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    await setBackendUrl(url.trim());
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.label}>Backend URL</Text>
      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        value={url}
        onChangeText={(t) => { setUrl(t); setError(null); }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://192.168.x.x:8000"
        placeholderTextColor="#9CA3AF"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={handleSave} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Save</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 32,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  inputError: {
    borderColor: '#EF4444',
  },
  error: {
    marginTop: 6,
    fontSize: 13,
    color: '#EF4444',
  },
  button: {
    marginTop: 24,
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/settings-url.tsx
git commit -m "feat: add Backend URL edit screen"
```

---

## Task 7: Settings UI

**Files:**
- Modify: `app/(tabs)/settings.tsx`

- [ ] **Step 1: Replace `app/(tabs)/settings.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActionSheetIOS } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import {
  getBackendUrl,
  getPreferredProvider,
  setPreferredProvider,
  resetSRSProgress,
} from '@/src/config/settings';

type ProvidersStatus = 'loading' | 'loaded' | 'error';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [currentUrl, setCurrentUrl] = useState(getBackendUrl());
  const [providers, setProviders] = useState<string[]>([]);
  const [providersStatus, setProvidersStatus] = useState<ProvidersStatus>('loading');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(getPreferredProvider());

  useEffect(() => {
    async function loadProviders() {
      try {
        const res = await fetch(`${getBackendUrl()}/providers`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        setProviders(data.providers as string[]);
        setProvidersStatus('loaded');
      } catch {
        setProvidersStatus('error');
      }
    }
    loadProviders();
  }, []);

  // Refresh URL display when returning from the URL edit screen
  useEffect(() => {
    setCurrentUrl(getBackendUrl());
  });

  function openProviderPicker() {
    const options = ['None (auto)', ...providers, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1 },
      (index) => {
        if (index === options.length - 1) return;
        const chosen = index === 0 ? null : providers[index - 1];
        setSelectedProvider(chosen);
        setPreferredProvider(chosen).catch(() => {});
      },
    );
  }

  function handleResetSRS() {
    Alert.alert(
      'Reset SRS Progress',
      'This will reset all spaced repetition progress. Your words and tags are kept. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              await resetSRSProgress();
              Alert.alert('Done', 'SRS progress has been reset.');
            } catch {
              Alert.alert('Error', 'Reset failed, try again.');
            }
          },
        },
      ],
    );
  }

  const providerSubtitle =
    providersStatus === 'loading'
      ? 'Loading…'
      : providersStatus === 'error'
        ? 'Unavailable'
        : selectedProvider ?? 'None (auto)';

  const version = Constants.expoConfig?.version ?? '—';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>LIBRARY</Text>

        <TouchableOpacity style={styles.row} onPress={() => router.push('/manage-tags')} activeOpacity={0.7}>
          <Ionicons name="pricetags-outline" size={22} color="#374151" style={styles.rowIcon} />
          <Text style={styles.rowLabel}>Manage Tags</Text>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => router.push('/llm-stats')} activeOpacity={0.7}>
          <Ionicons name="hardware-chip-outline" size={22} color="#374151" style={styles.rowIcon} />
          <Text style={styles.rowLabel}>AI Usage</Text>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>CONNECTION</Text>

        <TouchableOpacity style={styles.row} onPress={() => router.push('/settings-url')} activeOpacity={0.7}>
          <Ionicons name="server-outline" size={22} color="#374151" style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Backend URL</Text>
            <Text style={styles.rowSubtitle} numberOfLines={1}>{currentUrl}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.row}
          onPress={providersStatus === 'loaded' ? openProviderPicker : undefined}
          activeOpacity={providersStatus === 'loaded' ? 0.7 : 1}
        >
          <Ionicons name="sparkles-outline" size={22} color="#374151" style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>AI Provider</Text>
            <Text style={styles.rowSubtitle}>{providerSubtitle}</Text>
          </View>
          {providersStatus === 'loaded' && <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />}
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>APP</Text>

        <View style={styles.row}>
          <Ionicons name="information-circle-outline" size={22} color="#374151" style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowSubtitle}>{version}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.row} onPress={handleResetSRS} activeOpacity={0.7}>
          <Ionicons name="refresh-outline" size={22} color="#EF4444" style={styles.rowIcon} />
          <Text style={[styles.rowLabel, styles.destructive]}>Reset SRS Progress</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#F3F4F6',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
    marginBottom: -StyleSheet.hairlineWidth,
  },
  rowIcon: {
    marginRight: 14,
  },
  rowContent: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 16,
    color: '#111827',
  },
  rowSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 1,
  },
  destructive: {
    color: '#EF4444',
    flex: 1,
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run all Jest tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass (or same pass count as before this task — no regressions).

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/settings.tsx"
git commit -m "feat: complete Phase 9 Settings UI — URL, provider, version, reset SRS"
```

---

## Task 8: Mark Phase 9 complete in roadmap

**Files:**
- Modify: `specs/roadmap.md`

- [ ] **Step 1: Update roadmap**

In `specs/roadmap.md`, change the Phase 9 heading from:

```
## Phase 9 — Settings (Day 10–11)
```

to:

```
## Phase 9 — Settings ✅ (2026-05-02)
```

- [ ] **Step 2: Commit**

```bash
git add -f specs/roadmap.md
git commit -m "docs: mark Phase 9 Settings as complete"
```
