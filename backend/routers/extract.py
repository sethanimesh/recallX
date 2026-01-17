import logging
from io import BytesIO, StringIO

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from providers.base import ExtractionRequest, ExtractedWord
from providers.chain import ProviderChain, ExtractionFailedError
import database

logger = logging.getLogger(__name__)
router = APIRouter()
_chain: ProviderChain | None = None


class ExtractedWordWithDuplicate(ExtractedWord):
    duplicate: bool


def get_chain() -> ProviderChain:
    global _chain
    if _chain is None:
        _chain = ProviderChain()
    return _chain


def _attach_duplicates(words: list[ExtractedWord]) -> list[ExtractedWordWithDuplicate]:
    result = []
    for w in words:
        inserted = database.insert_word(w.word)
        result.append(
            ExtractedWordWithDuplicate(
                word=w.word,
                definition=w.definition,
                example_sentence=w.example_sentence,
                duplicate=not inserted,
            )
        )
    return result


@router.post("/extract", response_model=list[ExtractedWordWithDuplicate])
async def extract_words(request: ExtractionRequest) -> list[ExtractedWordWithDuplicate]:
    try:
        words = await get_chain().extract(request)
        return _attach_duplicates(words)
    except ExtractionFailedError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "All providers failed", "failures": e.failures},
        )


@router.post("/extract/pdf", response_model=list[ExtractedWordWithDuplicate])
async def extract_pdf(file: UploadFile = File(...)) -> list[ExtractedWordWithDuplicate]:
    from pdfminer.high_level import extract_text_to_fp
    from pdfminer.layout import LAParams

    try:
        content = await file.read()
        output = StringIO()
        extract_text_to_fp(
            BytesIO(content),
            output,
            laparams=LAParams(),
            output_type="text",
            codec=None,
        )
        text = output.getvalue().strip()
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"PDF parsing failed: {e}")

    if not text:
        raise HTTPException(status_code=422, detail="No text extracted from PDF")

    req = ExtractionRequest(input_type="text", content=text)
    try:
        words = await get_chain().extract(req)
        return _attach_duplicates(words)
    except ExtractionFailedError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "All providers failed", "failures": e.failures},
        )
