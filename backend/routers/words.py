import sqlite3
import time
from typing import Optional
import string

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import database

router = APIRouter()


def _normalize_stored_word(word: str) -> str:
    return string.capwords(word.strip())


class TagInfo(BaseModel):
    id: str
    name: str


class WordRecord(BaseModel):
    id: str
    word: str
    definition: str
    example_sentence: str
    mnemonic: Optional[str] = None
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
    mnemonic: Optional[str] = None
    source_type: Optional[str] = None
    created_at: int
    updated_at: int


class UpdateWordRequest(BaseModel):
    word: Optional[str] = None
    definition: Optional[str] = None
    example_sentence: Optional[str] = None
    mnemonic: Optional[str] = None


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
        mnemonic=row[4], source_type=row[5], created_at=row[6], updated_at=row[7],
        deleted_at=row[8], tags=tags,
    )


@router.post("/words", response_model=WordRecord, status_code=201)
def create_word(req: CreateWordRequest) -> WordRecord:
    normalized_word = _normalize_stored_word(req.word)
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        try:
            conn.execute(
                "INSERT INTO words (id, word, definition, example_sentence, mnemonic, source_type, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (req.id, normalized_word, req.definition, req.example_sentence, req.mnemonic,
                 req.source_type, req.created_at, req.updated_at),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # Check if a deleted version exists — if so, hard-delete it and retry
            deleted_row = conn.execute(
                "SELECT id FROM words WHERE word = ? COLLATE NOCASE AND deleted_at IS NOT NULL",
                (normalized_word,)
            ).fetchone()
            if deleted_row:
                # Hard-delete the old soft-deleted row and its tags
                conn.execute("DELETE FROM word_tags WHERE word_id = ?", (deleted_row[0],))
                conn.execute("DELETE FROM words WHERE id = ?", (deleted_row[0],))
                conn.commit()
                # Now insert the new word with the new req.id
                conn.execute(
                    "INSERT INTO words (id, word, definition, example_sentence, mnemonic, source_type, "
                    "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (req.id, normalized_word, req.definition, req.example_sentence, req.mnemonic,
                     req.source_type, req.created_at, req.updated_at),
                )
                conn.commit()
            else:
                # Active version exists — can't re-add
                existing = conn.execute(
                    "SELECT id FROM words WHERE word = ? COLLATE NOCASE AND deleted_at IS NULL",
                    (normalized_word,)
                ).fetchone()
                raise HTTPException(
                    status_code=409,
                    detail={"message": "Word already exists", "word_id": existing[0] if existing else None}
                )
    return WordRecord(
        id=req.id, word=normalized_word, definition=req.definition,
        example_sentence=req.example_sentence, mnemonic=req.mnemonic, source_type=req.source_type,
        created_at=req.created_at, updated_at=req.updated_at,
    )


@router.get("/words", response_model=list[WordRecord])
def get_words() -> list[WordRecord]:
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, word, definition, example_sentence, mnemonic, source_type, "
            "created_at, updated_at, deleted_at FROM words WHERE deleted_at IS NULL ORDER BY word"
        ).fetchall()
        if not rows:
            return []
        word_ids = [r[0] for r in rows]
        tags_by_word = _get_tags_for_words(conn, word_ids)
    return [_row_to_record(r, tags_by_word.get(r[0], [])) for r in rows]


@router.patch("/words/{word_id}", response_model=WordRecord)
def update_word(word_id: str, req: UpdateWordRequest) -> WordRecord:
    now_ms = int(time.time() * 1000)
    updates: list[str] = ["updated_at = ?"]
    params: list = [now_ms]
    if req.word is not None:
        normalized = _normalize_stored_word(req.word)
        updates.append("word = ?")
        params.append(normalized)
    if req.definition is not None:
        updates.append("definition = ?")
        params.append(req.definition)
    if req.example_sentence is not None:
        updates.append("example_sentence = ?")
        params.append(req.example_sentence)
    if req.mnemonic is not None:
        updates.append("mnemonic = ?")
        params.append(req.mnemonic)
    params.append(word_id)
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        try:
            cursor = conn.execute(
                f"UPDATE words SET {', '.join(updates)} WHERE id = ? AND deleted_at IS NULL",
                params,
            )
            conn.commit()
        except sqlite3.IntegrityError:
            if req.word is not None:
                normalized = _normalize_stored_word(req.word)
                # Check if a deleted version of the target word exists
                deleted_row = conn.execute(
                    "SELECT id FROM words WHERE word = ? COLLATE NOCASE AND deleted_at IS NOT NULL",
                    (normalized,)
                ).fetchone()
                if deleted_row:
                    # Hard-delete the old soft-deleted row and its tags
                    conn.execute("DELETE FROM word_tags WHERE word_id = ?", (deleted_row[0],))
                    conn.execute("DELETE FROM words WHERE id = ?", (deleted_row[0],))
                    conn.commit()
                    # Retry the update
                    try:
                        cursor = conn.execute(
                            f"UPDATE words SET {', '.join(updates)} WHERE id = ? AND deleted_at IS NULL",
                            params,
                        )
                        conn.commit()
                    except sqlite3.IntegrityError:
                        raise HTTPException(status_code=409, detail="Word already exists")
                else:
                    raise HTTPException(status_code=409, detail="Word already exists")
            else:
                raise HTTPException(status_code=409, detail="Word already exists")

        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Word not found")
        row = conn.execute(
            "SELECT id, word, definition, example_sentence, mnemonic, source_type, "
            "created_at, updated_at, deleted_at FROM words WHERE id = ?",
            (word_id,),
        ).fetchone()
        tags_by_word = _get_tags_for_words(conn, [word_id])
    return _row_to_record(row, tags_by_word.get(word_id, []))


@router.delete("/words/{word_id}", response_model=WordRecord)
def delete_word(word_id: str) -> WordRecord:
    now_ms = int(time.time() * 1000)
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        cursor = conn.execute(
            "UPDATE words SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
            (now_ms, word_id),
        )
        conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Word not found")
        row = conn.execute(
            "SELECT id, word, definition, example_sentence, mnemonic, source_type, "
            "created_at, updated_at, deleted_at FROM words WHERE id = ?",
            (word_id,),
        ).fetchone()
        tags_by_word = _get_tags_for_words(conn, [word_id])
    return _row_to_record(row, tags_by_word.get(word_id, []))
