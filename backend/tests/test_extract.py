import base64
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from main import app
from providers.base import ExtractedWord
from providers.chain import ExtractionFailedError

client = TestClient(app)


def make_word(word: str = "ephemeral") -> ExtractedWord:
    return ExtractedWord(
        word=word,
        definition="Lasting for a very short time.",
        example_sentence="The ephemeral beauty of cherry blossoms is well known.",
    )


_PATCH_INSERT = "routers.extract.database.insert_word"


def test_extract_text_returns_words():
    with patch("routers.extract.get_chain") as mock_gc, \
         patch(_PATCH_INSERT, return_value=True):
        chain = MagicMock()
        chain.extract = AsyncMock(return_value=[make_word("ephemeral"), make_word("laconic")])
        mock_gc.return_value = chain
        resp = client.post("/extract", json={"input_type": "text", "content": "test passage"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2


def test_extract_words_have_required_fields():
    with patch("routers.extract.get_chain") as mock_gc, \
         patch(_PATCH_INSERT, return_value=True):
        chain = MagicMock()
        chain.extract = AsyncMock(return_value=[make_word()])
        mock_gc.return_value = chain
        resp = client.post("/extract", json={"input_type": "text", "content": "test passage"})
    assert resp.status_code == 200
    for word in resp.json():
        assert word["word"]
        assert word["definition"]
        assert word["example_sentence"]


def test_extract_accepts_image_input_type():
    fake_image = base64.b64encode(b"fake-jpeg-bytes").decode()
    with patch("routers.extract.get_chain") as mock_gc, \
         patch(_PATCH_INSERT, return_value=True):
        chain = MagicMock()
        chain.extract = AsyncMock(return_value=[make_word()])
        mock_gc.return_value = chain
        resp = client.post(
            "/extract",
            json={"input_type": "image", "content": fake_image, "mime_type": "image/jpeg"},
        )
    assert resp.status_code == 200
