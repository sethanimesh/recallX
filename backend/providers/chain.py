import logging
from openai import RateLimitError
from providers.base import ExtractionRequest, ExtractedWord, LLMProvider
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
