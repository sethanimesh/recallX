import logging
from io import BytesIO, StringIO

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
    try:
        return await get_chain().extract(request)
    except ExtractionFailedError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "All providers failed", "failures": e.failures},
        )


@router.post("/extract/pdf", response_model=list[ExtractedWord])
async def extract_pdf(file: UploadFile = File(...)) -> list[ExtractedWord]:
    from pdfminer.high_level import extract_text_to_fp
    from pdfminer.layout import LAParams

    try:
        content = await file.read()
        output = StringIO()
        extract_text_to_fp(
            BytesIO(content), output, laparams=LAParams(), output_type="text", codec=None,
        )
        text = output.getvalue().strip()
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"PDF parsing failed: {e}")

    if not text:
        raise HTTPException(status_code=422, detail="No text extracted from PDF")

    req = ExtractionRequest(input_type="text", content=text)
    try:
        return await get_chain().extract(req)
    except ExtractionFailedError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "All providers failed", "failures": e.failures},
        )
