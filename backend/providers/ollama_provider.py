import logging
import json
from contextlib import asynccontextmanager
from urllib.parse import urlparse
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

    @asynccontextmanager
    async def _inference_scope(self):
        if urlparse(self._base_url).hostname in {"localhost", "127.0.0.1", "::1"}:
            from local_runtime import async_inference_lease
            async with async_inference_lease():
                yield True
        else:
            yield False

    async def chat_content(self, messages, *, model=None, schema=None, temperature=None):
        """All Ollama generation paths share the native API and local memory policy."""
        model = model or self._text_model
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        payload = {"model": model, "messages": messages, "stream": False, "keep_alive": 0}
        if schema is not None:
            payload["format"] = schema
        if temperature is not None:
            payload["options"] = {"temperature": temperature}
        async with self._inference_scope() as local:
            try:
                response = await self._client.post(f"{self._base_url.rstrip('/')}/api/chat", json=payload, headers=headers, timeout=60.0)
                response.raise_for_status()
                return response.json()["message"]["content"]
            finally:
                if local:
                    # Also request unload after an interrupted/failed request, before
                    # handing the shared memory lease to Paddle or the grading models.
                    try:
                        unloaded = await self._client.post(f"{self._base_url.rstrip('/')}/api/generate", json={"model": model, "keep_alive": 0}, headers=headers, timeout=10.0)
                        unloaded.raise_for_status()
                    except Exception:
                        logger.warning("Local Ollama unload request failed", exc_info=True)

    async def generate_json(self, messages, schema, temperature=0.7):
        return json.loads(await self.chat_content(messages, schema=schema, temperature=temperature))

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

        content = await self.chat_content([{"role": "system", "content": system_prompt}, message], model=model)
        return parse_llm_response(content)
