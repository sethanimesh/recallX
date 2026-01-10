import base64
import logging
from google import genai
from google.genai import types as genai_types
from providers.base import LLMProvider, ExtractionRequest, ExtractedWord
from providers._parse import parse_llm_response
from config import get_provider_config

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a vocabulary extraction assistant. Extract all notable English vocabulary words from the provided content.
For each word return a JSON array of objects with exactly these keys:
- "word": the vocabulary word (lowercase)
- "definition": a plain English definition in 1-2 sentences
- "example_sentence": one memorable example sentence using the word in context

Return ONLY valid JSON array, no markdown, no explanation. Example:
[{"word": "ephemeral", "definition": "Lasting for a very short time.", "example_sentence": "The ephemeral beauty of cherry blossoms draws thousands of visitors."}]"""


class GeminiProvider:
    name = "gemini"
    priority = 4
    supports_vision = True

    def __init__(self) -> None:
        cfg = get_provider_config("gemini")
        self._api_key: str | None = cfg.get("api_key")
        self._model: str = cfg.get("model", "gemini-2.0-flash")
        if self._api_key:
            self._client = genai.Client(api_key=self._api_key)
        else:
            self._client = None

    async def extract_words(self, req: ExtractionRequest) -> list[ExtractedWord]:
        if not self._api_key or not self._client:
            raise ValueError("GEMINI_API_KEY not set")
        if req.input_type == "image":
            image_bytes = base64.b64decode(req.content)
            part = genai_types.Part.from_bytes(data=image_bytes, mime_type=req.mime_type or "image/jpeg")
            contents = [
                genai_types.Content(role="user", parts=[
                    part,
                    genai_types.Part.from_text(text=f"{SYSTEM_PROMPT}\n\nExtract vocabulary words from this image."),
                ])
            ]
        else:
            contents = [
                genai_types.Content(role="user", parts=[
                    genai_types.Part.from_text(text=f"{SYSTEM_PROMPT}\n\n{req.content}"),
                ])
            ]
        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=contents,
        )
        return parse_llm_response(response.text or "")
