"""Unit tests for OpenAI-compatible LLM adapters (Groq, OpenRouter, Ollama, Mistral)."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from providers.base import ExtractionRequest
from providers._parse import parse_llm_response
from providers._prompts import IMAGE_SYSTEM_PROMPT, IMAGE_USER_PROMPT, WORD_LOOKUP_SYSTEM_PROMPT
from providers.groq_provider import GroqProvider
from providers.openrouter_provider import OpenRouterProvider
from providers.ollama_provider import OllamaProvider
from providers.mistral_provider import MistralProvider

SAMPLE_JSON = '[{"word":"test","definition":"A trial or examination.","example_sentence":"This is a test sentence."}]'
SINGLE_WORD_JSON = '[{"word":"pellucid","definition":"Translucently clear.","example_sentence":"The pellucid water revealed the river bed."}]'

# Groq uses structured output — the model returns ExtractionResult JSON ({"words": [...]})
GROQ_SAMPLE_JSON = '{"words":[{"word":"test","definition":"A trial or examination.","example_sentence":"This is a test sentence."}]}'
GROQ_SINGLE_WORD_JSON = '{"words":[{"word":"pellucid","definition":"Translucently clear.","example_sentence":"The pellucid water revealed the river bed."}]}'


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


def test_parse_llm_response_accepts_string_array():
    result = parse_llm_response('["Photosynthesis", "Cellular respiration"]')
    assert [item.word for item in result] == ["Photosynthesis", "Cellular respiration"]
    assert all(item.definition == "" for item in result)
    assert all(item.example_sentence == "" for item in result)


def test_parse_llm_response_fills_missing_optional_fields():
    result = parse_llm_response('[{"word":"Mitochondria"}]')
    assert result[0].word == "Mitochondria"
    assert result[0].definition == ""
    assert result[0].example_sentence == ""


# ---------------------------------------------------------------------------
# GroqProvider tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_groq_text_extraction():
    with patch("providers.groq_provider.AsyncOpenAI") as MockClient:
        MockClient.return_value = make_mock_client(GROQ_SAMPLE_JSON)
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
        MockClient.return_value = make_mock_client(GROQ_SAMPLE_JSON)
        provider = GroqProvider()
        provider._api_key = "fake-key"
        req = ExtractionRequest(input_type="image", content="abc123", mime_type="image/jpeg")
        result = await provider.extract_words(req)
        assert len(result) == 1
        call_kwargs = MockClient.return_value.chat.completions.create.call_args
        assert call_kwargs.kwargs["model"] == provider._vision_model
        assert call_kwargs.kwargs["messages"][0]["content"] == IMAGE_SYSTEM_PROMPT
        # Verify data URL format in messages
        user_content = call_kwargs.kwargs["messages"][1]["content"]
        text_part = next(p for p in user_content if p["type"] == "text")
        image_part = next(p for p in user_content if p["type"] == "image_url")
        assert text_part["text"] == IMAGE_USER_PROMPT
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
        assert call_kwargs.kwargs["messages"][0]["content"] == IMAGE_SYSTEM_PROMPT
        user_content = call_kwargs.kwargs["messages"][1]["content"]
        text_part = next(p for p in user_content if p["type"] == "text")
        image_part = next(p for p in user_content if p["type"] == "image_url")
        assert text_part["text"] == IMAGE_USER_PROMPT
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
    with patch("providers.ollama_provider.httpx.AsyncClient") as MockClient:
        response = MagicMock()
        response.json.return_value = {"message": {"content": SAMPLE_JSON}}
        response.raise_for_status.return_value = None
        mock_client = MagicMock()
        mock_client.post = AsyncMock(return_value=response)
        MockClient.return_value = mock_client
        provider = OllamaProvider()
        result = await provider.extract_words(
            ExtractionRequest(input_type="text", content="some text")
        )
        assert len(result) == 1
        call_kwargs = mock_client.post.call_args
        assert call_kwargs.args[0] == f"{provider._base_url}/api/chat"
        assert call_kwargs.kwargs["json"]["model"] == provider._text_model
        assert call_kwargs.kwargs["json"]["messages"][1]["content"] == "some text"


@pytest.mark.asyncio
async def test_ollama_image_extraction():
    with patch("providers.ollama_provider.httpx.AsyncClient") as MockClient:
        response = MagicMock()
        response.json.return_value = {"message": {"content": SAMPLE_JSON}}
        response.raise_for_status.return_value = None
        mock_client = MagicMock()
        mock_client.post = AsyncMock(return_value=response)
        MockClient.return_value = mock_client
        provider = OllamaProvider()
        req = ExtractionRequest(input_type="image", content="imgdata", mime_type="image/jpeg")
        result = await provider.extract_words(req)
        assert len(result) == 1
        call_kwargs = mock_client.post.call_args
        payload = call_kwargs.kwargs["json"]
        assert payload["model"] == provider._vision_model
        assert payload["messages"][0]["content"] == IMAGE_SYSTEM_PROMPT
        assert payload["messages"][1]["content"] == IMAGE_USER_PROMPT
        assert payload["messages"][1]["images"] == ["imgdata"]


def test_ollama_uses_default_base_url(monkeypatch):
    monkeypatch.delenv("OLLAMA_API_KEY", raising=False)
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    with patch("providers.ollama_provider.httpx.AsyncClient"):
        provider = OllamaProvider()
        assert provider._base_url == "http://localhost:11434"


def test_ollama_uses_cloud_base_url_when_cloud_key_present(monkeypatch):
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    monkeypatch.setenv("OLLAMA_API_KEY", "cloud-key")

    with patch("providers.ollama_provider.httpx.AsyncClient"):
        provider = OllamaProvider()

    assert provider._base_url == "https://ollama.com"
    assert provider._api_key == "cloud-key"


@pytest.mark.asyncio
async def test_ollama_sends_auth_header_when_api_key_present():
    with patch("providers.ollama_provider.httpx.AsyncClient") as MockClient:
        response = MagicMock()
        response.json.return_value = {"message": {"content": SAMPLE_JSON}}
        response.raise_for_status.return_value = None
        mock_client = MagicMock()
        mock_client.post = AsyncMock(return_value=response)
        MockClient.return_value = mock_client
        provider = OllamaProvider()
        provider._api_key = "secret"

        await provider.extract_words(ExtractionRequest(input_type="text", content="text"))

        call_kwargs = mock_client.post.call_args
        assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer secret"


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


# ---------------------------------------------------------------------------
# GroqProvider — word lookup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_groq_word_lookup_uses_text_model_and_lookup_prompt():
    with patch("providers.groq_provider.AsyncOpenAI") as MockOpenAI:
        mock_client = make_mock_client(GROQ_SINGLE_WORD_JSON)
        MockOpenAI.return_value = mock_client

        provider = GroqProvider()
        result = await provider.extract_words(
            ExtractionRequest(input_type="word", content="pellucid")
        )

        assert len(result) == 1
        assert result[0].word == "pellucid"
        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        messages = call_kwargs["messages"]
        assert any(WORD_LOOKUP_SYSTEM_PROMPT in str(m.get("content", "")) for m in messages)


# ---------------------------------------------------------------------------
# OpenRouterProvider — word lookup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_openrouter_word_lookup_uses_lookup_prompt():
    with patch("providers.openrouter_provider.AsyncOpenAI") as MockOpenAI:
        mock_client = make_mock_client(SINGLE_WORD_JSON)
        MockOpenAI.return_value = mock_client

        provider = OpenRouterProvider()
        provider._api_key = "fake-key"
        result = await provider.extract_words(
            ExtractionRequest(input_type="word", content="pellucid")
        )

        assert len(result) == 1
        assert result[0].word == "pellucid"
        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        messages = call_kwargs["messages"]
        assert any(WORD_LOOKUP_SYSTEM_PROMPT in str(m.get("content", "")) for m in messages)


# ---------------------------------------------------------------------------
# MistralProvider — word lookup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_mistral_word_lookup_uses_lookup_prompt():
    with patch("providers.mistral_provider.AsyncOpenAI") as MockOpenAI:
        mock_client = make_mock_client(SINGLE_WORD_JSON)
        MockOpenAI.return_value = mock_client

        provider = MistralProvider()
        provider._api_key = "fake-key"
        result = await provider.extract_words(
            ExtractionRequest(input_type="word", content="pellucid")
        )

        assert len(result) == 1
        assert result[0].word == "pellucid"
        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        messages = call_kwargs["messages"]
        assert any(WORD_LOOKUP_SYSTEM_PROMPT in str(m.get("content", "")) for m in messages)


# ---------------------------------------------------------------------------
# OllamaProvider — word lookup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ollama_word_lookup_uses_lookup_prompt():
    from providers.ollama_provider import OllamaProvider
    from providers._prompts import WORD_LOOKUP_SYSTEM_PROMPT

    SINGLE_WORD_JSON = '[{"word":"pellucid","definition":"Translucently clear.","example_sentence":"The pellucid water revealed the river bed."}]'

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "message": {"content": SINGLE_WORD_JSON}
    }

    with patch("providers.ollama_provider.httpx.AsyncClient") as MockClient:
        mock_http = MagicMock()
        mock_http.post = AsyncMock(return_value=mock_response)
        MockClient.return_value = mock_http

        provider = OllamaProvider()
        result = await provider.extract_words(
            ExtractionRequest(input_type="word", content="pellucid")
        )

        assert len(result) == 1
        assert result[0].word == "pellucid"
        call_kwargs = mock_http.post.call_args.kwargs
        messages = call_kwargs["json"]["messages"]
        assert any(WORD_LOOKUP_SYSTEM_PROMPT in str(m.get("content", "")) for m in messages)
