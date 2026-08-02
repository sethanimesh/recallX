"""Page-wise native PDF extraction and full local PaddleOCR parsing."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from contextlib import nullcontext

from ingestion import settings


class ParserUnavailable(RuntimeError):
    pass


def _simple_native_layout(blocks):
    # Side-by-side overlapping text regions need the layout model's reading order.
    if len(blocks) > 200:
        return False
    for index, left in enumerate(blocks):
        for right in blocks[index + 1:]:
            vertical_overlap = min(left[3], right[3]) - max(left[1], right[1])
            if vertical_overlap > 4 and (left[2] + 8 < right[0] or right[2] + 8 < left[0]):
                return False
    return True


def paddle_parse(image_bytes: bytes) -> dict:
    from local_runtime import inference_lease
    python = os.getenv("RECALLX_OCR_PYTHON", str(Path(__file__).resolve().parents[1] / ".venv-ocr/bin/python"))
    if not Path(python).is_file():
        raise ParserUnavailable("Local PaddleOCR environment is unavailable; configure RECALLX_OCR_PYTHON")
    with inference_lease() as lease_fd, tempfile.TemporaryDirectory(prefix="recallx-ocr-") as directory:
        input_path = Path(directory) / "page.png"
        output_path = Path(directory) / "result.json"
        input_path.write_bytes(image_bytes)
        try:
            from ingestion.mlx_service import managed_mlx_service
            external_url = os.getenv("RECALLX_MLX_URL")
            acceleration = os.getenv("RECALLX_OCR_ACCELERATOR", "mlx")
            if acceleration not in {"cpu", "mlx"}:
                raise ValueError("RECALLX_OCR_ACCELERATOR must be cpu or mlx")
            service = nullcontext(external_url) if external_url or acceleration == "cpu" else managed_mlx_service(Path(directory), lease_fd)
            with service as mlx_url:
                environment = {**os.environ}
                if mlx_url:
                    environment["RECALLX_MLX_URL"] = mlx_url
                completed = subprocess.run(
                    [python, str(Path(__file__).with_name("paddle_runner.py")), str(input_path), str(output_path)],
                    capture_output=True, text=True, timeout=310, pass_fds=(lease_fd,), env=environment,
                )
        except subprocess.TimeoutExpired as exc:
            raise ParserUnavailable("PaddleOCR page exceeded the 300-second limit") from exc
        if completed.returncode != 0 or not output_path.exists():
            # Full diagnostics stay in worker logs; filenames/tokens are not exposed by the API.
            import logging
            logging.getLogger(__name__).error("PaddleOCR failed: %s", completed.stderr[-4000:])
            raise ParserUnavailable("Local PaddleOCR failed; check model paths and worker logs, then retry")
        return json.loads(output_path.read_text())


def _ocr_page(image_bytes: bytes, number: int, width: float, height: float, metadata: dict, ocr) -> dict:
    from ingestion.storage import store_asset
    preview_hash, _ = store_asset(image_bytes)
    revision = os.getenv("RECALLX_OCR_MODEL_REVISION")
    manifest = Path(__file__).resolve().parents[1] / "models/ocr/revisions.json"
    if not revision and not os.getenv("RECALLX_OCR_MODEL_DIR") and manifest.is_file():
        revision = json.loads(manifest.read_text()).get("PaddleOCR-VL-1.6")
    metadata = {**metadata, "preview_sha256": preview_hash, "pipeline_version": "v1.6", "model_revision": revision or "unverified-local"}
    parsed = ocr(image_bytes)
    metadata["recognition_backend"] = parsed.get("recognition_backend", "controlled-test-provider" if ocr is not paddle_parse else "unknown")
    metadata["raw_parser_output"] = parsed.get("raw")
    blocks = parsed.get("blocks", [])
    if not blocks:
        raise ValueError(f"No document content recognized on page {number}")
    parsed_width = float(parsed.get("width") or width)
    parsed_height = float(parsed.get("height") or height)
    sx, sy = width / parsed_width, height / parsed_height
    for block in blocks:
        bbox = block.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            raise ValueError("OCR result lacks valid bounding boxes")
        block["bbox"] = [bbox[0] * sx, bbox[1] * sy, bbox[2] * sx, bbox[3] * sy]
    return {"page_number": number, "width": width, "height": height, "method": "paddleocr-vl-1.6", "blocks": blocks, "metadata": metadata}


def parse_pages(path: str, mime: str, crop: dict | None = None, skip_pages: set[int] | None = None, ocr=paddle_parse):
    """Yield each completed page, so committed pages survive worker death."""
    skip_pages = skip_pages or set()
    if mime == "text/plain":
        if 1 not in skip_pages:
            text = Path(path).read_text(encoding="utf-8")
            yield {"page_number": 1, "width": 0, "height": 0, "method": "pasted-text", "metadata": {"coordinates": None}, "blocks": [{"kind": "text", "text": text, "bbox": None, "confidence": None}]}
    elif mime == "application/pdf":
        import fitz
        with fitz.open(path) as doc:
            if doc.needs_pass or not 1 <= len(doc) <= settings.MAX_PAGES:
                raise ValueError("Invalid, encrypted, or oversized PDF")
            for index, page in enumerate(doc):
                if index + 1 in skip_pages:
                    continue
                rect = page.rect
                native = [b for b in page.get_text("blocks", sort=True) if len(b) > 6 and b[6] == 0 and b[4].strip()]
                text = "\n".join(b[4] for b in native)
                image_area = sum(fitz.Rect(info["bbox"]).get_area() for info in page.get_image_info())
                has_native = len(text.strip()) >= 40 and "\ufffd" not in text and image_area < rect.get_area() * .3 and _simple_native_layout(native)
                metadata = {"rotation": page.rotation, "coordinates": "page-points", "parser": "pymupdf", "native_character_count": len(text)}
                if has_native:
                    # Rotate unrotated text rectangles into the displayed page coordinate system.
                    blocks = [{"kind": "text", "text": b[4].strip(), "bbox": list(fitz.Rect(b[:4]) * page.rotation_matrix), "confidence": None} for b in native]
                    from ingestion.storage import store_asset
                    preview_scale = min(1.2, (settings.MAX_IMAGE_PIXELS / max(1, rect.get_area())) ** .5)
                    metadata["preview_sha256"], _ = store_asset(page.get_pixmap(matrix=fitz.Matrix(preview_scale, preview_scale), alpha=False).tobytes("png"))
                    yield {"page_number": index + 1, "width": rect.width, "height": rect.height, "method": "native-text", "blocks": blocks, "metadata": metadata}
                else:
                    scale = min(2.0, (settings.MAX_IMAGE_PIXELS / max(1, rect.get_area())) ** .5)
                    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                    yield _ocr_page(pix.tobytes("png"), index + 1, rect.width, rect.height, metadata, ocr)
    elif 1 not in skip_pages:
        from PIL import Image, ImageOps
        with Image.open(path) as original:
            if original.width * original.height > settings.MAX_IMAGE_PIXELS:
                raise ValueError("Image exceeds 20 megapixels")
            img = ImageOps.exif_transpose(original).convert("RGB")
            metadata = {"coordinates": "normalized-image-pixels", "original_width": img.width, "original_height": img.height, "source_exif_orientation": original.getexif().get(274, 1), "crop": crop}
            if crop:
                if abs(crop["originalWidth"] - img.width) > 1 or abs(crop["originalHeight"] - img.height) > 1:
                    raise ValueError("Crop dimensions do not match the source image")
                img = img.crop((round(crop["originX"]), round(crop["originY"]), round(crop["originX"] + crop["width"]), round(crop["originY"] + crop["height"])))
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            result = _ocr_page(buf.getvalue(), 1, img.width, img.height, metadata, ocr)
            if crop:
                for b in result["blocks"]:
                    b["bbox"] = [b["bbox"][0] + crop["originX"], b["bbox"][1] + crop["originY"], b["bbox"][2] + crop["originX"], b["bbox"][3] + crop["originY"]]
                result["width"], result["height"] = metadata["original_width"], metadata["original_height"]
                # Citation boxes are translated back to the normalized original, so preview that frame.
                from ingestion.storage import store_asset
                normalized = ImageOps.exif_transpose(original).convert("RGB")
                preview = io.BytesIO()
                normalized.save(preview, format="PNG")
                result["metadata"]["derivative_sha256"] = result["metadata"]["preview_sha256"]
                result["metadata"]["preview_sha256"], _ = store_asset(preview.getvalue())
            yield result
