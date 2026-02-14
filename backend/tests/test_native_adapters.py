"""Unit tests for native (non-OpenAI) LLM adapters: Gemini and HuggingFace."""
import base64
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from providers.base import ExtractionRequest
from providers.gemini_provider import GeminiProvider
from providers.huggingface_provider import HuggingFaceProvider
from providers._prompts import IMAGE_SYSTEM_PROMPT, IMAGE_USER_PROMPT, WORD_LOOKUP_SYSTEM_PROMPT

SAMPLE_JSON = '[{"word":"test","definition":"A trial or examination.","example_sentence":"This is a test sentence."}]'
SINGLE_WORD_JSON = '[{"word":"pellucid","definition":"Translucently clear.","example_sentence":"The pellucid water revealed the river bed."}]'


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_gemini_response(text: str) -> MagicMock:
    """Return a mock that looks like a GenerateContentResponse."""
    resp = MagicMock()
    resp.text = text
    return resp


def make_hf_response(text: str) -> MagicMock:
    """Return a mock that looks like a huggingface_hub ChatCompletionOutput."""
    msg = MagicMock()
    msg.content = text
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp


# ---------------------------------------------------------------------------
# GeminiProvider tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_gemini_text_extraction():
    """Text input: generate_content called with text content, parsed result returned."""
    with patch("providers.gemini_provider.genai.Client") as MockClient:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(
            return_value=make_gemini_response(SAMPLE_JSON)
        )
        MockClient.return_value = mock_client

        provider = GeminiProvider()
        # Inject a fake key and client so the provider doesn't reject the call
        provider._api_key = "fake-key"
        provider._client = mock_client

        result = await provider.extract_words(
            ExtractionRequest(input_type="text", content="some interesting text")
        )

        assert len(result) == 1
        assert result[0].word == "test"
        mock_client.aio.models.generate_content.assert_called_once()
        call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
        assert call_kwargs["model"] == provider._model


@pytest.mark.asyncio
async def test_gemini_image_extraction():
    """Image input: Part.from_bytes used (real call), generate_content called."""
    # Use valid base64 JPEG header bytes for the test
    image_b64 = base64.b64encode(b"\xff\xd8\xff" + b"\x00" * 10).decode()

    with patch("providers.gemini_provider.genai.Client") as MockClient:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(
            return_value=make_gemini_response(SAMPLE_JSON)
        )
        MockClient.return_value = mock_client

        provider = GeminiProvider()
        # Inject a fake key and client
        provider._api_key = "fake-key"
        provider._client = mock_client

        req = ExtractionRequest(input_type="image", content=image_b64, mime_type="image/jpeg")
        result = await provider.extract_words(req)

        assert len(result) == 1
        # Verify generate_content was called once (for image path)
        mock_client.aio.models.generate_content.assert_called_once()
        call_kwargs = mock_client.aio.models.generate_content.call_args.kwargs
        assert call_kwargs["model"] == provider._model
        # The contents should be a list with one Content object
        contents = call_kwargs["contents"]
        assert len(contents) == 1
        # The first part of the content should be the image part (from_bytes),
        # and the second should be a text part
        assert len(contents[0].parts) == 2
        assert contents[0].parts[1].text == f"{IMAGE_SYSTEM_PROMPT}\n\n{IMAGE_USER_PROMPT}"


@pytest.mark.asyncio
async def test_gemini_missing_api_key_raises():
    """Missing API key raises ValueError without making a network call."""
    with patch("providers.gemini_provider.get_provider_config") as mock_cfg:
        mock_cfg.return_value = {"api_key": None, "model": "gemini-2.0-flash"}
        provider = GeminiProvider()
        assert provider._client is None

        with pytest.raises(ValueError, match="GEMINI_API_KEY"):
            await provider.extract_words(
                ExtractionRequest(input_type="text", content="text")
            )


# ---------------------------------------------------------------------------
# HuggingFaceProvider tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_huggingface_text_extraction():
    """Text input: chat_completion called with correct model and messages, parsed result returned."""
    with patch("providers.huggingface_provider.InferenceClient") as MockClient:
        mock_instance = MagicMock()
        mock_instance.chat_completion.return_value = make_hf_response(SAMPLE_JSON)
        MockClient.return_value = mock_instance

        provider = HuggingFaceProvider()
        # Inject a fake key so the provider doesn't reject the call
        provider._api_key = "fake-key"

        result = await provider.extract_words(
            ExtractionRequest(input_type="text", content="some interesting text")
        )

        assert len(result) == 1
        assert result[0].word == "test"
        mock_instance.chat_completion.assert_called_once()
        call_kwargs = mock_instance.chat_completion.call_args.kwargs
        assert call_kwargs["model"] == provider._model
        messages = call_kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "some interesting text"


@pytest.mark.asyncio
async def test_huggingface_image_input_raises():
    """Image input raises NotImplementedError immediately."""
    with patch("providers.huggingface_provider.InferenceClient"):
        provider = HuggingFaceProvider()
        # Inject a fake key so we get past the key check and hit the vision check
        provider._api_key = "fake-key"
        req = ExtractionRequest(input_type="image", content="abc123", mime_type="image/jpeg")
        with pytest.raises(NotImplementedError, match="vision"):
            await provider.extract_words(req)


@pytest.mark.asyncio
async def test_huggingface_missing_api_key_raises():
    """Missing API key raises ValueError before any network call."""
    with patch("providers.huggingface_provider.InferenceClient") as MockClient, \
         patch("providers.huggingface_provider.get_provider_config") as mock_cfg:
        mock_cfg.return_value = {"api_key": None, "text_model": "mistralai/Mistral-7B-Instruct-v0.3"}
        mock_instance = MagicMock()
        MockClient.return_value = mock_instance

        provider = HuggingFaceProvider()
        assert provider._api_key is None

        with pytest.raises(ValueError, match="HF_API_KEY"):
            await provider.extract_words(
                ExtractionRequest(input_type="text", content="text")
            )

        mock_instance.chat_completion.assert_not_called()


# ---------------------------------------------------------------------------
# GeminiProvider — word lookup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_gemini_word_lookup_uses_lookup_prompt():
    with patch("providers.gemini_provider.genai.Client") as MockClient:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(
            return_value=make_gemini_response(SINGLE_WORD_JSON)
        )
        MockClient.return_value = mock_client

        provider = GeminiProvider()
        provider._api_key = "fake-key"
        provider._client = mock_client

        result = await provider.extract_words(
            ExtractionRequest(input_type="word", content="pellucid")
        )

        assert len(result) == 1
        assert result[0].word == "pellucid"
        call_args = mock_client.aio.models.generate_content.call_args
        contents = call_args.kwargs.get("contents") or (call_args.args[1] if len(call_args.args) > 1 else [])
        content_str = str(contents)
        assert WORD_LOOKUP_SYSTEM_PROMPT in content_str


# ---------------------------------------------------------------------------
# HuggingFaceProvider — word lookup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_huggingface_word_lookup_uses_lookup_prompt():
    with patch("providers.huggingface_provider.InferenceClient") as MockInference:
        provider = HuggingFaceProvider()
        provider._api_key = "fake-key"
        provider._client = MockInference.return_value

        provider._client.chat_completion.return_value = make_hf_response(SINGLE_WORD_JSON)

        result = await provider.extract_words(
            ExtractionRequest(input_type="word", content="pellucid")
        )

        assert len(result) == 1
        assert result[0].word == "pellucid"
        call_kwargs = provider._client.chat_completion.call_args.kwargs
        messages = call_kwargs["messages"]
        assert any(WORD_LOOKUP_SYSTEM_PROMPT in str(m.get("content", "")) for m in messages)
