from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from main import app
from providers.base import ExtractedWord
from providers.chain import ExtractionFailedError

client = TestClient(app)


def test_word_lookup_compatibility():
    chain = MagicMock()
    chain.extract = AsyncMock(return_value=[ExtractedWord(word="test", definition="A test.", example_sentence="This is a test.")])
    with patch("routers.extract.get_chain", return_value=chain):
        response = client.post("/extract", json={"input_type": "word", "content": "test"})
    assert response.status_code == 200
    assert response.json()[0]["word"] == "test"


def test_word_lookup_failure_is_explicit():
    chain = MagicMock()
    chain.extract = AsyncMock(side_effect=ExtractionFailedError(["ollama: unavailable"]))
    with patch("routers.extract.get_chain", return_value=chain):
        response = client.post("/extract", json={"input_type": "word", "content": "test"})
    assert response.status_code == 503
    assert response.json()["detail"]["error"] == "All providers failed"


def test_pdf_requires_durable_job():
    response = client.post("/extract/pdf", files={"file": ("test.pdf", b"%PDF-1.4", "application/pdf")})
    assert response.status_code == 410
    assert "/ingestion/jobs" in response.json()["detail"]


def test_invalid_image_contract_still_rejected():
    assert client.post("/extract", json={"input_type": "image", "content": "fake"}).status_code == 422
