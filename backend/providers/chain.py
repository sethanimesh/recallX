import logging
from openai import RateLimitError
from providers.base import ExtractionRequest, ExtractedWord, GradeResult, LLMProvider
from config import get_provider_order

logger = logging.getLogger(__name__)


class ExtractionFailedError(Exception):
    def __init__(self, failures: list[str]) -> None:
        self.failures = failures
        super().__init__(f"All providers failed: {failures}")


_PROVIDER_MAP: dict[str, type] = {}  # populated at bottom of file


class ProviderChain:
    def __init__(self) -> None:
        order = get_provider_order()
        self._providers: list[LLMProvider] = []
        for name in order:
            cls = _PROVIDER_MAP.get(name)
            if cls is None:
                logger.warning("Unknown provider '%s' in PROVIDER_PRIORITY — skipping", name)
                continue
            try:
                self._providers.append(cls())
            except Exception as e:
                logger.warning("Provider '%s' failed to initialise: %s — skipping", name, e)

    async def extract(self, req: ExtractionRequest) -> list[ExtractedWord]:
        failures: list[str] = []
        for provider in self._providers:
            if req.input_type == "image" and not provider.supports_vision:
                logger.debug("Skipping %s — no vision support", provider.name)
                continue
            try:
                logger.info("Trying provider: %s", provider.name)
                result = await provider.extract_words(req)
                logger.info("Provider %s succeeded (%d words)", provider.name, len(result))
                return result
            except (RateLimitError, ValueError) as e:
                msg = f"{provider.name}: {type(e).__name__}: {e}"
                logger.warning("Provider %s skipped — %s", provider.name, e)
                failures.append(msg)
            except NotImplementedError as e:
                msg = f"{provider.name}: NotImplementedError: {e}"
                logger.debug("Provider %s skipped — %s", provider.name, e)
                failures.append(msg)
            except Exception as e:
                msg = f"{provider.name}: {type(e).__name__}: {e}"
                logger.error("Provider %s error — %s", provider.name, e)
                failures.append(msg)
        raise ExtractionFailedError(failures)

    async def grade(
        self,
        word: str,
        user_answer: str,
        stored_definition: str,
    ) -> GradeResult:
        """Grade a user's definition answer using the first available text provider."""
        from openai import AsyncOpenAI
        from config import get_provider_config

        _GRADE_RESPONSE_FORMAT = {
            "type": "json_schema",
            "json_schema": {
                "name": "GradeResult",
                "schema": {
                    "type": "object",
                    "properties": {
                        "correct": {"type": "boolean"},
                        "feedback": {"type": "string"},
                    },
                    "required": ["correct", "feedback"],
                    "additionalProperties": False,
                },
                "strict": True,
            },
        }

        prompt = (
            f"You are a lenient vocabulary teacher grading an answer.\n\n"
            f"Word: {word}\n"
            f"Stored definition: {stored_definition}\n"
            f"answer: {user_answer}\n\n"
            "Decide if the answer captures the core meaning of the stored "
            "definition. Be lenient — synonyms, paraphrases, and partial but correct "
            "descriptions count as correct. Return a JSON object with:\n"
            '  "correct": true or false\n'
            '  "feedback": a short (1-2 sentence) explanation of the grade'
        )

        failures: list[str] = []
        for provider in self._providers:
            # Skip providers that don't have a text model (vision-only providers)
            cfg = {}
            try:
                cfg = get_provider_config(provider.name)
            except Exception:
                pass

            # Build a minimal OpenAI-compatible client from the provider's config.
            # Only providers with a text_model and api_key are usable here.
            text_model = cfg.get("text_model")
            base_url = cfg.get("base_url")
            api_key = cfg.get("api_key")

            if not text_model:
                logger.debug("Skipping %s for grading — no text_model", provider.name)
                continue

            try:
                logger.info("Trying provider %s for grading", provider.name)
                client = AsyncOpenAI(
                    api_key=api_key or "missing",
                    base_url=base_url,
                )
                response = await client.chat.completions.create(
                    model=text_model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1,
                    response_format=_GRADE_RESPONSE_FORMAT,
                )
                raw = response.choices[0].message.content or "{}"
                return GradeResult.model_validate_json(raw)
            except (RateLimitError, ValueError) as e:
                msg = f"{provider.name}: {type(e).__name__}: {e}"
                logger.warning("Provider %s skipped for grading — %s", provider.name, e)
                failures.append(msg)
            except Exception as e:
                msg = f"{provider.name}: {type(e).__name__}: {e}"
                logger.error("Provider %s error during grading — %s", provider.name, e)
                failures.append(msg)

        raise ExtractionFailedError(failures)


# Import here to avoid circular imports
from providers.groq_provider import GroqProvider
from providers.openrouter_provider import OpenRouterProvider
from providers.ollama_provider import OllamaProvider
from providers.gemini_provider import GeminiProvider
from providers.mistral_provider import MistralProvider
from providers.huggingface_provider import HuggingFaceProvider

_PROVIDER_MAP = {
    "groq": GroqProvider,
    "openrouter": OpenRouterProvider,
    "ollama": OllamaProvider,
    "gemini": GeminiProvider,
    "mistral": MistralProvider,
    "huggingface": HuggingFaceProvider,
}
