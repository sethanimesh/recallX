import asyncio
import logging
from huggingface_hub import InferenceClient
from providers.base import LLMProvider, ExtractionRequest, ExtractedWord
from providers._parse import parse_llm_response
from providers._prompts import TEXT_SYSTEM_PROMPT, WORD_LOOKUP_SYSTEM_PROMPT
from config import get_provider_config

logger = logging.getLogger(__name__)


class HuggingFaceProvider:
    name = "huggingface"
    priority = 6
    supports_vision = False  # text-only

    def __init__(self) -> None:
        cfg = get_provider_config("huggingface")
        self._api_key: str | None = cfg.get("api_key")
        self._model: str = cfg.get("text_model", "mistralai/Mistral-7B-Instruct-v0.3")
        self._client = InferenceClient(token=self._api_key or None)

    async def extract_words(self, req: ExtractionRequest) -> list[ExtractedWord]:
        if not self._api_key:
            raise ValueError("HF_API_KEY not set")
        if req.input_type == "image":
            raise NotImplementedError("HuggingFaceProvider does not support vision inputs")
        system_prompt = WORD_LOOKUP_SYSTEM_PROMPT if req.input_type == "word" else TEXT_SYSTEM_PROMPT
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self._client.chat_completion(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": req.content},
                ],
                max_tokens=1024,
            )
        )
        text = response.choices[0].message.content or ""
        return parse_llm_response(text)
