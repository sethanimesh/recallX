"""Single-word lookup compatibility. Documents use durable ingestion jobs."""
import asyncio
import logging
from fastapi import APIRouter, HTTPException, UploadFile, File
from providers.base import ExtractionRequest, ExtractedWord
from providers.chain import ProviderChain, ExtractionFailedError

logger = logging.getLogger(__name__)
router = APIRouter()
_chain: ProviderChain | None = None


def get_chain() -> ProviderChain:
    global _chain
    if _chain is None:
        _chain = ProviderChain()
    return _chain


@router.post("/extract", response_model=list[ExtractedWord])
async def extract_words(request: ExtractionRequest) -> list[ExtractedWord]:
    if request.input_type != "word":
        raise HTTPException(410, "Document extraction moved to POST /ingestion/jobs. Upload original file bytes as multipart data.")
    if not request.content.strip() or len(request.content) > 200:
        raise HTTPException(422, "Word lookup requires 1 to 200 characters")
    try:
        return (await asyncio.wait_for(get_chain().extract(request), timeout=90))[:5]
    except asyncio.TimeoutError as exc:
        raise HTTPException(503, "Word lookup timed out") from exc
    except ExtractionFailedError as exc:
        raise HTTPException(503, detail={"error": "All providers failed", "failures": exc.failures}) from exc


@router.post("/extract/pdf")
async def extract_pdf(file: UploadFile = File(...)):
    raise HTTPException(410, "PDF extraction moved to POST /ingestion/jobs. Upload original PDF bytes as multipart data.")
