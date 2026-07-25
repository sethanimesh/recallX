"""Tutor practice uses the same assessment authority. Audio is optional enrichment."""
import asyncio
import base64
import io
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from assessment.contracts import AssessmentRequest, AssessmentResult, Decision
from assessment.service import assess

logger = logging.getLogger(__name__)
router = APIRouter()


class ChatMessage(BaseModel):
    role: Literal['user','assistant']
    content: str = Field(max_length=12000)


class TutorChatRequest(AssessmentRequest):
    history: list[ChatMessage] = Field(default_factory=list,max_length=30)
    is_retry: bool = False


class TutorResponse(BaseModel):
    assessment: AssessmentResult
    response: str
    evaluation: Decision
    hint_provided: bool = False
    audio_b64: str | None = None
    audio_error: str | None = None


async def practice(payload, request):
    # Client history never becomes grading evidence and cannot supply a reference.
    answer = AssessmentRequest.model_validate(payload.model_dump(exclude={'history','is_retry'}))
    assessment = await assess(answer,getattr(request.state,'learner_id','personal'),mode='tutor')
    return TutorResponse(assessment=assessment,response=assessment.feedback,evaluation=assessment.decision,
                         hint_provided=assessment.reason=='hint_request')


@router.post('/tutor/chat', response_model=TutorResponse)
async def tutor_chat(payload: TutorChatRequest, request: Request):
    return await practice(payload,request)


async def synthesize(text,voice='en-US-AvaNeural'):
    import edge_tts
    result = bytearray()
    async for chunk in edge_tts.Communicate(text,voice).stream():
        if chunk['type']=='audio':
            result.extend(chunk['data'])
    return bytes(result)


@router.post('/tutor/chat_and_speak', response_model=TutorResponse)
async def tutor_chat_and_speak(payload: TutorChatRequest, request: Request):
    response = await practice(payload,request)
    try:
        audio = await asyncio.wait_for(synthesize(response.response),timeout=20)
        response.audio_b64 = base64.b64encode(audio).decode('ascii')
    except Exception:
        # Assessment is already durable; speech failure cannot erase it or create a new attempt.
        response.audio_error = 'Speech is temporarily unavailable.'
        logger.info('Optional tutor speech unavailable')
    return response


@router.get('/tutor/speak')
async def tutor_speak(text: str, voice: str='en-US-AvaNeural'):
    if not text.strip() or len(text)>4000:
        raise HTTPException(400,'Speech text must contain 1–4000 characters')
    try:
        data = await asyncio.wait_for(synthesize(text,voice),timeout=20)
        return StreamingResponse(io.BytesIO(data),media_type='audio/mpeg')
    except Exception:
        raise HTTPException(503,'Speech is temporarily unavailable')
