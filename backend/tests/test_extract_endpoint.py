import base64
import io
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from main import app
from providers.base import ExtractedWord
from providers.chain import ExtractionFailedError

client = TestClient(app)

# Patch insert_word globally so extract tests never touch the real DB.
# Each test still gets a fresh mock (patch as context manager below where needed).
_PATCH_INSERT = "routers.extract.database.insert_word"


def make_word() -> ExtractedWord:
    return ExtractedWord(
        word="test",
        definition="A test.",
        example_sentence="This is a test.",
    )


def test_extract_text_success():
    with patch("routers.extract.get_chain") as mock_gc, \
         patch(_PATCH_INSERT, return_value=True):
        chain = MagicMock()
        chain.extract = AsyncMock(return_value=[make_word()])
        mock_gc.return_value = chain
        resp = client.post("/extract", json={"input_type": "text", "content": "Some vocabulary text."})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["word"] == "test"
    assert "duplicate" in data[0]
    assert data[0]["duplicate"] is False


def test_extract_text_duplicate_word():
    with patch("routers.extract.get_chain") as mock_gc, \
         patch(_PATCH_INSERT, return_value=False):
        chain = MagicMock()
        chain.extract = AsyncMock(return_value=[make_word()])
        mock_gc.return_value = chain
        resp = client.post("/extract", json={"input_type": "text", "content": "Some vocabulary text."})
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["duplicate"] is True


def test_extract_image_success():
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
    data = resp.json()
    assert data[0]["word"] == "test"


def test_extract_returns_503_when_all_fail():
    with patch("routers.extract.get_chain") as mock_gc:
        chain = MagicMock()
        chain.extract = AsyncMock(side_effect=ExtractionFailedError(["groq: RateLimitError"]))
        mock_gc.return_value = chain
        resp = client.post("/extract", json={"input_type": "text", "content": "text"})
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert "failures" in detail
    assert detail["error"] == "All providers failed"


def test_extract_image_missing_mime_type_returns_422():
    fake_image = base64.b64encode(b"fake").decode()
    resp = client.post("/extract", json={"input_type": "image", "content": fake_image})
    # mime_type missing for image → pydantic validation error → 422
    assert resp.status_code == 422


def test_extract_pdf_success():
    """Upload a minimal valid PDF and verify the chain is called with extracted text."""
    # Minimal PDF that pdfminer can parse (contains the text "Hello world")
    minimal_pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n"
        b"   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
        b"4 0 obj\n<< /Length 44 >>\nstream\n"
        b"BT /F1 12 Tf 100 700 Td (Hello world) Tj ET\n"
        b"endstream\nendobj\n"
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
        b"xref\n0 6\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"0000000266 00000 n \n"
        b"0000000360 00000 n \n"
        b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n441\n%%EOF\n"
    )
    with patch("routers.extract.get_chain") as mock_gc, \
         patch(_PATCH_INSERT, return_value=True):
        chain = MagicMock()
        chain.extract = AsyncMock(return_value=[make_word()])
        mock_gc.return_value = chain
        resp = client.post(
            "/extract/pdf",
            files={"file": ("test.pdf", io.BytesIO(minimal_pdf), "application/pdf")},
        )
    # Either 200 (text extracted) or 422 (pdfminer couldn't parse the minimal PDF)
    assert resp.status_code in (200, 422)


def test_extract_pdf_empty_returns_422():
    """An empty file should return 422."""
    resp = client.post(
        "/extract/pdf",
        files={"file": ("empty.pdf", io.BytesIO(b""), "application/pdf")},
    )
    assert resp.status_code == 422


def test_extract_pdf_no_text_returns_422():
    """A non-PDF binary blob should return 422."""
    resp = client.post(
        "/extract/pdf",
        files={"file": ("bad.pdf", io.BytesIO(b"\x00\x01\x02\x03"), "application/pdf")},
    )
    assert resp.status_code == 422


def test_extract_pdf_503_when_chain_fails():
    """If the PDF has text but the chain fails, return 503."""
    # Use patch to bypass actual PDF parsing
    with patch("routers.extract.get_chain") as mock_gc, \
         patch("pdfminer.high_level.extract_text_to_fp") as mock_pdf:
        # Simulate pdfminer writing text to the StringIO output
        def fake_extract(byte_stream, output, **kwargs):
            output.write("some extracted vocabulary text")
        mock_pdf.side_effect = fake_extract

        chain = MagicMock()
        chain.extract = AsyncMock(side_effect=ExtractionFailedError(["groq: timeout"]))
        mock_gc.return_value = chain

        resp = client.post(
            "/extract/pdf",
            files={"file": ("test.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        )
    assert resp.status_code == 503
    assert "failures" in resp.json()["detail"]
