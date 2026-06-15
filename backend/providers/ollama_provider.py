import logging
import httpx
from providers.base import LLMProvider, ExtractionRequest, ExtractedWord
from providers._parse import parse_llm_response
from providers._prompts import IMAGE_SYSTEM_PROMPT, IMAGE_USER_PROMPT, TEXT_SYSTEM_PROMPT, WORD_LOOKUP_SYSTEM_PROMPT, build_prompt

logger = logging.getLogger(__name__)


class OllamaProvider:
    name = "ollama"
    priority = 3
    supports_vision = True

    def __init__(self) -> None:
        from config import get_provider_config
        cfg = get_provider_config("ollama")
        self._base_url: str = cfg["base_url"]
        self._api_key: str | None = cfg.get("api_key")
        self._vision_model: str = cfg["vision_model"]
        self._text_model: str = cfg["text_model"]
        self._client = httpx.AsyncClient()

    async def extract_words(self, req: ExtractionRequest) -> list[ExtractedWord]:
        if req.input_type == "image":
            model = self._vision_model
            system_prompt = build_prompt(IMAGE_SYSTEM_PROMPT, req.instructions)
            message = {
                "role": "user",
                "content": IMAGE_USER_PROMPT,
                "images": [req.content],
            }
        else:
            model = self._text_model
            system_prompt = build_prompt(WORD_LOOKUP_SYSTEM_PROMPT if req.input_type == "word" else TEXT_SYSTEM_PROMPT, req.instructions)
            message = {"role": "user", "content": req.content}

        headers = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        response = await self._client.post(
            f"{self._base_url}/api/chat",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    message,
                ],
                "stream": False,
            },
            headers=headers,
            timeout=60.0,
        )
        response.raise_for_status()
        data = response.json()
        return parse_llm_response(data["message"]["content"])
