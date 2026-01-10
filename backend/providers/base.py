from __future__ import annotations
from typing import Literal, Protocol, runtime_checkable
from pydantic import BaseModel


class ExtractedWord(BaseModel):
    word: str
    definition: str
    example_sentence: str


class ExtractionRequest(BaseModel):
    input_type: Literal["image", "text"]
    content: str        # base64 string for images, raw text for text
    mime_type: str | None = None   # required when input_type == "image"


@runtime_checkable
class LLMProvider(Protocol):
    name: str
    priority: int
    supports_vision: bool

    async def extract_words(self, req: ExtractionRequest) -> list[ExtractedWord]:
        ...
