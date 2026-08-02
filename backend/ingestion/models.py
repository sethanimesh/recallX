from typing import Literal
from uuid import UUID
from pydantic import BaseModel, Field, model_validator


class Crop(BaseModel):
    originX: float = Field(ge=0)
    originY: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    originalWidth: float = Field(gt=0)
    originalHeight: float = Field(gt=0)

    @model_validator(mode="after")
    def within_image(self):
        if self.originX + self.width > self.originalWidth + 1 or self.originY + self.height > self.originalHeight + 1:
            raise ValueError("Crop exceeds the original image")
        return self


class CandidateDecision(BaseModel):
    id: str
    accept: bool
    reviewed: bool = True
    word: str = Field(min_length=1, max_length=200)
    definition: str = Field(min_length=1, max_length=6000)
    example_sentence: str = Field(default="", max_length=6000)
    mnemonic: str | None = Field(default=None, max_length=6000)
    etymology: str | None = Field(default=None, max_length=6000)
    tag_ids: list[str] = Field(default_factory=list, max_length=30)
    reference_language: Literal["en", "hi", "hi-Latn"] = "en"


class Approval(BaseModel):
    request_id: str = Field(min_length=1, max_length=100)
    candidates: list[CandidateDecision] = Field(min_length=1, max_length=300)
    expected_draft_revision: int | None = Field(default=None, ge=0)


class DraftSave(Approval):
    operation_id: UUID
    expected_revision: int = Field(ge=0)


class JobMutation(BaseModel):
    operation_id: UUID
    expected_revision: int = Field(ge=1)


class TextUpload(BaseModel):
    request_id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=100_000)
    instructions: str = Field(default="", max_length=2000)
    extraction_mode: Literal["general_document", "vocabulary_mcq"] = "general_document"


class BlockCorrection(BaseModel):
    operation_id: UUID
    expected_revision: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=20_000)
