from typing import Literal
from pydantic import BaseModel


class ExtractRequest(BaseModel):
    source_type: Literal["image", "text"]
    content: str


class ExtractedWord(BaseModel):
    word: str
    definition: str
    example_sentence: str


class ExtractResponse(BaseModel):
    words: list[ExtractedWord]
