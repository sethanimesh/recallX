import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from providers.base import GradeResult
from providers.chain import ProviderChain, ExtractionFailedError

logger = logging.getLogger(__name__)
router = APIRouter()

_chain: ProviderChain | None = None

def get_chain() -> ProviderChain:
    global _chain
    if _chain is None:
        _chain = ProviderChain()
    return _chain


class GradeRequest(BaseModel):
    word: str
    user_answer: str
    stored_definition: str


@router.post("/grade", response_model=GradeResult)
async def grade_answer(request: GradeRequest) -> GradeResult:
    # Short-circuit only truly empty answers; short valid answers should reach the LLM.
    if request.user_answer.strip() == "":
        return GradeResult(correct=False, feedback="No answer provided.")

    try:
        return await get_chain().grade(
            word=request.word,
            user_answer=request.user_answer,
            stored_definition=request.stored_definition,
        )
    except ExtractionFailedError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "All providers failed", "failures": e.failures},
        )
