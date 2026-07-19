import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from providers.base import StoryResponse
from providers.chain import ProviderChain, ExtractionFailedError

logger = logging.getLogger(__name__)
router = APIRouter()

_chain: ProviderChain | None = None

def get_chain() -> ProviderChain:
    global _chain
    if _chain is None:
        _chain = ProviderChain()
    return _chain

class WordItem(BaseModel):
    word: str
    definition: str

class GenerateStoryRequest(BaseModel):
    words: list[WordItem]
    custom_prompt: str = ""

@router.post("/story/generate", response_model=StoryResponse)
async def generate_story_endpoint(request: GenerateStoryRequest) -> StoryResponse:
    if not request.words:
        raise HTTPException(status_code=400, detail="No words provided for story generation")

    try:
        words_dicts = [{"word": w.word, "definition": w.definition} for w in request.words]
        response = await get_chain().generate_story(
            words=words_dicts,
            custom_prompt=request.custom_prompt,
        )
        return response
    except ExtractionFailedError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "All providers failed", "failures": e.failures},
        )
    except Exception as e:
        logger.error("Story generation failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Story generation failed: {str(e)}",
        )

import sqlite3
import time
from typing import Optional
import database

class SavedStory(BaseModel):
    id: str
    tag_id: Optional[str] = None
    prompt: Optional[str] = None
    title: str
    content: str
    created_at: int

@router.get("/story", response_model=list[SavedStory])
def get_stories(tag_id: Optional[str] = None):
    try:
        with database.connect() as conn:
            conn.row_factory = sqlite3.Row
            if tag_id:
                if tag_id == "null":
                    rows = conn.execute("SELECT * FROM stories WHERE tag_id IS NULL ORDER BY created_at DESC").fetchall()
                else:
                    rows = conn.execute("SELECT * FROM stories WHERE tag_id = ? ORDER BY created_at DESC", (tag_id,)).fetchall()
            else:
                rows = conn.execute("SELECT * FROM stories ORDER BY created_at DESC").fetchall()
            
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error("Failed to fetch stories: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch stories")

@router.get("/story/{story_id}", response_model=SavedStory)
def get_story(story_id: str):
    try:
        with database.connect() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM stories WHERE id = ?", (story_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Story not found")
            return dict(row)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to fetch story: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch story")

@router.post("/story", response_model=SavedStory)
def save_story(story: SavedStory):
    try:
        with database.connect() as conn:
            conn.execute(
                "INSERT INTO stories (id, tag_id, prompt, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (story.id, story.tag_id, story.prompt, story.title, story.content, story.created_at)
            )
            conn.commit()
            return story
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Story already exists")
    except Exception as e:
        logger.error("Failed to save story: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save story")

@router.delete("/story/{story_id}")
def delete_story(story_id: str):
    try:
        with database.connect() as conn:
            conn.execute("DELETE FROM stories WHERE id = ?", (story_id,))
            conn.commit()
            return {"status": "ok"}
    except Exception as e:
        logger.error("Failed to delete story: %s", e)
        raise HTTPException(status_code=500, detail="Failed to delete story")
