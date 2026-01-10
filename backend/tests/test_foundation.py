import os
from config import get_provider_order, get_provider_config
from providers.base import ExtractedWord, ExtractionRequest, LLMProvider


def test_default_provider_order():
    order = get_provider_order()
    assert order == ["groq", "openrouter", "ollama", "gemini", "mistral", "huggingface"]


def test_custom_provider_order(monkeypatch):
    monkeypatch.setenv("PROVIDER_PRIORITY", "gemini,groq")
    order = get_provider_order()
    assert order == ["gemini", "groq"]


def test_provider_config_groq():
    cfg = get_provider_config("groq")
    assert cfg["base_url"] == "https://api.groq.com/openai/v1"
    assert "api_key" in cfg


def test_extraction_request_model():
    req = ExtractionRequest(input_type="image", content="abc123", mime_type="image/jpeg")
    assert req.input_type == "image"
    assert req.mime_type == "image/jpeg"


def test_extracted_word_model():
    w = ExtractedWord(word="ephemeral", definition="Short-lived.", example_sentence="The joy was ephemeral.")
    assert w.word == "ephemeral"
    assert w.definition == "Short-lived."
    assert w.example_sentence == "The joy was ephemeral."


def test_llmprovider_protocol_runtime_check():
    import asyncio

    class ValidProvider:
        name = "test"
        priority = 1
        supports_vision = True
        async def extract_words(self, req: ExtractionRequest) -> list[ExtractedWord]:
            return []

    class MissingFieldProvider:
        # missing 'name', 'priority', 'supports_vision'
        async def extract_words(self, req: ExtractionRequest) -> list[ExtractedWord]:
            return []

    assert isinstance(ValidProvider(), LLMProvider), "ValidProvider should satisfy LLMProvider protocol"
    assert not isinstance(MissingFieldProvider(), LLMProvider), "MissingFieldProvider should NOT satisfy LLMProvider protocol"


def test_extraction_request_image_requires_mime_type():
    import pytest
    with pytest.raises(Exception):
        ExtractionRequest(input_type="image", content="abc123")  # mime_type missing → should raise
