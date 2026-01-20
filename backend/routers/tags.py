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
