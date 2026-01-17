# Phase 6b — Server Word Store: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the FastAPI backend the single source of truth for all words and tags; the app syncs on launch and writes to the server before mirroring locally in SQLite.

**Architecture:** Write-through cache. All mutations (add, edit, delete, tag) call the server first; on success the result is mirrored to local SQLite. Reads are always local (library, recall). On app start, `syncFromServer()` does a full-replace of local words/tags/word_tags from the server. Server unreachable during mutation → fail with alert. Server unreachable at launch → show dismissable banner, proceed with stale local data.

**Tech Stack:** FastAPI + Python sqlite3 (backend); Drizzle ORM + expo-sqlite (client cache); expo-crypto UUIDs; TypeScript strict; Jest + pytest.

---

## File Structure

**Backend — new:**
- `backend/routers/words.py` — POST/GET/PATCH/DELETE /words
- `backend/routers/tags.py` — POST/GET/PATCH/DELETE /tags + /words/{id}/tags/{tag_id}
- `backend/tests/test_words_router.py` — words router tests (TestClient)
- `backend/tests/test_tags_router.py` — tags router tests (TestClient)

**Backend — modified:**
- `backend/database.py` — expand `init_db()` to full schema; remove `insert_word()`
- `backend/main.py` — include words + tags routers
- `backend/routers/extract.py` — remove `_attach_duplicates`; return `list[ExtractedWord]`
- `backend/tests/test_database.py` — replace `insert_word` tests with new schema tests
- `backend/tests/test_extract_endpoint.py` — remove `duplicate` field assertions

**Client — new:**
- `src/api/wordServerClient.ts` — typed HTTP client; `WordServerError`; one fn per endpoint
- `src/api/syncClient.ts` — `fetchWordsFromServer()`, `fetchTagsFromServer()`
- `src/db/operations/sync.ts` — `syncFromServer()` — fetch + full-replace local tables
- `src/api/__tests__/wordServerClient.test.ts`
- `src/db/operations/__tests__/sync.test.ts`

**Client — modified:**
- `src/db/operations/insertExtraction.ts` — replace local `isDuplicateWord` check with POST /words 409
- `src/db/operations/insertManualWord.ts` — POST /words before local insert
- `src/db/operations/wordDetail.ts` — `updateWordField` / `softDeleteWord` → server first
- `src/db/operations/tags.ts` — `createOrGetTag`, `addTagToWord`, `removeTagFromWord`, `renameTag`, `deleteTag` → server first
- `app/_layout.tsx` — `syncFromServer()` after `runMigrations()`; loading + error banner

---

## Task 1: Expand backend/database.py — new full schema

**Files:**
- Modify: `backend/database.py`
- Modify: `backend/tests/test_database.py`

The current `words` table has one column (`word TEXT PRIMARY KEY COLLATE NOCASE`). We replace it with the full schema (`id`, `word`, `definition`, `example_sentence`, `source_type`, `created_at`, `updated_at`, `deleted_at`), add `tags` and `word_tags` tables, and auto-migrate the old schema on startup.

- [ ] **Step 1: Write new tests for the expanded schema**

Replace `backend/tests/test_database.py` entirely:

```python
"""Tests for database.py — expanded schema."""
import sqlite3
import database


def _fresh(tmp_path) -> str:
    path = str(tmp_path / "test.sqlite")
    database.init_db(db_path=path)
    return path


def test_init_db_creates_words_table(tmp_path):
    path = _fresh(tmp_path)
    with sqlite3.connect(path) as conn:
        info = conn.execute("PRAGMA table_info(words)").fetchall()
    col_names = {row[1] for row in info}
    assert col_names >= {"id", "word", "definition", "example_sentence",
                         "source_type", "created_at", "updated_at", "deleted_at"}


def test_init_db_creates_tags_table(tmp_path):
    path = _fresh(tmp_path)
    with sqlite3.connect(path) as conn:
        info = conn.execute("PRAGMA table_info(tags)").fetchall()
    col_names = {row[1] for row in info}
    assert col_names >= {"id", "name"}


def test_init_db_creates_word_tags_table(tmp_path):
    path = _fresh(tmp_path)
    with sqlite3.connect(path) as conn:
        info = conn.execute("PRAGMA table_info(word_tags)").fetchall()
    col_names = {row[1] for row in info}
    assert col_names >= {"word_id", "tag_id"}


def test_init_db_is_idempotent(tmp_path):
    """Calling init_db twice must not raise."""
    path = _fresh(tmp_path)
    database.init_db(db_path=path)  # second call — must not raise


def test_init_db_migrates_old_schema(tmp_path):
    """A DB with the old single-column words table is upgraded automatically."""
    path = str(tmp_path / "old.sqlite")
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE words (word TEXT PRIMARY KEY COLLATE NOCASE)")
    database.init_db(db_path=path)
    with sqlite3.connect(path) as conn:
        info = conn.execute("PRAGMA table_info(words)").fetchall()
    col_names = {row[1] for row in info}
    assert "id" in col_names
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && source venv/bin/activate && pytest tests/test_database.py -v
```

Expected: 5 failures (functions not updated yet).

- [ ] **Step 3: Rewrite database.py**

```python
"""SQLite persistence layer for RecallX."""
import sqlite3
from pathlib import Path

_DEFAULT_DB_PATH = str(Path(__file__).parent / "db.sqlite")


def init_db(db_path: str = _DEFAULT_DB_PATH) -> None:
    with sqlite3.connect(db_path) as conn:
        # Migrate old single-column words table if present
        info = conn.execute("PRAGMA table_info(words)").fetchall()
        col_names = {row[1] for row in info}
        if info and "id" not in col_names:
            conn.execute("DROP TABLE IF EXISTS words")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS words (
                id               TEXT PRIMARY KEY,
                word             TEXT NOT NULL UNIQUE COLLATE NOCASE,
                definition       TEXT NOT NULL,
                example_sentence TEXT NOT NULL,
                source_type      TEXT,
                created_at       INTEGER NOT NULL,
                updated_at       INTEGER NOT NULL,
                deleted_at       INTEGER
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tags (
                id   TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS word_tags (
                word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
                tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
                PRIMARY KEY (word_id, tag_id)
            )
        """)
        conn.commit()
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pytest tests/test_database.py -v
```

Expected: 5 passing.

- [ ] **Step 5: Delete the existing backend/db.sqlite so the server starts fresh**

```bash
rm -f backend/db.sqlite
```

- [ ] **Step 6: Commit**

```bash
git add backend/database.py backend/tests/test_database.py
git commit -m "feat(backend): expand db schema — words full fields, tags, word_tags; auto-migrate old schema"
```

---

## Task 2: Create backend/routers/words.py

**Files:**
- Create: `backend/routers/words.py`
- Create: `backend/tests/test_words_router.py`

POST /words (201 or 409), GET /words (with tags), PATCH /words/{id} (200 or 404), DELETE /words/{id} (204 soft delete).

- [ ] **Step 1: Write the tests**

Create `backend/tests/test_words_router.py`:

```python
"""Tests for /words endpoints."""
import sqlite3
import pytest
from fastapi.testclient import TestClient
import database
from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    path = str(tmp_path / "test.sqlite")
    monkeypatch.setattr(database, "_DEFAULT_DB_PATH", path)
    database.init_db(db_path=path)


def _word_payload(**overrides):
    base = {
        "id": "w1",
        "word": "ephemeral",
        "definition": "Lasting for a very short time.",
        "example_sentence": "The joy was ephemeral.",
        "source_type": None,
        "created_at": 1713600000000,
        "updated_at": 1713600000000,
    }
    return {**base, **overrides}


# --- POST /words ---

def test_create_word_returns_201():
    resp = client.post("/words", json=_word_payload())
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == "w1"
    assert data["word"] == "ephemeral"
    assert data["tags"] == []


def test_create_word_duplicate_returns_409():
    client.post("/words", json=_word_payload())
    resp = client.post("/words", json=_word_payload(id="w2"))
    assert resp.status_code == 409


def test_create_word_duplicate_case_insensitive():
    client.post("/words", json=_word_payload(word="Ephemeral"))
    resp = client.post("/words", json=_word_payload(id="w2", word="ephemeral"))
    assert resp.status_code == 409


def test_create_word_stores_source_type():
    resp = client.post("/words", json=_word_payload(source_type="image"))
    assert resp.json()["source_type"] == "image"


# --- GET /words ---

def test_get_words_empty():
    resp = client.get("/words")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_words_returns_created_word():
    client.post("/words", json=_word_payload())
    resp = client.get("/words")
    assert len(resp.json()) == 1
    assert resp.json()[0]["word"] == "ephemeral"


def test_get_words_excludes_soft_deleted():
    client.post("/words", json=_word_payload())
    client.delete("/words/w1")
    resp = client.get("/words")
    assert resp.json() == []


# --- PATCH /words/{id} ---

def test_patch_word_updates_definition():
    client.post("/words", json=_word_payload())
    resp = client.patch("/words/w1", json={"definition": "Short-lived."})
    assert resp.status_code == 200
    assert resp.json()["definition"] == "Short-lived."


def test_patch_word_updates_example_sentence():
    client.post("/words", json=_word_payload())
    resp = client.patch("/words/w1", json={"example_sentence": "New example."})
    assert resp.status_code == 200
    assert resp.json()["example_sentence"] == "New example."


def test_patch_word_not_found_returns_404():
    resp = client.patch("/words/nonexistent", json={"definition": "x"})
    assert resp.status_code == 404


# --- DELETE /words/{id} ---

def test_delete_word_returns_204():
    client.post("/words", json=_word_payload())
    resp = client.delete("/words/w1")
    assert resp.status_code == 204


def test_delete_word_sets_deleted_at():
    client.post("/words", json=_word_payload())
    client.delete("/words/w1")
    resp = client.get("/words")
    assert resp.json() == []


def test_delete_word_not_found_returns_404():
    resp = client.delete("/words/nonexistent")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_words_router.py -v
```

Expected: failures (router not yet created).

- [ ] **Step 3: Create backend/routers/words.py**

```python
import sqlite3
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import database

router = APIRouter()


class TagInfo(BaseModel):
    id: str
    name: str


class WordRecord(BaseModel):
    id: str
    word: str
    definition: str
    example_sentence: str
    source_type: Optional[str] = None
    created_at: int
    updated_at: int
    deleted_at: Optional[int] = None
    tags: list[TagInfo] = []


class CreateWordRequest(BaseModel):
    id: str
    word: str
    definition: str
    example_sentence: str
    source_type: Optional[str] = None
    created_at: int
    updated_at: int


class UpdateWordRequest(BaseModel):
    definition: Optional[str] = None
    example_sentence: Optional[str] = None


def _get_tags_for_words(conn: sqlite3.Connection, word_ids: list[str]) -> dict[str, list[TagInfo]]:
    if not word_ids:
        return {}
    placeholders = ",".join("?" * len(word_ids))
    rows = conn.execute(
        f"SELECT wt.word_id, t.id, t.name FROM word_tags wt "
        f"JOIN tags t ON t.id = wt.tag_id WHERE wt.word_id IN ({placeholders})",
        word_ids,
    ).fetchall()
    result: dict[str, list[TagInfo]] = {}
    for word_id, tag_id, tag_name in rows:
        result.setdefault(word_id, []).append(TagInfo(id=tag_id, name=tag_name))
    return result


def _row_to_record(row: tuple, tags: list[TagInfo]) -> WordRecord:
    return WordRecord(
        id=row[0], word=row[1], definition=row[2], example_sentence=row[3],
        source_type=row[4], created_at=row[5], updated_at=row[6],
        deleted_at=row[7], tags=tags,
    )


@router.post("/words", response_model=WordRecord, status_code=201)
def create_word(req: CreateWordRequest) -> WordRecord:
    try:
        with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
            conn.execute(
                "INSERT INTO words (id, word, definition, example_sentence, source_type, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (req.id, req.word, req.definition, req.example_sentence,
                 req.source_type, req.created_at, req.updated_at),
            )
            conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Word already exists")
    return WordRecord(
        id=req.id, word=req.word, definition=req.definition,
        example_sentence=req.example_sentence, source_type=req.source_type,
        created_at=req.created_at, updated_at=req.updated_at,
    )


@router.get("/words", response_model=list[WordRecord])
def get_words() -> list[WordRecord]:
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, word, definition, example_sentence, source_type, "
            "created_at, updated_at, deleted_at FROM words WHERE deleted_at IS NULL ORDER BY word"
        ).fetchall()
    if not rows:
        return []
    word_ids = [r[0] for r in rows]
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        tags_by_word = _get_tags_for_words(conn, word_ids)
    return [_row_to_record(r, tags_by_word.get(r[0], [])) for r in rows]


@router.patch("/words/{word_id}", response_model=WordRecord)
def update_word(word_id: str, req: UpdateWordRequest) -> WordRecord:
    now_ms = int(time.time() * 1000)
    updates: list[str] = ["updated_at = ?"]
    params: list = [now_ms]
    if req.definition is not None:
        updates.append("definition = ?")
        params.append(req.definition)
    if req.example_sentence is not None:
        updates.append("example_sentence = ?")
        params.append(req.example_sentence)
    params.append(word_id)
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        cursor = conn.execute(
            f"UPDATE words SET {', '.join(updates)} WHERE id = ? AND deleted_at IS NULL",
            params,
        )
        conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Word not found")
        row = conn.execute(
            "SELECT id, word, definition, example_sentence, source_type, "
            "created_at, updated_at, deleted_at FROM words WHERE id = ?",
            (word_id,),
        ).fetchone()
        tags_by_word = _get_tags_for_words(conn, [word_id])
    return _row_to_record(row, tags_by_word.get(word_id, []))


@router.delete("/words/{word_id}", status_code=204)
def delete_word(word_id: str) -> None:
    now_ms = int(time.time() * 1000)
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        cursor = conn.execute(
            "UPDATE words SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
            (now_ms, word_id),
        )
        conn.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Word not found")
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pytest tests/test_words_router.py -v
```

Expected: 14 passing.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/words.py backend/tests/test_words_router.py
git commit -m "feat(backend): POST/GET/PATCH/DELETE /words with tags support"
```

---

## Task 3: Create backend/routers/tags.py

**Files:**
- Create: `backend/routers/tags.py`
- Create: `backend/tests/test_tags_router.py`

POST/GET/PATCH/DELETE /tags and POST/DELETE /words/{id}/tags/{tag_id}.

- [ ] **Step 1: Write the tests**

Create `backend/tests/test_tags_router.py`:

```python
"""Tests for /tags endpoints."""
import sqlite3
import pytest
from fastapi.testclient import TestClient
import database
from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    path = str(tmp_path / "test.sqlite")
    monkeypatch.setattr(database, "_DEFAULT_DB_PATH", path)
    database.init_db(db_path=path)


def _create_word(word_id="w1", word="ephemeral"):
    client.post("/words", json={
        "id": word_id, "word": word, "definition": "def",
        "example_sentence": "ex", "created_at": 1000, "updated_at": 1000,
    })


# --- POST /tags ---

def test_create_tag_returns_201():
    resp = client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == "t1"
    assert data["name"] == "GRE Prep"


def test_create_tag_duplicate_name_returns_409():
    client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    resp = client.post("/tags", json={"id": "t2", "name": "gre prep"})
    assert resp.status_code == 409


# --- GET /tags ---

def test_get_tags_empty():
    resp = client.get("/tags")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_tags_returns_word_count():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    client.post("/words/w1/tags/t1")
    resp = client.get("/tags")
    assert resp.json()[0]["word_count"] == 1


def test_get_tags_word_count_zero_when_no_words():
    client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    resp = client.get("/tags")
    assert resp.json()[0]["word_count"] == 0


# --- PATCH /tags/{id} ---

def test_patch_tag_renames():
    client.post("/tags", json={"id": "t1", "name": "Old"})
    resp = client.patch("/tags/t1", json={"name": "New"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New"


def test_patch_tag_name_collision_returns_409():
    client.post("/tags", json={"id": "t1", "name": "Alpha"})
    client.post("/tags", json={"id": "t2", "name": "Beta"})
    resp = client.patch("/tags/t2", json={"name": "alpha"})
    assert resp.status_code == 409


def test_patch_tag_not_found_returns_404():
    resp = client.patch("/tags/nonexistent", json={"name": "x"})
    assert resp.status_code == 404


# --- DELETE /tags/{id} ---

def test_delete_tag_returns_204():
    client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    resp = client.delete("/tags/t1")
    assert resp.status_code == 204


def test_delete_tag_removes_from_get():
    client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    client.delete("/tags/t1")
    assert client.get("/tags").json() == []


# --- POST /words/{id}/tags/{tag_id} ---

def test_add_tag_to_word_returns_204():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE"})
    resp = client.post("/words/w1/tags/t1")
    assert resp.status_code == 204


def test_add_tag_to_word_is_idempotent():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE"})
    client.post("/words/w1/tags/t1")
    resp = client.post("/words/w1/tags/t1")
    assert resp.status_code == 204


def test_add_tag_shows_in_get_words():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE"})
    client.post("/words/w1/tags/t1")
    words = client.get("/words").json()
    assert words[0]["tags"][0]["name"] == "GRE"


# --- DELETE /words/{id}/tags/{tag_id} ---

def test_remove_tag_from_word_returns_204():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE"})
    client.post("/words/w1/tags/t1")
    resp = client.delete("/words/w1/tags/t1")
    assert resp.status_code == 204


def test_remove_tag_from_word_removes_association():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE"})
    client.post("/words/w1/tags/t1")
    client.delete("/words/w1/tags/t1")
    words = client.get("/words").json()
    assert words[0]["tags"] == []
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_tags_router.py -v
```

Expected: failures (router not yet created).

- [ ] **Step 3: Create backend/routers/tags.py**

```python
import sqlite3

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import database

router = APIRouter()


class TagRecord(BaseModel):
    id: str
    name: str
    word_count: int = 0


class CreateTagRequest(BaseModel):
    id: str
    name: str


class UpdateTagRequest(BaseModel):
    name: str


@router.post("/tags", response_model=TagRecord, status_code=201)
def create_tag(req: CreateTagRequest) -> TagRecord:
    try:
        with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
            conn.execute("INSERT INTO tags (id, name) VALUES (?, ?)", (req.id, req.name))
            conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Tag name already exists")
    return TagRecord(id=req.id, name=req.name)


@router.get("/tags", response_model=list[TagRecord])
def get_tags() -> list[TagRecord]:
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        tags = conn.execute("SELECT id, name FROM tags ORDER BY name").fetchall()
        counts_raw = conn.execute(
            "SELECT tag_id, COUNT(*) FROM word_tags GROUP BY tag_id"
        ).fetchall()
    counts = {row[0]: row[1] for row in counts_raw}
    return [TagRecord(id=t[0], name=t[1], word_count=counts.get(t[0], 0)) for t in tags]


@router.patch("/tags/{tag_id}", response_model=TagRecord)
def update_tag(tag_id: str, req: UpdateTagRequest) -> TagRecord:
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        existing = conn.execute("SELECT id FROM tags WHERE id = ?", (tag_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Tag not found")
        collision = conn.execute(
            "SELECT id FROM tags WHERE lower(name) = lower(?) AND id != ?",
            (req.name, tag_id),
        ).fetchone()
        if collision:
            raise HTTPException(status_code=409, detail="Tag name already exists")
        conn.execute("UPDATE tags SET name = ? WHERE id = ?", (req.name, tag_id))
        conn.commit()
    return TagRecord(id=tag_id, name=req.name)


@router.delete("/tags/{tag_id}", status_code=204)
def delete_tag(tag_id: str) -> None:
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        conn.execute("DELETE FROM word_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        conn.commit()


@router.post("/words/{word_id}/tags/{tag_id}", status_code=204)
def add_tag_to_word(word_id: str, tag_id: str) -> None:
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO word_tags (word_id, tag_id) VALUES (?, ?)",
            (word_id, tag_id),
        )
        conn.commit()


@router.delete("/words/{word_id}/tags/{tag_id}", status_code=204)
def remove_tag_from_word(word_id: str, tag_id: str) -> None:
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        conn.execute(
            "DELETE FROM word_tags WHERE word_id = ? AND tag_id = ?",
            (word_id, tag_id),
        )
        conn.commit()
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pytest tests/test_tags_router.py -v
```

Expected: 18 passing.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/tags.py backend/tests/test_tags_router.py
git commit -m "feat(backend): POST/GET/PATCH/DELETE /tags and word-tag association endpoints"
```

---

## Task 4: Update main.py + extract.py

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/routers/extract.py`
- Modify: `backend/tests/test_extract_endpoint.py`

Include the new routers. Remove `_attach_duplicates` from extract.py — duplicate detection now lives in POST /words. Change the extract response back to `list[ExtractedWord]`.

- [ ] **Step 1: Check test_extract_endpoint.py for duplicate field assertions**

```bash
grep -n "duplicate" backend/tests/test_extract_endpoint.py
```

Note which lines assert `duplicate: true/false` — those need to be removed.

- [ ] **Step 2: Update main.py**

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI

import database
from routers import extract, grade, words, tags


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    yield


app = FastAPI(title="RecallX API", version="0.0.1", lifespan=lifespan)
app.include_router(extract.router)
app.include_router(grade.router)
app.include_router(words.router)
app.include_router(tags.router)
```

- [ ] **Step 3: Update extract.py — remove _attach_duplicates**

```python
import logging
from io import BytesIO, StringIO

from fastapi import APIRouter, HTTPException, UploadFile, File

from providers.base import ExtractionRequest, ExtractedWord
from providers.chain import ProviderChain, ExtractionFailedError

logger = logging.getLogger(__name__)
router = APIRouter()
_chain: ProviderChain | None = None


def get_chain() -> ProviderChain:
    global _chain
    if _chain is None:
        _chain = ProviderChain()
    return _chain


@router.post("/extract", response_model=list[ExtractedWord])
async def extract_words(request: ExtractionRequest) -> list[ExtractedWord]:
    try:
        return await get_chain().extract(request)
    except ExtractionFailedError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "All providers failed", "failures": e.failures},
        )


@router.post("/extract/pdf", response_model=list[ExtractedWord])
async def extract_pdf(file: UploadFile = File(...)) -> list[ExtractedWord]:
    from pdfminer.high_level import extract_text_to_fp
    from pdfminer.layout import LAParams

    try:
        content = await file.read()
        output = StringIO()
        extract_text_to_fp(
            BytesIO(content), output, laparams=LAParams(), output_type="text", codec=None,
        )
        text = output.getvalue().strip()
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"PDF parsing failed: {e}")

    if not text:
        raise HTTPException(status_code=422, detail="No text extracted from PDF")

    req = ExtractionRequest(input_type="text", content=text)
    try:
        return await get_chain().extract(req)
    except ExtractionFailedError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "All providers failed", "failures": e.failures},
        )
```

- [ ] **Step 4: Remove duplicate field assertions from test_extract_endpoint.py**

Open `backend/tests/test_extract_endpoint.py` and remove any assertions checking `data[i]["duplicate"]`. Also remove any import of `ExtractedWordWithDuplicate`.

- [ ] **Step 5: Run full pytest suite — verify existing tests still pass**

```bash
pytest --tb=short -q
```

Expected: all prior passing tests still pass (confirm test_words_router + test_tags_router + test_grade + test_database all green; the 3 pre-existing failures in test_foundation.py and test_openai_adapters.py are unrelated and can be ignored).

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/routers/extract.py backend/tests/test_extract_endpoint.py
git commit -m "feat(backend): wire words+tags routers; remove duplicate detection from extract"
```

---

## Task 5: Create src/api/wordServerClient.ts

**Files:**
- Create: `src/api/wordServerClient.ts`
- Create: `src/api/__tests__/wordServerClient.test.ts`

Typed HTTP client. One function per endpoint. `WordServerError(message, statusCode)` on non-2xx.

- [ ] **Step 1: Write the tests**

Create `src/api/__tests__/wordServerClient.test.ts`:

```typescript
import {
  postWord,
  patchWord,
  deleteWord,
  postTag,
  patchTag,
  deleteTag,
  addTagToWord,
  removeTagFromWord,
  WordServerError,
} from '../wordServerClient';

const BASE = 'http://localhost:8000';

beforeEach(() => {
  global.fetch = jest.fn();
});

function mockResponse(status: number, body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('postWord', () => {
  it('calls POST /words with correct body', async () => {
    const record = { id: 'w1', word: 'ephemeral', definition: 'def',
      example_sentence: 'ex', source_type: null, created_at: 1000,
      updated_at: 1000, deleted_at: null, tags: [] };
    mockResponse(201, record);
    const result = await postWord(
      { id: 'w1', word: 'ephemeral', definition: 'def',
        example_sentence: 'ex', source_type: null, created_at: 1000, updated_at: 1000 },
      BASE,
    );
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words`, expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"word":"ephemeral"'),
    }));
    expect(result).toEqual(record);
  });

  it('throws WordServerError with status 409 on duplicate', async () => {
    mockResponse(409, { detail: 'Word already exists' });
    await expect(
      postWord({ id: 'w1', word: 'x', definition: 'd', example_sentence: 'e',
        source_type: null, created_at: 1000, updated_at: 1000 }, BASE),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('patchWord', () => {
  it('calls PATCH /words/{id}', async () => {
    mockResponse(200, { id: 'w1', word: 'ephemeral', definition: 'new def',
      example_sentence: 'ex', source_type: null, created_at: 1000,
      updated_at: 2000, deleted_at: null, tags: [] });
    await patchWord('w1', { definition: 'new def' }, BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words/w1`, expect.objectContaining({
      method: 'PATCH',
    }));
  });
});

describe('deleteWord', () => {
  it('calls DELETE /words/{id}', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204, json: async () => null });
    await deleteWord('w1', BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words/w1`, expect.objectContaining({
      method: 'DELETE',
    }));
  });
});

describe('postTag', () => {
  it('calls POST /tags', async () => {
    mockResponse(201, { id: 't1', name: 'GRE', word_count: 0 });
    await postTag({ id: 't1', name: 'GRE' }, BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/tags`, expect.objectContaining({
      method: 'POST',
    }));
  });
});

describe('addTagToWord', () => {
  it('calls POST /words/{id}/tags/{tag_id}', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204, json: async () => null });
    await addTagToWord('w1', 't1', BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words/w1/tags/t1`, expect.objectContaining({
      method: 'POST',
    }));
  });
});

describe('removeTagFromWord', () => {
  it('calls DELETE /words/{id}/tags/{tag_id}', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204, json: async () => null });
    await removeTagFromWord('w1', 't1', BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words/w1/tags/t1`, expect.objectContaining({
      method: 'DELETE',
    }));
  });
});

describe('WordServerError', () => {
  it('throws on non-2xx', async () => {
    mockResponse(503, { detail: 'unavailable' });
    await expect(postTag({ id: 't1', name: 'x' }, BASE)).rejects.toBeInstanceOf(WordServerError);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest src/api/__tests__/wordServerClient.test.ts --no-coverage
```

Expected: failures (module not yet created).

- [ ] **Step 3: Create src/api/wordServerClient.ts**

```typescript
const DEFAULT_BASE_URL = 'http://192.168.68.104:8000'; // matches http.ts

export interface ServerTagRecord {
  id: string;
  name: string;
  word_count?: number;
}

export interface ServerWordRecord {
  id: string;
  word: string;
  definition: string;
  example_sentence: string;
  source_type: 'image' | 'pdf' | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  tags: ServerTagRecord[];
}

export interface CreateWordPayload {
  id: string;
  word: string;
  definition: string;
  example_sentence: string;
  source_type: 'image' | 'pdf' | null;
  created_at: number;
  updated_at: number;
}

export class WordServerError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'WordServerError';
  }
}

async function request<T>(
  url: string,
  options: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? detail;
    } catch {}
    throw new WordServerError(`Request failed: ${detail}`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function postWord(payload: CreateWordPayload, baseUrl = DEFAULT_BASE_URL) {
  return request<ServerWordRecord>(`${baseUrl}/words`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getWords(baseUrl = DEFAULT_BASE_URL) {
  return request<ServerWordRecord[]>(`${baseUrl}/words`, { method: 'GET' });
}

export function patchWord(
  id: string,
  updates: { definition?: string; example_sentence?: string },
  baseUrl = DEFAULT_BASE_URL,
) {
  return request<ServerWordRecord>(`${baseUrl}/words/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export function deleteWord(id: string, baseUrl = DEFAULT_BASE_URL) {
  return request<void>(`${baseUrl}/words/${id}`, { method: 'DELETE' });
}

export function postTag(
  payload: { id: string; name: string },
  baseUrl = DEFAULT_BASE_URL,
) {
  return request<ServerTagRecord>(`${baseUrl}/tags`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getTags(baseUrl = DEFAULT_BASE_URL) {
  return request<ServerTagRecord[]>(`${baseUrl}/tags`, { method: 'GET' });
}

export function patchTag(
  id: string,
  payload: { name: string },
  baseUrl = DEFAULT_BASE_URL,
) {
  return request<ServerTagRecord>(`${baseUrl}/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteTag(id: string, baseUrl = DEFAULT_BASE_URL) {
  return request<void>(`${baseUrl}/tags/${id}`, { method: 'DELETE' });
}

export function addTagToWord(wordId: string, tagId: string, baseUrl = DEFAULT_BASE_URL) {
  return request<void>(`${baseUrl}/words/${wordId}/tags/${tagId}`, { method: 'POST' });
}

export function removeTagFromWord(wordId: string, tagId: string, baseUrl = DEFAULT_BASE_URL) {
  return request<void>(`${baseUrl}/words/${wordId}/tags/${tagId}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest src/api/__tests__/wordServerClient.test.ts --no-coverage
```

Expected: 9 passing.

- [ ] **Step 5: Check TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/api/wordServerClient.ts src/api/__tests__/wordServerClient.test.ts
git commit -m "feat(client): wordServerClient — typed HTTP client for all word/tag mutations"
```

---

## Task 6: Create syncClient.ts + sync.ts

**Files:**
- Create: `src/api/syncClient.ts`
- Create: `src/db/operations/sync.ts`
- Create: `src/db/operations/__tests__/sync.test.ts`

`syncFromServer()` fetches GET /words + GET /tags, then replaces all local words/tags/word_tags in a transaction. Sources table is left untouched.

- [ ] **Step 1: Write the tests**

Create `src/db/operations/__tests__/sync.test.ts`:

```typescript
import { syncFromServer } from '../sync';
import { fetchWordsFromServer, fetchTagsFromServer } from '@/src/api/syncClient';
import { db } from '@/src/db/client';

jest.mock('@/src/api/syncClient');
jest.mock('@/src/db/client', () => ({
  db: {
    delete: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn((fn) => fn({
      delete: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

const mockFetchWords = fetchWordsFromServer as jest.Mock;
const mockFetchTags = fetchTagsFromServer as jest.Mock;

describe('syncFromServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches words and tags from server', async () => {
    mockFetchWords.mockResolvedValue([]);
    mockFetchTags.mockResolvedValue([]);
    await syncFromServer();
    expect(mockFetchWords).toHaveBeenCalledTimes(1);
    expect(mockFetchTags).toHaveBeenCalledTimes(1);
  });

  it('resolves successfully with empty server data', async () => {
    mockFetchWords.mockResolvedValue([]);
    mockFetchTags.mockResolvedValue([]);
    await expect(syncFromServer()).resolves.not.toThrow();
  });

  it('throws if fetchWordsFromServer rejects', async () => {
    mockFetchWords.mockRejectedValue(new Error('network error'));
    mockFetchTags.mockResolvedValue([]);
    await expect(syncFromServer()).rejects.toThrow('network error');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest src/db/operations/__tests__/sync.test.ts --no-coverage
```

Expected: failures.

- [ ] **Step 3: Create src/api/syncClient.ts**

```typescript
import { getWords, getTags, type ServerWordRecord, type ServerTagRecord } from './wordServerClient';

export function fetchWordsFromServer(): Promise<ServerWordRecord[]> {
  return getWords();
}

export function fetchTagsFromServer(): Promise<ServerTagRecord[]> {
  return getTags();
}
```

- [ ] **Step 4: Create src/db/operations/sync.ts**

```typescript
import { db } from '@/src/db/client';
import { words, tags, wordTags } from '@/src/db/schema';
import { fetchWordsFromServer, fetchTagsFromServer } from '@/src/api/syncClient';
import type { ServerWordRecord } from '@/src/api/wordServerClient';

export async function syncFromServer(): Promise<void> {
  const [serverWords, serverTags] = await Promise.all([
    fetchWordsFromServer(),
    fetchTagsFromServer(),
  ]);

  await db.transaction(async (tx) => {
    // Clear local tables (order matters — word_tags first to avoid FK violation)
    await tx.delete(wordTags);
    await tx.delete(words);
    await tx.delete(tags);

    if (serverTags.length > 0) {
      await tx.insert(tags).values(
        serverTags.map((t) => ({ id: t.id, name: t.name })),
      );
    }

    const activeWords = serverWords.filter((w) => w.deleted_at === null);

    if (activeWords.length > 0) {
      await tx.insert(words).values(
        activeWords.map((w) => ({
          id: w.id,
          word: w.word,
          definition: w.definition,
          example_sentence: w.example_sentence,
          source_id: null,
          created_at: new Date(w.created_at),
          updated_at: new Date(w.updated_at),
          deleted_at: null,
        })),
      );
    }

    const wordTagPairs = activeWords.flatMap((w: ServerWordRecord) =>
      w.tags.map((t) => ({ word_id: w.id, tag_id: t.id })),
    );
    if (wordTagPairs.length > 0) {
      await tx.insert(wordTags).values(wordTagPairs);
    }
  });
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
npx jest src/db/operations/__tests__/sync.test.ts --no-coverage
```

Expected: 3 passing.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/api/syncClient.ts src/db/operations/sync.ts src/db/operations/__tests__/sync.test.ts
git commit -m "feat(client): syncClient + syncFromServer — full-replace local tables from server on launch"
```

---

## Task 7: Update insertExtraction.ts — server-first writes

**Files:**
- Modify: `src/db/operations/insertExtraction.ts`
- Modify: `app/__tests__/review.test.tsx` (update mock if needed)

Replace the local `isDuplicateWord()` check with a `postWord()` call. A 409 response means duplicate. Any other non-2xx throws and surfaces as an alert to the user.

- [ ] **Step 1: Read existing tests to understand what needs updating**

Open `app/__tests__/review.test.tsx` and note how `insertExtraction` is mocked — no changes needed to the mock shape (it still returns `{ insertedIds, duplicates }`).

- [ ] **Step 2: Update insertExtraction.ts**

```typescript
import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { sources, words as wordsTable } from '@/src/db/schema';
import type { ExtractedWord } from '@/src/api/types';
import { postWord, WordServerError } from '@/src/api/wordServerClient';

export async function insertExtraction(
  sourceUri: string,
  sourceType: 'image' | 'pdf',
  extractedWords: ExtractedWord[],
): Promise<{ insertedIds: string[]; duplicates: string[] }> {
  if (extractedWords.length === 0) return { insertedIds: [], duplicates: [] };

  const now = Date.now();
  const duplicates: string[] = [];
  const toInsert: Array<{ word: ExtractedWord; id: string }> = [];

  for (const w of extractedWords) {
    const id = Crypto.randomUUID();
    try {
      await postWord({
        id,
        word: w.word,
        definition: w.definition,
        example_sentence: w.example_sentence,
        source_type: sourceType,
        created_at: now,
        updated_at: now,
      });
      toInsert.push({ word: w, id });
    } catch (err) {
      if (err instanceof WordServerError && err.statusCode === 409) {
        duplicates.push(w.word);
      } else {
        throw err;
      }
    }
  }

  if (toInsert.length === 0) return { insertedIds: [], duplicates };

  const sourceId = Crypto.randomUUID();
  const nowDate = new Date(now);

  await db.transaction(async (tx) => {
    await tx.insert(sources).values({
      id: sourceId,
      type: sourceType,
      uri: sourceUri,
      created_at: nowDate,
    });
    await tx.insert(wordsTable).values(
      toInsert.map(({ word: w, id }) => ({
        id,
        word: w.word,
        definition: w.definition,
        example_sentence: w.example_sentence,
        source_id: sourceId,
        created_at: nowDate,
        updated_at: nowDate,
      })),
    );
  });

  return { insertedIds: toInsert.map((x) => x.id), duplicates };
}
```

Note: `isDuplicateWord` export is removed. Update its import in any file that uses it.

- [ ] **Step 3: Remove the re-export of isDuplicateWord from insertExtraction.ts**

The line `export { isDuplicateWord } from '@/src/db/operations/wordDetail';` is no longer needed. Delete it. Any file that imports `isDuplicateWord` should import directly from `wordDetail`.

- [ ] **Step 4: Run Jest to check nothing broke**

```bash
npx jest --no-coverage --testPathPattern="review|insertExtraction" 2>&1 | tail -20
```

Expected: all related tests pass (the mock in review.test.tsx does not call postWord — it mocks insertExtraction at the module level, so no change needed there).

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/db/operations/insertExtraction.ts
git commit -m "feat(client): insertExtraction — postWord per word; 409 = duplicate, server-first"
```

---

## Task 8: Update insertManualWord.ts — server-first write

**Files:**
- Modify: `src/db/operations/insertManualWord.ts`

Call `postWord()` before local insert. A 409 means the word already exists — re-throw so `add-word.tsx`'s existing error handler surfaces "Word already exists" to the user.

- [ ] **Step 1: Update insertManualWord.ts**

```typescript
import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { words } from '@/src/db/schema';
import { postWord } from '@/src/api/wordServerClient';

export async function insertManualWord(
  word: string,
  definition: string,
  exampleSentence: string,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = Date.now();
  const nowDate = new Date(now);

  // Throws WordServerError(409) if duplicate — caller surfaces as alert
  await postWord({
    id,
    word: word.trim(),
    definition: definition.trim(),
    example_sentence: exampleSentence.trim(),
    source_type: null,
    created_at: now,
    updated_at: now,
  });

  await db.insert(words).values({
    id,
    word: word.trim(),
    definition: definition.trim(),
    example_sentence: exampleSentence.trim(),
    source_id: null,
    created_at: nowDate,
    updated_at: nowDate,
  });
  return id;
}
```

`add-word.tsx` already has `catch (err) { Alert.alert('Error', err.message) }` so a `WordServerError` with message "Request failed: Word already exists" will surface correctly. No screen changes needed.

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/db/operations/insertManualWord.ts
git commit -m "feat(client): insertManualWord — postWord before local insert; 409 surfaced as alert"
```

---

## Task 9: Update wordDetail.ts — server-first edits and deletes

**Files:**
- Modify: `src/db/operations/wordDetail.ts`

`updateWordField` calls `patchWord()` first. `softDeleteWord` calls `deleteWord()` first. Both throw `WordServerError` on failure, which the caller (word detail screen) surfaces as an alert.

- [ ] **Step 1: Update wordDetail.ts**

Replace the `updateWordField` and `softDeleteWord` functions. Keep `isDuplicateWord`, `fetchWordWithSource`, and `fetchWordTags` unchanged.

```typescript
import { sql } from 'drizzle-orm';
import { db } from '@/src/db/client';
import { words, sources, tags, wordTags } from '@/src/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { patchWord, deleteWord } from '@/src/api/wordServerClient';

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
  definition: string;
  example_sentence: string;
  source_id: string | null;
  source?: { type: 'image' | 'pdf' | 'video'; uri: string; created_at: Date };
}

export async function fetchWordWithSource(id: string): Promise<WordWithSource | null> {
  const rows = await db.select().from(words).where(and(eq(words.id, id), isNull(words.deleted_at)));
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row.source_id) {
    return { id: row.id, word: row.word, definition: row.definition,
      example_sentence: row.example_sentence, source_id: null };
  }
  const sourceRows = await db.select().from(sources).where(eq(sources.id, row.source_id));
  const source = sourceRows[0];
  return {
    id: row.id, word: row.word, definition: row.definition,
    example_sentence: row.example_sentence, source_id: row.source_id,
    source: source ? { type: source.type, uri: source.uri, created_at: source.created_at } : undefined,
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
  field: 'definition' | 'example_sentence',
  value: string,
): Promise<void> {
  await patchWord(id, { [field]: value });
  const now = new Date();
  if (field === 'definition') {
    await db.update(words).set({ definition: value, updated_at: now }).where(eq(words.id, id));
  } else {
    await db.update(words).set({ example_sentence: value, updated_at: now }).where(eq(words.id, id));
  }
}

export async function softDeleteWord(id: string): Promise<void> {
  await deleteWord(id);
  await db.update(words).set({ deleted_at: new Date() }).where(eq(words.id, id));
}
```

- [ ] **Step 2: Run TypeScript check + Jest**

```bash
npx tsc --noEmit && npx jest --no-coverage --testPathPattern="wordDetail|words" 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add src/db/operations/wordDetail.ts
git commit -m "feat(client): updateWordField + softDeleteWord — patchWord/deleteWord server-first"
```

---

## Task 10: Update tags.ts — server-first mutations

**Files:**
- Modify: `src/db/operations/tags.ts`

`createOrGetTag`, `addTagToWord`, `removeTagFromWord`, `renameTag`, `deleteTag` all call server first. `getAllTags`, `getTagsForWord`, `fetchWordsByTag`, `fetchAllWords`, `getTagWordCounts` are read-only and unchanged.

- [ ] **Step 1: Update the mutation functions in tags.ts**

Replace only the mutation functions. Read functions (`getAllTags`, `getTagsForWord`, `fetchWordsByTag`, `fetchAllWords`, `getTagWordCounts`) are unchanged.

```typescript
import * as Crypto from 'expo-crypto';
import { db } from '@/src/db/client';
import { tags, wordTags, words } from '@/src/db/schema';
import { eq, and, ne, isNull, asc, sql } from 'drizzle-orm';
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
      id: words.id, word: words.word, definition: words.definition,
      example_sentence: words.example_sentence, source_id: words.source_id,
      created_at: words.created_at, updated_at: words.updated_at, deleted_at: words.deleted_at,
    })
    .from(words)
    .innerJoin(wordTags, eq(wordTags.word_id, words.id))
    .where(and(eq(wordTags.tag_id, tagId), isNull(words.deleted_at)))
    .orderBy(asc(words.word));
}

export async function fetchAllWords(): Promise<WordRow[]> {
  return db
    .select({
      id: words.id, word: words.word, definition: words.definition,
      example_sentence: words.example_sentence, source_id: words.source_id,
      created_at: words.created_at, updated_at: words.updated_at, deleted_at: words.deleted_at,
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
```

Note: `renameTag` no longer throws a JS Error on name collision — it lets the `WordServerError(409)` propagate. `manage-tags.tsx` already catches `err.message` and shows an Alert, so "Request failed: Tag name already exists" will be shown. If the existing wording must be preserved, wrap: `throw new Error(\`A tag named "${trimmed}" already exists\`)` after catching 409.

- [ ] **Step 2: Run TypeScript check + Jest**

```bash
npx tsc --noEmit && npx jest --no-coverage --testPathPattern="tags|manage" 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add src/db/operations/tags.ts
git commit -m "feat(client): tags mutations — postTag/patchTag/deleteTag/addTag/removeTag server-first"
```

---

## Task 11: Update app/_layout.tsx — sync on app start

**Files:**
- Modify: `app/_layout.tsx`

After `runMigrations()`, call `syncFromServer()`. Show a loading screen while syncing. If sync fails, show a dismissable banner and proceed with stale local data.

- [ ] **Step 1: Write the tests**

Create `app/__tests__/layout.test.tsx`:

```typescript
import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';

jest.mock('@/src/db/client', () => ({ runMigrations: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/src/db/operations/sync', () => ({ syncFromServer: jest.fn() }));
jest.mock('expo-router', () => ({
  Stack: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  'Stack.Screen': () => null,
}));
jest.mock('@react-navigation/native', () => ({
  DarkTheme: {},
  DefaultTheme: {},
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { runMigrations } from '@/src/db/client';
import { syncFromServer } from '@/src/db/operations/sync';
import RootLayout from '../_layout';

describe('RootLayout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls runMigrations and syncFromServer on mount', async () => {
    (syncFromServer as jest.Mock).mockResolvedValue(undefined);
    render(<RootLayout />);
    await waitFor(() => {
      expect(runMigrations).toHaveBeenCalled();
      expect(syncFromServer).toHaveBeenCalled();
    });
  });

  it('proceeds with stale data when sync fails', async () => {
    (syncFromServer as jest.Mock).mockRejectedValue(new Error('network'));
    const { getByText } = render(<RootLayout />);
    await waitFor(() => {
      expect(getByText(/Could not sync/i)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest app/__tests__/layout.test.tsx --no-coverage
```

Expected: failures.

- [ ] **Step 3: Update app/_layout.tsx**

```tsx
import 'react-native-reanimated';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useColorScheme, View, ActivityIndicator, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { runMigrations } from '@/src/db/client';
import { syncFromServer } from '@/src/db/operations/sync';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    async function init() {
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
      setReady(true);
    }
    init();
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {syncError && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Could not sync — showing cached data</Text>
          <TouchableOpacity onPress={() => setSyncError(false)}>
            <Text style={styles.bannerDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="ingest" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="add-word" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="review" options={{ headerShown: false }} />
        <Stack.Screen name="words/[id]" options={{ title: '', headerBackTitle: 'Library' }} />
        <Stack.Screen name="recall-setup" options={{ title: 'Start Review', headerShown: true }} />
        <Stack.Screen name="recall" options={{ title: 'Recall', headerShown: true }} />
        <Stack.Screen name="recall-summary" options={{ title: 'Session Complete', headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: {
    backgroundColor: '#FEF3C7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bannerText: { fontSize: 13, color: '#92400E', flex: 1 },
  bannerDismiss: { fontSize: 16, color: '#92400E', paddingLeft: 12 },
});
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest app/__tests__/layout.test.tsx --no-coverage
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add app/_layout.tsx app/__tests__/layout.test.tsx
git commit -m "feat(client): sync from server on app start; loading screen + stale-data banner"
```

---

## Task 12: Polish & Verification

**Files:**
- Modify: `specs/roadmap.md`

- [ ] **Step 1: TypeScript — full clean check**

```bash
npx tsc --noEmit 2>&1
```

Expected: zero errors. Fix any type errors before proceeding.

- [ ] **Step 2: Run full Jest suite**

```bash
npx jest --no-coverage 2>&1 | tail -20
```

Expected: ≥ 110 passing tests. The pre-existing `http.test` failure (hardcoded IP mismatch) is allowed. Note final counts.

- [ ] **Step 3: Run full pytest suite**

```bash
cd backend && source venv/bin/activate && pytest --tb=short -q 2>&1 | tail -20
```

Expected: ≥ 90 passing. The 3 pre-existing failures in `test_foundation.py` and `test_openai_adapters.py` are allowed.

- [ ] **Step 4: Start backend, verify new endpoints are reachable**

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0
```

In a second terminal:
```bash
curl -s -X POST http://localhost:8000/words \
  -H "Content-Type: application/json" \
  -d '{"id":"test-1","word":"serendipity","definition":"happy accident","example_sentence":"A serendipitous find.","created_at":1000,"updated_at":1000}' | python3 -m json.tool
```

Expected: `{"id":"test-1","word":"serendipity",...,"tags":[]}`.

```bash
curl -s http://localhost:8000/words | python3 -m json.tool
```

Expected: array with one word.

- [ ] **Step 5: Update specs/roadmap.md — add Phase 6b**

Add the following entry after the Phase 6 block (before Phase 7):

```markdown
## Phase 6b — Server Word Store ✅ (2026-04-20)
- Backend `db.sqlite` expanded to full schema: words (id, definition, source_type, timestamps), tags, word_tags
- New routers: `POST/GET/PATCH/DELETE /words`, `POST/GET/PATCH/DELETE /tags`, `POST/DELETE /words/{id}/tags/{tag_id}`
- Client write-through cache: all mutations call server first, mirror to local SQLite on success
- `syncFromServer()` on app launch: full-replace local words/tags/word_tags from server; loading screen during sync; stale-data banner on failure
- Duplicate detection moved from local `isDuplicateWord()` to server `POST /words` 409 response
- Single source of truth: vocabulary survives app reinstall

**Spec:** `specs/2026-04-20-phase-6b-server-word-store/`
```

- [ ] **Step 6: Final commit**

```bash
git add -f specs/roadmap.md
git commit -m "docs: mark Phase 6b complete in roadmap"
```

---

## Self-Review Checklist

- **Spec coverage:** All 13 endpoints from design.md are implemented in Tasks 2–3. All 7 client-file changes from design.md are covered in Tasks 7–11. Sync-on-start (`_layout.tsx`) is Task 11. ✓
- **No placeholders:** All task steps contain actual code, exact commands, and expected output. ✓  
- **Type consistency:** `ServerWordRecord`, `ServerTagRecord`, `CreateWordPayload`, `WordServerError` are defined in Task 5 and used by name in Tasks 6–10. `TagInfo` / `WordRecord` defined in Task 2 router; not referenced by client (client uses its own `ServerWordRecord`). ✓
- **Extract router cleanup:** Task 4 removes `_attach_duplicates` and `ExtractedWordWithDuplicate` — the old duplicate detection path is fully retired. ✓
- **Auto-migrate old DB schema:** Task 1 `init_db()` detects the old single-column `words` table and drops it. ✓
