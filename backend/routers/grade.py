import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from providers.base import GradeResult
from providers.chain import ProviderChain, ExtractionFailedError

logger = logging.getLogger(__name__)
router = APIRouter()

_chain: ProviderChain | None = None

_MIN_ANSWER_WORDS = 2


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
    # Short-circuit: fewer than 2 words → no answer provided
    if len(request.user_answer.strip().split()) < _MIN_ANSWER_WORDS:
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
