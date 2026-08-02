"""Validate and store original bytes; device-local URIs never enter the parser."""
import hashlib
import io
import os
import tempfile
from pathlib import Path

from ingestion import settings


def inspect_asset(data: bytes, declared_mime: str) -> tuple[str, int]:
    if not data or len(data) > settings.MAX_UPLOAD_BYTES:
        raise ValueError("Upload must contain 1 byte to 20 MB")
    if declared_mime == "text/plain":
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("Pasted text must be valid UTF-8") from exc
        if not text.strip() or len(text) > 100_000 or "\x00" in text:
            raise ValueError("Pasted text must contain 1 to 100,000 readable characters")
        return "text/plain", 1
    if data.startswith(b"%PDF-"):
        import fitz
        try:
            with fitz.open(stream=data, filetype="pdf") as doc:
                if doc.needs_pass:
                    raise ValueError("Password-protected PDFs are not supported")
                if not 1 <= doc.page_count <= settings.MAX_PAGES:
                    raise ValueError("PDF must contain between 1 and 100 pages")
                return "application/pdf", doc.page_count
        except (RuntimeError, fitz.FileDataError) as exc:
            raise ValueError("Invalid PDF file") from exc
    from PIL import Image, UnidentifiedImageError
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Supported images: JPEG, PNG, WebP")
            if img.width * img.height > settings.MAX_IMAGE_PIXELS:
                raise ValueError("Image exceeds 20 megapixels")
            mime = Image.MIME[img.format]
            img.verify()
            return mime, 1
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Unsupported or invalid file; upload a PDF or image") from exc


def store_asset(data: bytes) -> tuple[str, str]:
    digest = hashlib.sha256(data).hexdigest()
    root = settings.DATA_DIR / "sources"
    root.mkdir(parents=True, exist_ok=True)
    destination = root / digest
    if not destination.exists():
        fd, temporary = tempfile.mkstemp(prefix="upload-", dir=root)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temporary, destination)
        finally:
            Path(temporary).unlink(missing_ok=True)
    return digest, str(destination)
