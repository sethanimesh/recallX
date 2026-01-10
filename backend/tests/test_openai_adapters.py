"""Unit tests for OpenAI-compatible LLM adapters (Groq, OpenRouter, Ollama, Mistral)."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from providers.base import ExtractionRequest
from providers._parse import parse_llm_response
from providers.groq_provider import GroqProvider
from providers.openrouter_provider import OpenRouterProvider
from providers.ollama_provider import OllamaProvider
from providers.mistral_provider import MistralProvider

SAMPLE_JSON = '[{"word":"test","definition":"A trial or examination.","example_sentence":"This is a test sentence."}]'


def make_mock_response(content: str):
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp


def make_mock_client(content: str):
    """Return a mocked AsyncOpenAI instance whose chat.completions.create returns content."""
    instance = MagicMock()
    instance.chat = MagicMock()
    instance.chat.completions = MagicMock()
    instance.chat.completions.create = AsyncMock(return_value=make_mock_response(content))
    return instance


# ---------------------------------------------------------------------------
# _parse.py tests
# ---------------------------------------------------------------------------

def test_parse_llm_response_basic():
    result = parse_llm_response(SAMPLE_JSON)
    assert len(result) == 1
    assert result[0].word == "test"
    assert result[0].definition == "A trial or examination."


def test_parse_llm_response_strips_markdown():
    text = '```json\n[{"word":"hi","definition":"A greeting.","example_sentence":"Hi there."}]\n```'
    result = parse_llm_response(text)
    assert result[0].word == "hi"


def test_parse_llm_response_strips_plain_fences():
    text = '```\n[{"word":"hello","definition":"A salutation.","example_sentence":"Hello world."}]\n```'
    result = parse_llm_response(text)
    assert result[0].word == "hello"


def test_parse_llm_response_no_array_raises():
    with pytest.raises(ValueError, match="No JSON array"):
        parse_llm_response("This is not JSON at all.")


# ---------------------------------------------------------------------------
# GroqProvider tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_groq_text_extraction():
    with patch("providers.groq_provider.AsyncOpenAI") as MockClient:
        MockClient.return_value = make_mock_client(SAMPLE_JSON)
        provider = GroqProvider()
        provider._api_key = "fake-key"
        result = await provider.extract_words(
            ExtractionRequest(input_type="text", content="some text")
        )
        assert len(result) == 1
        assert result[0].word == "test"
        call_kwargs = MockClient.return_value.chat.completions.create.call_args
        assert call_kwargs.kwargs["model"] == provider._text_model


@pytest.mark.asyncio
async def test_groq_image_extraction():
    with patch("providers.groq_provider.AsyncOpenAI") as MockClient:
        MockClient.return_value = make_mock_client(SAMPLE_JSON)
        provider = GroqProvider()
        provider._api_key = "fake-key"
        req = ExtractionRequest(input_type="image", content="abc123", mime_type="image/jpeg")
        result = await provider.extract_words(req)
        assert len(result) == 1
        call_kwargs = MockClient.return_value.chat.completions.create.call_args
        assert call_kwargs.kwargs["model"] == provider._vision_model
        # Verify data URL format in messages
        user_content = call_kwargs.kwargs["messages"][1]["content"]
        image_part = next(p for p in user_content if p["type"] == "image_url")
        assert image_part["image_url"]["url"] == "data:image/jpeg;base64,abc123"


@pytest.mark.asyncio
async def test_groq_missing_api_key_raises():
    with patch("providers.groq_provider.AsyncOpenAI"):
        provider = GroqProvider()
        provider._api_key = None
        with pytest.raises(ValueError, match="GROQ_API_KEY"):
            await provider.extract_words(ExtractionRequest(input_type="text", content="text"))


@pytest.mark.asyncio
async def test_groq_rate_limit_propagates():
    from openai import RateLimitError
    with patch("providers.groq_provider.AsyncOpenAI") as MockClient:
        instance = make_mock_client("")
        instance.chat.completions.create = AsyncMock(
            side_effect=RateLimitError("rate limit", response=MagicMock(), body={})
        )
        MockClient.return_value = instance
        provider = GroqProvider()
        provider._api_key = "fake-key"
        with pytest.raises(RateLimitError):
            await provider.extract_words(ExtractionRequest(input_type="text", content="text"))


# ---------------------------------------------------------------------------
# OpenRouterProvider tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_openrouter_text_extraction():
    with patch("providers.openrouter_provider.AsyncOpenAI") as MockClient:
        MockClient.return_value = make_mock_client(SAMPLE_JSON)
        provider = OpenRouterProvider()
        provider._api_key = "fake-key"
        result = await provider.extract_words(
            ExtractionRequest(input_type="text", content="some text")
        )
        assert len(result) == 1
        call_kwargs = MockClient.return_value.chat.completions.create.call_args
        assert call_kwargs.kwargs["model"] == provider._text_model


@pytest.mark.asyncio
async def test_openrouter_image_extraction():
    with patch("providers.openrouter_provider.AsyncOpenAI") as MockClient:
        MockClient.return_value = make_mock_client(SAMPLE_JSON)
        provider = OpenRouterProvider()
        provider._api_key = "fake-key"
        req = ExtractionRequest(input_type="image", content="imgdata", mime_type="image/png")
        result = await provider.extract_words(req)
        assert len(result) == 1
        call_kwargs = MockClient.return_value.chat.completions.create.call_args
        assert call_kwargs.kwargs["model"] == provider._vision_model
        user_content = call_kwargs.kwargs["messages"][1]["content"]
        image_part = next(p for p in user_content if p["type"] == "image_url")
        assert image_part["image_url"]["url"] == "data:image/png;base64,imgdata"


@pytest.mark.asyncio
async def test_openrouter_missing_api_key_raises():
    with patch("providers.openrouter_provider.AsyncOpenAI"):
        provider = OpenRouterProvider()
        provider._api_key = None
        with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
            await provider.extract_words(ExtractionRequest(input_type="text", content="text"))


@pytest.mark.asyncio
async def test_openrouter_rate_limit_propagates():
    from openai import RateLimitError
    with patch("providers.openrouter_provider.AsyncOpenAI") as MockClient:
        instance = make_mock_client("")
        instance.chat.completions.create = AsyncMock(
            side_effect=RateLimitError("rate limit", response=MagicMock(), body={})
        )
        MockClient.return_value = instance
        provider = OpenRouterProvider()
        provider._api_key = "fake-key"
        with pytest.raises(RateLimitError):
            await provider.extract_words(ExtractionRequest(input_type="text", content="text"))


def test_openrouter_sends_extra_headers():
    """Verify that AsyncOpenAI is constructed with HTTP-Referer and X-Title headers."""
    with patch("providers.openrouter_provider.AsyncOpenAI") as MockClient:
        MockClient.return_value = make_mock_client(SAMPLE_JSON)
        OpenRouterProvider()
        init_kwargs = MockClient.call_args.kwargs
        headers = init_kwargs.get("default_headers", {})
        assert headers.get("HTTP-Referer") == "https://recallx.app"
        assert headers.get("X-Title") == "RecallX"


# ---------------------------------------------------------------------------
# OllamaProvider tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ollama_text_extraction():
    with patch("providers.ollama_provider.AsyncOpenAI") as MockClient:
        MockClient.return_value = make_mock_client(SAMPLE_JSON)
        provider = OllamaProvider()
        result = await provider.extract_words(
            ExtractionRequest(input_type="text", content="some text")
        )
        assert len(result) == 1
        call_kwargs = MockClient.return_value.chat.completions.create.call_args
        assert call_kwargs.kwargs["model"] == provider._text_model


@pytest.mark.asyncio
async def test_ollama_image_extraction():
    with patch("providers.ollama_provider.AsyncOpenAI") as MockClient:
        MockClient.return_value = make_mock_client(SAMPLE_JSON)
        provider = OllamaProvider()
        req = ExtractionRequest(input_type="image", content="imgdata", mime_type="image/jpeg")
        result = await provider.extract_words(req)
        assert len(result) == 1
        call_kwargs = MockClient.return_value.chat.completions.create.call_args
        assert call_kwargs.kwargs["model"] == provider._vision_model
        user_content = call_kwargs.kwargs["messages"][1]["content"]
        image_part = next(p for p in user_content if p["type"] == "image_url")
        assert image_part["image_url"]["url"] == "data:image/jpeg;base64,imgdata"


def test_ollama_missing_base_url_raises(monkeypatch):
    """When OLLAMA_BASE_URL is unset and no default, __init__ should raise ValueError."""
    # Patch get_provider_config to return config without base_url
    with patch("providers.ollama_provider.get_provider_config") as mock_cfg:
        mock_cfg.return_value = {
            "base_url": None,
            "vision_model": "llama3.2-vision",
            "text_model": "llama3.2",
        }
        with pytest.raises(ValueError, match="OLLAMA_BASE_URL"):
            OllamaProvider()


@pytest.mark.asyncio
async def test_ollama_rate_limit_propagates():
    from openai import RateLimitError
    with patch("providers.ollama_provider.AsyncOpenAI") as MockClient:
        instance = make_mock_client("")
        instance.chat.completions.create = AsyncMock(
            side_effect=RateLimitError("rate limit", response=MagicMock(), body={})
        )
        MockClient.return_value = instance
        provider = OllamaProvider()
        with pytest.raises(RateLimitError):
            await provider.extract_words(ExtractionRequest(input_type="text", content="text"))


# ---------------------------------------------------------------------------
# MistralProvider tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_mistral_text_extraction():
    with patch("providers.mistral_provider.AsyncOpenAI") as MockClient:
        MockClient.return_value = make_mock_client(SAMPLE_JSON)
        provider = MistralProvider()
        provider._api_key = "fake-key"
        result = await provider.extract_words(
            ExtractionRequest(input_type="text", content="some text")
        )
        assert len(result) == 1
        call_kwargs = MockClient.return_value.chat.completions.create.call_args
        assert call_kwargs.kwargs["model"] == provider._text_model


@pytest.mark.asyncio
async def test_mistral_image_extraction():
    with patch("providers.mistral_provider.AsyncOpenAI") as MockClient:
        MockClient.return_value = make_mock_client(SAMPLE_JSON)
        provider = MistralProvider()
        provider._api_key = "fake-key"
        req = ExtractionRequest(input_type="image", content="imgdata", mime_type="image/jpeg")
        result = await provider.extract_words(req)
        assert len(result) == 1
        call_kwargs = MockClient.return_value.chat.completions.create.call_args
        assert call_kwargs.kwargs["model"] == provider._vision_model
        user_content = call_kwargs.kwargs["messages"][1]["content"]
        image_part = next(p for p in user_content if p["type"] == "image_url")
        assert image_part["image_url"]["url"] == "data:image/jpeg;base64,imgdata"


@pytest.mark.asyncio
async def test_mistral_missing_api_key_raises():
    with patch("providers.mistral_provider.AsyncOpenAI"):
        provider = MistralProvider()
        provider._api_key = None
        with pytest.raises(ValueError, match="MISTRAL_API_KEY"):
            await provider.extract_words(ExtractionRequest(input_type="text", content="text"))


@pytest.mark.asyncio
async def test_mistral_rate_limit_propagates():
    from openai import RateLimitError
    with patch("providers.mistral_provider.AsyncOpenAI") as MockClient:
        instance = make_mock_client("")
        instance.chat.completions.create = AsyncMock(
            side_effect=RateLimitError("rate limit", response=MagicMock(), body={})
        )
        MockClient.return_value = instance
        provider = MistralProvider()
        provider._api_key = "fake-key"
        with pytest.raises(RateLimitError):
            await provider.extract_words(ExtractionRequest(input_type="text", content="text"))
