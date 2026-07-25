from __future__ import annotations
from typing import Literal, Protocol, runtime_checkable
from pydantic import BaseModel, model_validator


class ExtractedWord(BaseModel):
    word: str
    definition: str
    example_sentence: str
    mnemonic: str | None = None


class ExtractionResult(BaseModel):
    words: list[ExtractedWord]


class StoryResponse(BaseModel):
    title: str
    content: str


class ExtractionRequest(BaseModel):
    input_type: Literal["image", "text", "word"]
    content: str        # base64 string for images, raw text for text
    mime_type: str | None = None   # required when input_type == "image"
    instructions: str | None = None # optional custom instructions from user

    @model_validator(mode="after")
    def mime_type_required_for_image(self) -> "ExtractionRequest":
        if self.input_type == "image" and self.mime_type is None:
            raise ValueError("mime_type is required when input_type is 'image'")
        return self


@runtime_checkable
class LLMProvider(Protocol):
    name: str
    priority: int
    supports_vision: bool

    async def extract_words(self, req: ExtractionRequest) -> list[ExtractedWord]:
        ...
