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
