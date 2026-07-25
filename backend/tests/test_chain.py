import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from openai import RateLimitError
from providers.base import ExtractionRequest, ExtractedWord
from providers.chain import ProviderChain, ExtractionFailedError


def make_word(w="test"):
    return ExtractedWord(word=w, definition="A test.", example_sentence="This is a test.")


# Helper: build a ProviderChain with injected mock providers (bypass real constructors)
def make_chain(providers: list) -> ProviderChain:
    chain = ProviderChain.__new__(ProviderChain)
    chain._providers = providers
    return chain


def mock_provider(name: str, supports_vision: bool, result=None, raises=None):
    p = MagicMock()
    p.name = name
    p.supports_vision = supports_vision
    if raises:
        p.extract_words = AsyncMock(side_effect=raises)
    else:
        p.extract_words = AsyncMock(return_value=result or [make_word()])
    return p


@pytest.mark.asyncio
async def test_chain_uses_first_provider():
    p1 = mock_provider("groq", True)
    p2 = mock_provider("openrouter", True)
    chain = make_chain([p1, p2])
    req = ExtractionRequest(input_type="text", content="hello")
    with patch("providers.chain.database.record_llm_call"):
        result = await chain.extract(req)
    p1.extract_words.assert_called_once()
    p2.extract_words.assert_not_called()
    assert result[0].word == "test"


@pytest.mark.asyncio
async def test_chain_falls_back_on_rate_limit():
    err = RateLimitError("rate limited", response=MagicMock(), body={})
    p1 = mock_provider("groq", True, raises=err)
    p2 = mock_provider("openrouter", True)
    chain = make_chain([p1, p2])
    req = ExtractionRequest(input_type="text", content="hello")
    with patch("providers.chain.database.record_llm_call"):
        result = await chain.extract(req)
    p1.extract_words.assert_called_once()
    p2.extract_words.assert_called_once()
    assert result[0].word == "test"


@pytest.mark.asyncio
async def test_chain_falls_back_on_missing_key():
    p1 = mock_provider("groq", True, raises=ValueError("GROQ_API_KEY not set"))
    p2 = mock_provider("openrouter", True)
    chain = make_chain([p1, p2])
    req = ExtractionRequest(input_type="text", content="hello")
    with patch("providers.chain.database.record_llm_call"):
        result = await chain.extract(req)
    assert result[0].word == "test"


@pytest.mark.asyncio
async def test_chain_skips_no_vision_for_image():
    p1 = mock_provider("huggingface", False)  # no vision
    p2 = mock_provider("groq", True)
    chain = make_chain([p1, p2])
    req = ExtractionRequest(input_type="image", content="abc", mime_type="image/jpeg")
    with patch("providers.chain.database.record_llm_call"):
        result = await chain.extract(req)
    p1.extract_words.assert_not_called()  # skipped
    p2.extract_words.assert_called_once()
    assert result[0].word == "test"


@pytest.mark.asyncio
async def test_chain_raises_extraction_failed_when_all_fail():
    err = RateLimitError("rate limited", response=MagicMock(), body={})
    p1 = mock_provider("groq", True, raises=err)
    p2 = mock_provider("openrouter", True, raises=ValueError("no key"))
    chain = make_chain([p1, p2])
    req = ExtractionRequest(input_type="text", content="hello")
    with patch("providers.chain.database.record_llm_call"):
        with pytest.raises(ExtractionFailedError) as exc_info:
            await chain.extract(req)
    assert len(exc_info.value.failures) == 2


@pytest.mark.asyncio
async def test_chain_skips_not_implemented():
    p1 = mock_provider("huggingface", True, raises=NotImplementedError("no vision"))
    p2 = mock_provider("groq", True)
    chain = make_chain([p1, p2])
    req = ExtractionRequest(input_type="image", content="abc", mime_type="image/jpeg")
    with patch("providers.chain.database.record_llm_call"):
        result = await chain.extract(req)
    p2.extract_words.assert_called_once()
    assert result[0].word == "test"


@pytest.mark.asyncio
async def test_chain_records_llm_call_on_extract_success():
    p1 = mock_provider("groq", True)
    p1._text_model = "llama-3.3-70b"
    chain = make_chain([p1])
    req = ExtractionRequest(input_type="text", content="hello")
    with patch("providers.chain.database.record_llm_call") as mock_record:
        await chain.extract(req)
    mock_record.assert_called_once_with("groq", "llama-3.3-70b", "text")


@pytest.mark.asyncio
async def test_chain_does_not_record_on_extract_failure():
    err = RateLimitError("rate limited", response=MagicMock(), body={})
    p1 = mock_provider("groq", True, raises=err)
    chain = make_chain([p1])
    req = ExtractionRequest(input_type="text", content="hello")
    with patch("providers.chain.database.record_llm_call") as mock_record:
        with pytest.raises(ExtractionFailedError):
            await chain.extract(req)
    mock_record.assert_not_called()


@pytest.mark.asyncio
async def test_chain_cannot_grade_with_a_generative_provider():
    chain = make_chain([])
    with patch("openai.AsyncOpenAI") as factory, patch("providers.chain.database.record_llm_call") as record:
        with pytest.raises(RuntimeError, match="Generative grading is disabled"):
            await chain.grade("ephemeral", "temporary", "brief")
        with pytest.raises(RuntimeError, match="Generative tutor assessment is disabled"):
            await chain.tutor_chat()
    factory.assert_not_called()
    record.assert_not_called()
