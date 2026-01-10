import asyncio
import logging
from huggingface_hub import InferenceClient
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
        # InferenceClient is sync — run in thread executor
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self._client.chat_completion(
                model=self._model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": req.content},
                ],
                max_tokens=1024,
            )
        )
        text = response.choices[0].message.content or ""
        return parse_llm_response(text)
