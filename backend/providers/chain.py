import logging
from openai import RateLimitError
from providers.base import ExtractionRequest, ExtractedWord, LLMProvider, StoryResponse
from config import get_provider_order
import database

logger = logging.getLogger(__name__)


class ExtractionFailedError(Exception):
    def __init__(self, failures: list[str]) -> None:
        self.failures = failures
        super().__init__(f"All providers failed: {failures}")


_PROVIDER_MAP: dict[str, type] = {}  # populated at bottom of file


def _provider_model_for_request(provider: LLMProvider, input_type: str) -> str:
    if input_type == "image":
        return (
            getattr(provider, "_vision_model", None)
            or getattr(provider, "_model", None)
            or "unknown"
        )
    return (
        getattr(provider, "_text_model", None)
        or getattr(provider, "_model", None)
        or "unknown"
    )


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
                model = _provider_model_for_request(provider, req.input_type)
                logger.info(
                    "LLM inference succeeded provider=%s model=%s words=%d",
                    provider.name,
                    model,
                    len(result),
                )
                try:
                    database.record_llm_call(provider.name, model, req.input_type)
                except Exception:
                    logger.warning("Failed to record LLM call for provider=%s", provider.name, exc_info=True)
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

    async def grade(self, *args, **kwargs):
        """Legacy entrypoint deliberately disabled; use the canonical assessment service."""
        raise RuntimeError("Generative grading is disabled. Use /assessments with an approved rubric.")

    async def tutor_chat(self, *args, **kwargs):
        """Legacy generative judgment deliberately disabled in every provider branch."""
        raise RuntimeError("Generative tutor assessment is disabled. Use /tutor/chat.")

    async def generate_mnemonic(self, word: str, definition: str) -> str:
        """Generate a funny or bizarre mnemonic for a given word."""
        from openai import AsyncOpenAI
        from config import get_provider_config

        _MNEMONIC_RESPONSE_FORMAT = {
            "type": "json_schema",
            "json_schema": {
                "name": "MnemonicResponse",
                "schema": {
                    "type": "object",
                    "properties": {
                        "mnemonic": {"type": "string"},
                    },
                    "required": ["mnemonic"],
                    "additionalProperties": False,
                },
                "strict": True,
            },
        }

        system_prompt = database.get_system_prompt("mnemonic")
        user_prompt = f"Word: {word}\nDefinition: {definition}"

        failures: list[str] = []
        for provider in self._providers:
            if provider.name == "ollama":
                try:
                    result = await provider.generate_json(
                        [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
                        _MNEMONIC_RESPONSE_FORMAT["json_schema"]["schema"], temperature=0.9,
                    )
                    return result.get("mnemonic", "")
                except Exception as exc:
                    failures.append(f"ollama: {exc}")
                continue
            if provider.name == "gemini" and getattr(provider, "_client", None) is not None:
                try:
                    from google.genai import types as genai_types
                    from pydantic import BaseModel

                    class MnemonicResponseSchema(BaseModel):
                        mnemonic: str

                    response = await provider._client.aio.models.generate_content(
                        model=provider._model,
                        contents=user_prompt,
                        config=genai_types.GenerateContentConfig(
                            system_instruction=system_prompt,
                            response_mime_type="application/json",
                            response_schema=MnemonicResponseSchema,
                            temperature=0.9,
                        ),
                    )
                    raw = response.text or '{"mnemonic": ""}'
                    import json
                    return json.loads(raw).get("mnemonic", "")
                except Exception as e:
                    failures.append(f"gemini: {e}")
                continue

            cfg = {}
            try:
                cfg = get_provider_config(provider.name)
            except Exception:
                pass

            text_model = cfg.get("text_model")
            base_url = cfg.get("base_url")
            api_key = cfg.get("api_key")

            if not text_model:
                continue

            try:
                client = AsyncOpenAI(api_key=api_key or "missing", base_url=base_url)
                response = await client.chat.completions.create(
                    model=text_model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    temperature=0.9,
                    response_format=_MNEMONIC_RESPONSE_FORMAT,
                )
                raw = response.choices[0].message.content or "{}"
                import json
                return json.loads(raw).get("mnemonic", "")
            except Exception as e:
                failures.append(f"{provider.name}: {e}")

        logger.warning(f"Failed to generate mnemonic for {word}: {failures}")
        return ""



    async def generate_story(
        self,
        words: list[dict],
        custom_prompt: str,
    ) -> StoryResponse:
        from openai import AsyncOpenAI
        from config import get_provider_config

        _STORY_RESPONSE_FORMAT = {
            "type": "json_schema",
            "json_schema": {
                "name": "StoryResponse",
                "schema": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["title", "content"],
                    "additionalProperties": False,
                },
                "strict": True,
            },
        }

        # Build words text
        words_text = "\n".join([f"- {w['word']}: {w['definition']}" for w in words])
        
        template = database.get_system_prompt("story")
        try:
            system_prompt = template.format(words_text=words_text)
        except Exception:
            system_prompt = template
        if custom_prompt.strip():
            system_prompt += f"User's special instructions: {custom_prompt.strip()}\n\n"

        system_prompt += (
            "Return a JSON object with 'title' and 'content' (the story). "
            "Ensure you use every word provided above."
        )

        failures: list[str] = []
        for provider in self._providers:
            if provider.name == "ollama":
                try:
                    result = await provider.generate_json(
                        [{"role": "system", "content": system_prompt}, {"role": "user", "content": "Please write the story."}],
                        _STORY_RESPONSE_FORMAT["json_schema"]["schema"], temperature=0.7,
                    )
                    story = StoryResponse.model_validate(result)
                    try:
                        database.record_llm_call("ollama", provider._text_model, "story")
                    except Exception:
                        logger.warning("Failed to record Ollama story call", exc_info=True)
                    return story
                except Exception as exc:
                    failures.append(f"ollama: {type(exc).__name__}: {exc}")
                continue
            if provider.name == "gemini" and getattr(provider, "_client", None) is not None:
                try:
                    logger.info("Trying Gemini native SDK for story generation")
                    from google.genai import types as genai_types
                    
                    response = await provider._client.aio.models.generate_content(
                        model=provider._model,
                        contents=[
                            genai_types.Content(
                                role="user",
                                parts=[genai_types.Part.from_text(text="Please write the story.")]
                            )
                        ],
                        config=genai_types.GenerateContentConfig(
                            system_instruction=system_prompt,
                            response_mime_type="application/json",
                            response_schema=StoryResponse,
                            temperature=0.7,
                        ),
                    )
                    raw = response.text or "{}"
                    logger.info("LLM inference succeeded provider=gemini task=story")
                    try:
                        database.record_llm_call("gemini", provider._model, "story")
                    except Exception:
                        pass
                    return StoryResponse.model_validate_json(raw)
                except Exception as e:
                    msg = f"gemini: {type(e).__name__}: {e}"
                    logger.error("Gemini native SDK error during story generation — %s", e)
                    failures.append(msg)
                continue

            cfg = {}
            try:
                cfg = get_provider_config(provider.name)
            except Exception:
                pass

            text_model = cfg.get("text_model")
            base_url = cfg.get("base_url")
            api_key = cfg.get("api_key")

            if not text_model:
                continue

            try:
                logger.info("Trying provider %s for story generation", provider.name)
                client = AsyncOpenAI(
                    api_key=api_key or "missing",
                    base_url=base_url,
                )
                
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": "Please write the story."}
                ]

                response = await client.chat.completions.create(
                    model=text_model,
                    messages=messages,
                    temperature=0.7,
                    response_format=_STORY_RESPONSE_FORMAT,
                )
                raw = response.choices[0].message.content or "{}"
                logger.info(
                    "LLM inference succeeded provider=%s model=%s task=story",
                    provider.name,
                    text_model,
                )
                try:
                    database.record_llm_call(provider.name, text_model, "story")
                except Exception:
                    pass
                return StoryResponse.model_validate_json(raw)
            except (RateLimitError, ValueError) as e:
                msg = f"{provider.name}: {type(e).__name__}: {e}"
                logger.warning("Provider %s skipped for story generation — %s", provider.name, e)
                failures.append(msg)
            except Exception as e:
                msg = f"{provider.name}: {type(e).__name__}: {e}"
                logger.error("Provider %s error during story generation — %s", provider.name, e)
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
