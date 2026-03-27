import logging
from openai import RateLimitError
from providers.base import ExtractionRequest, ExtractedWord, GradeResult, LLMProvider, TutorChatResponse
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
                logger.info(
                    "LLM inference succeeded provider=%s model=%s task=grade",
                    provider.name,
                    text_model,
                )
                try:
                    database.record_llm_call(provider.name, text_model, "grade")
                except Exception:
                    logger.warning("Failed to record LLM call for provider=%s", provider.name, exc_info=True)
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

    async def tutor_chat(
        self,
        word: str,
        stored_definition: str,
        stored_example: str,
        user_answer: str,
        history: list[dict],
        is_retry: bool = False,
    ) -> TutorChatResponse:
        """Perform a conversational AI tutor turn using the first available text provider."""
        from openai import AsyncOpenAI
        from config import get_provider_config

        _TUTOR_RESPONSE_FORMAT = {
            "type": "json_schema",
            "json_schema": {
                "name": "TutorChatResponse",
                "schema": {
                    "type": "object",
                    "properties": {
                        "response": {"type": "string"},
                        "evaluation": {"type": "string", "enum": ["correct", "close", "incorrect"]},
                        "hint_provided": {"type": "boolean"},
                    },
                    "required": ["response", "evaluation", "hint_provided"],
                    "additionalProperties": False,
                },
                "strict": True,
            },
        }

        system_prompt = (
            f"You are a friendly, encouraging, and human-like AI vocabulary tutor.\n"
            f"You are helping the user practice the target word: \"{word}\".\n"
            f"Stored Definition: \"{stored_definition}\"\n"
            f"Stored Example Sentence: \"{stored_example}\"\n\n"
            f"Behavioral Guidelines:\n"
            f"1. Evaluate the user's latest response:\n"
            f"   - If they define the word correctly (synonyms, paraphrase, or general correct sense): Praise them warmly, motivate them, and confirm it's correct. Set evaluation='correct' and hint_provided=false.\n"
            f"   - If they are close (partially correct or slightly off): Motivate them for being close, gently correct the nuance, and provide the exact stored definition. Set evaluation='close' and hint_provided=false.\n"
            f"   - If they are incorrect or far away: Correct them gently, explain the correct meaning, and show them the example sentence. Set evaluation='incorrect' and hint_provided=false.\n"
            f"   - If they cannot remember, say they don't know, ask for help, or type 'help'/'hint'/'skip': Help them remember by giving them a hint (like a fill-in-the-blank sentence where the target word is replaced by underscores, e.g. \"The customer remained ___ despite the salesman's efforts\", or a conceptual clue). Do NOT reveal the definition or the word itself yet. Encourage them to try again. Set evaluation='incorrect' and hint_provided=true.\n"
            f"2. Keep your conversational response natural, concise (1-3 sentences), and human-like.\n"
            f"3. If is_retry is True, this is a word the user struggled with earlier in this session. Greet them with encouragement and ask them if they remember it now.\n"
        )

        failures: list[str] = []
        for provider in self._providers:
            if provider.name == "gemini" and getattr(provider, "_client", None) is not None:
                try:
                    logger.info("Trying Gemini native SDK for tutoring")
                    from google.genai import types as genai_types
                    
                    contents = []
                    for msg in history:
                        role = "user" if msg["role"] == "user" else "model"
                        contents.append(
                            genai_types.Content(
                                role=role,
                                parts=[genai_types.Part.from_text(text=msg["content"])]
                            )
                        )
                    contents.append(
                        genai_types.Content(
                            role="user",
                            parts=[genai_types.Part.from_text(text=user_answer)]
                        )
                    )

                    response = await provider._client.aio.models.generate_content(
                        model=provider._model,
                        contents=contents,
                        config=genai_types.GenerateContentConfig(
                            system_instruction=system_prompt,
                            response_mime_type="application/json",
                            response_schema=TutorChatResponse,
                            temperature=0.7,
                        ),
                    )
                    raw = response.text or "{}"
                    logger.info("LLM inference succeeded provider=gemini task=tutor")
                    try:
                        database.record_llm_call("gemini", provider._model, "tutor")
                    except Exception:
                        logger.warning("Failed to record LLM call for gemini", exc_info=True)
                    return TutorChatResponse.model_validate_json(raw)
                except Exception as e:
                    msg = f"gemini: {type(e).__name__}: {e}"
                    logger.error("Gemini native SDK error during tutoring — %s", e)
                    failures.append(msg)
                continue

            # Standard OpenAI compatible path (groq, openrouter, ollama, mistral, huggingface)
            cfg = {}
            try:
                cfg = get_provider_config(provider.name)
            except Exception:
                pass

            text_model = cfg.get("text_model")
            base_url = cfg.get("base_url")
            api_key = cfg.get("api_key")

            if not text_model:
                logger.debug("Skipping %s for tutoring — no text_model", provider.name)
                continue

            try:
                logger.info("Trying provider %s for tutoring", provider.name)
                client = AsyncOpenAI(
                    api_key=api_key or "missing",
                    base_url=base_url,
                )
                
                messages = [{"role": "system", "content": system_prompt}]
                for msg in history:
                    messages.append({"role": msg["role"], "content": msg["content"]})
                messages.append({"role": "user", "content": user_answer})

                response = await client.chat.completions.create(
                    model=text_model,
                    messages=messages,
                    temperature=0.7,
                    response_format=_TUTOR_RESPONSE_FORMAT,
                )
                raw = response.choices[0].message.content or "{}"
                logger.info(
                    "LLM inference succeeded provider=%s model=%s task=tutor",
                    provider.name,
                    text_model,
                )
                try:
                    database.record_llm_call(provider.name, text_model, "tutor")
                except Exception:
                    logger.warning("Failed to record LLM call for provider=%s", provider.name, exc_info=True)
                return TutorChatResponse.model_validate_json(raw)
            except (RateLimitError, ValueError) as e:
                msg = f"{provider.name}: {type(e).__name__}: {e}"
                logger.warning("Provider %s skipped for tutoring — %s", provider.name, e)
                failures.append(msg)
            except Exception as e:
                msg = f"{provider.name}: {type(e).__name__}: {e}"
                logger.error("Provider %s error during tutoring — %s", provider.name, e)
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
