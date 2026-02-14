import logging
from openai import AsyncOpenAI, RateLimitError  # noqa: F401 — re-exported for callers
from providers.base import LLMProvider, ExtractionRequest, ExtractedWord, ExtractionResult
from providers._prompts import IMAGE_SYSTEM_PROMPT, IMAGE_USER_PROMPT, TEXT_SYSTEM_PROMPT, WORD_LOOKUP_SYSTEM_PROMPT
from config import get_provider_config

logger = logging.getLogger(__name__)


def _strict_schema(schema: dict) -> dict:
    """Recursively add additionalProperties: false to all object nodes."""
    schema = dict(schema)
    if schema.get("type") == "object":
        schema["additionalProperties"] = False
    for key in ("properties", "$defs"):
        if key in schema:
            schema[key] = {k: _strict_schema(v) for k, v in schema[key].items()}
    if "items" in schema:
        schema["items"] = _strict_schema(schema["items"])
    return schema


_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "ExtractionResult",
        "schema": _strict_schema(ExtractionResult.model_json_schema()),
        "strict": True,
    },
}


class GroqProvider:
    name = "groq"
    priority = 1
    supports_vision = True

    def __init__(self) -> None:
        cfg = get_provider_config("groq")
        self._api_key: str | None = cfg.get("api_key")
        self._vision_model: str = cfg["vision_model"]
        self._text_model: str = cfg["text_model"]
        self._client = AsyncOpenAI(
            api_key=self._api_key or "missing",
            base_url=cfg["base_url"],
        )

    async def extract_words(self, req: ExtractionRequest) -> list[ExtractedWord]:
        if not self._api_key:
            raise ValueError("GROQ_API_KEY not set")
        if req.input_type == "image":
            model = self._vision_model
            messages = [
                {"role": "system", "content": IMAGE_SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{req.mime_type};base64,{req.content}"}},
                    {"type": "text", "text": IMAGE_USER_PROMPT},
                ]},
            ]
        elif req.input_type == "word":
            model = self._text_model
            messages = [
                {"role": "system", "content": WORD_LOOKUP_SYSTEM_PROMPT},
                {"role": "user", "content": req.content},
            ]
        else:
            model = self._text_model
            messages = [
                {"role": "system", "content": TEXT_SYSTEM_PROMPT},
                {"role": "user", "content": req.content},
            ]
        response = await self._client.chat.completions.create(
            model=model, messages=messages, temperature=0.1,
            response_format=_RESPONSE_FORMAT,
        )

        return ExtractionResult.model_validate_json(
            response.choices[0].message.content or "{}"
        ).words
