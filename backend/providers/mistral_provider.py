import logging
from openai import AsyncOpenAI, RateLimitError  # noqa: F401 — re-exported for callers
from providers.base import LLMProvider, ExtractionRequest, ExtractedWord
from providers._parse import parse_llm_response
from providers._prompts import IMAGE_SYSTEM_PROMPT, IMAGE_USER_PROMPT, TEXT_SYSTEM_PROMPT
from config import get_provider_config

logger = logging.getLogger(__name__)


class MistralProvider:
    name = "mistral"
    priority = 5
    supports_vision = True

    def __init__(self) -> None:
        cfg = get_provider_config("mistral")
        self._api_key: str | None = cfg.get("api_key")
        self._vision_model: str = cfg["vision_model"]
        self._text_model: str = cfg["text_model"]
        self._client = AsyncOpenAI(
            api_key=self._api_key or "missing",
            base_url=cfg["base_url"],
        )

    async def extract_words(self, req: ExtractionRequest) -> list[ExtractedWord]:
        if not self._api_key:
            raise ValueError("MISTRAL_API_KEY not set")
        if req.input_type == "image":
            model = self._vision_model
            messages = [
                {"role": "system", "content": IMAGE_SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{req.mime_type};base64,{req.content}"}},
                    {"type": "text", "text": IMAGE_USER_PROMPT},
                ]},
            ]
        else:
            model = self._text_model
            messages = [
                {"role": "system", "content": TEXT_SYSTEM_PROMPT},
                {"role": "user", "content": req.content},
            ]
        response = await self._client.chat.completions.create(
            model=model, messages=messages, temperature=0.1
        )
        return parse_llm_response(response.choices[0].message.content or "")
