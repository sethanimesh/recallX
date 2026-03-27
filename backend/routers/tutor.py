import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from providers.base import TutorChatResponse
from providers.chain import ProviderChain, ExtractionFailedError

import io
import edge_tts
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)
router = APIRouter()

_chain: ProviderChain | None = None


def get_chain() -> ProviderChain:
    global _chain
    if _chain is None:
        _chain = ProviderChain()
    return _chain


import base64

class ChatMessage(BaseModel):
    role: str
    content: str


class TutorChatRequest(BaseModel):
    word: str
    stored_definition: str
    stored_example: str
    user_answer: str
    history: list[ChatMessage]
    is_retry: bool = False


class SpeakRequest(BaseModel):
    text: str
    voice: str = "en-US-AvaNeural"


class TutorChatAndSpeakResponse(BaseModel):
    response: str
    evaluation: str
    hint_provided: bool
    audio_b64: str


@router.post("/tutor/chat_and_speak", response_model=TutorChatAndSpeakResponse)
async def tutor_chat_and_speak(request: TutorChatRequest) -> TutorChatAndSpeakResponse:
    try:
        # 1. Get the LLM tutor response
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
        tutor_res = await get_chain().tutor_chat(
            word=request.word,
            stored_definition=request.stored_definition,
            stored_example=request.stored_example,
            user_answer=request.user_answer,
            history=history_dicts,
            is_retry=request.is_retry,
        )
        
        # 2. Synthesize to audio bytes using edge-tts
        communicate = edge_tts.Communicate(tutor_res.response, "en-US-AvaNeural")
        audio_data = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.write(chunk["data"])
        
        # 3. Base64 encode the audio bytes
        audio_bytes = audio_data.getvalue()
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        
        return TutorChatAndSpeakResponse(
            response=tutor_res.response,
            evaluation=tutor_res.evaluation,
            hint_provided=tutor_res.hint_provided,
            audio_b64=audio_b64,
        )
    except ExtractionFailedError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "All providers failed", "failures": e.failures},
        )
    except Exception as e:
        logger.error("Combined tutor chat and speak failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Tutor chat and speak failed: {str(e)}",
        )


@router.post("/tutor/chat", response_model=TutorChatResponse)
async def tutor_chat(request: TutorChatRequest) -> TutorChatResponse:
    try:
        # Convert ChatMessage pydantic objects to dicts for chain.py
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
        
        return await get_chain().tutor_chat(
            word=request.word,
            stored_definition=request.stored_definition,
            stored_example=request.stored_example,
            user_answer=request.user_answer,
            history=history_dicts,
            is_retry=request.is_retry,
        )
    except ExtractionFailedError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "All providers failed", "failures": e.failures},
        )


@router.get("/tutor/speak")
async def tutor_speak(text: str, voice: str = "en-US-AvaNeural") -> StreamingResponse:
    if not text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
    
    try:
        communicate = edge_tts.Communicate(text, voice)
        audio_data = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.write(chunk["data"])
        
        audio_data.seek(0)
        return StreamingResponse(audio_data, media_type="audio/mpeg")
    except Exception as e:
        logger.error("TTS generation failed: %s", e)
        raise HTTPException(status_code=500, detail=f"TTS failed: {str(e)}")
