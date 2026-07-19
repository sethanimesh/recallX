import sqlite3
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

import database
from services.library_operations import LibraryOperation

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


class MergeTagRequest(BaseModel):
    target_tag_id: str


@router.post("/tags", response_model=TagRecord, status_code=201)
def create_tag(req: CreateTagRequest, request: Request, operation_id: UUID | None = Header(default=None, alias='X-Operation-ID')):
    operation = LibraryOperation(request, operation_id, req.model_dump(mode='json'))
    try:
        with database.connect(immediate=True) as conn:
            found, result = operation.lookup(conn)
            if found:
                return result
            conn.execute("INSERT INTO tags (id, name) VALUES (?, ?)", (req.id, req.name))
            return operation.remember(conn, TagRecord(id=req.id, name=req.name))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Tag name already exists")


@router.get("/tags", response_model=list[TagRecord])
def get_tags() -> list[TagRecord]:
    with database.connect() as conn:
        tags = conn.execute("SELECT id, name FROM tags ORDER BY name").fetchall()
        counts_raw = conn.execute(
            "SELECT wt.tag_id, COUNT(*) FROM word_tags wt "
            "JOIN words w ON w.id = wt.word_id WHERE w.deleted_at IS NULL GROUP BY wt.tag_id"
        ).fetchall()
    counts = {row[0]: row[1] for row in counts_raw}
    return [TagRecord(id=t[0], name=t[1], word_count=counts.get(t[0], 0)) for t in tags]


@router.patch("/tags/{tag_id}", response_model=TagRecord)
def update_tag(tag_id: str, req: UpdateTagRequest, request: Request, operation_id: UUID | None = Header(default=None, alias='X-Operation-ID')):
    operation = LibraryOperation(request, operation_id, req.model_dump(mode='json'))
    with database.connect(immediate=True) as conn:
        found, result = operation.lookup(conn)
        if found:
            return result
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
        count = conn.execute('SELECT COUNT(*) FROM word_tags wt JOIN words w ON w.id=wt.word_id WHERE wt.tag_id=? AND w.deleted_at IS NULL', (tag_id,)).fetchone()[0]
        return operation.remember(conn, TagRecord(id=tag_id, name=req.name, word_count=count))


@router.post("/tags/{source_tag_id}/merge", response_model=TagRecord)
def merge_tag(source_tag_id: str, req: MergeTagRequest, request: Request, operation_id: UUID | None = Header(default=None, alias='X-Operation-ID')):
    operation = LibraryOperation(request, operation_id, req.model_dump(mode='json'))
    with database.connect(immediate=True) as conn:
        found, result = operation.lookup(conn)
        if found:
            return result
        if source_tag_id == req.target_tag_id:
            raise HTTPException(status_code=400, detail="Cannot merge a tag into itself")
        source = conn.execute("SELECT id FROM tags WHERE id = ?", (source_tag_id,)).fetchone()
        target = conn.execute(
            "SELECT id, name FROM tags WHERE id = ?",
            (req.target_tag_id,),
        ).fetchone()
        if not source or not target:
            raise HTTPException(status_code=404, detail="Tag not found")

        conn.execute(
            "INSERT OR IGNORE INTO word_tags (word_id, tag_id) "
            "SELECT word_id, ? FROM word_tags WHERE tag_id = ?",
            (req.target_tag_id, source_tag_id),
        )
        conn.execute("DELETE FROM word_tags WHERE tag_id = ?", (source_tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (source_tag_id,))
        count = conn.execute(
            "SELECT COUNT(*) FROM word_tags wt "
            "JOIN words w ON w.id = wt.word_id "
            "WHERE wt.tag_id = ? AND w.deleted_at IS NULL",
            (req.target_tag_id,),
        ).fetchone()[0]
        return operation.remember(conn, TagRecord(id=target[0], name=target[1], word_count=count))


@router.delete("/tags/{tag_id}", status_code=204)
def delete_tag(tag_id: str, request: Request, operation_id: UUID | None = Header(default=None, alias='X-Operation-ID')) -> None:
    operation = LibraryOperation(request, operation_id)
    with database.connect(immediate=True) as conn:
        found, _ = operation.lookup(conn)
        if found:
            return None
        conn.execute("DELETE FROM word_tags WHERE tag_id = ?", (tag_id,))
        cursor = conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Tag not found")
        operation.remember(conn, None)


@router.post("/words/{word_id}/tags/{tag_id}", status_code=204)
def add_tag_to_word(word_id: str, tag_id: str, request: Request, operation_id: UUID | None = Header(default=None, alias='X-Operation-ID')) -> None:
    operation = LibraryOperation(request, operation_id)
    with database.connect(immediate=True) as conn:
        found, _ = operation.lookup(conn)
        if found:
            return None
        if not conn.execute('SELECT 1 FROM words WHERE id=? AND deleted_at IS NULL', (word_id,)).fetchone() or not conn.execute('SELECT 1 FROM tags WHERE id=?', (tag_id,)).fetchone():
            raise HTTPException(404, 'Word or tag not found')
        conn.execute(
            "INSERT OR IGNORE INTO word_tags (word_id, tag_id) VALUES (?, ?)",
            (word_id, tag_id),
        )
        operation.remember(conn, None)


@router.delete("/words/{word_id}/tags/{tag_id}", status_code=204)
def remove_tag_from_word(word_id: str, tag_id: str, request: Request, operation_id: UUID | None = Header(default=None, alias='X-Operation-ID')) -> None:
    operation = LibraryOperation(request, operation_id)
    with database.connect(immediate=True) as conn:
        found, _ = operation.lookup(conn)
        if found:
            return None
        conn.execute(
            "DELETE FROM word_tags WHERE word_id = ? AND tag_id = ?",
            (word_id, tag_id),
        )
        operation.remember(conn, None)
