from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, AliasChoices, model_validator


Decision = Literal['correct', 'partial', 'incorrect', 'uncertain']


class Concept(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=1000)
    weight: float = Field(default=1, gt=0, le=100)
    required: bool = True
    accepted_alternatives: list[str] = Field(default_factory=list, max_length=8)
    qualifiers: list[str] = Field(default_factory=list, max_length=8)
    misconceptions: list[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode='after')
    def bounded_strings(self):
        for value in self.accepted_alternatives + self.qualifiers + self.misconceptions:
            if not value.strip() or len(value) > 1000:
                raise ValueError('Concept alternatives, qualifiers and misconceptions must be 1–1000 characters')
        return self


class RubricInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    operation_id: UUID | None = None
    content_revision: int = Field(ge=1)
    reference_language: Literal['en', 'hi', 'hi-Latn'] = 'en'
    concepts: list[Concept] = Field(min_length=1, max_length=16)

    @model_validator(mode='after')
    def unique_concepts(self):
        if len({c.id for c in self.concepts}) != len(self.concepts):
            raise ValueError('Concept IDs must be unique')
        if not any(c.required for c in self.concepts):
            raise ValueError('At least one concept must be required')
        return self


class AssessmentRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    item_id: str = Field(min_length=1, max_length=100)
    answer: str = Field(max_length=12000, validation_alias=AliasChoices('answer', 'user_answer'))
    attempt_id: UUID
    content_revision: int = Field(ge=1)
    language: str = Field(default='en', max_length=30)
    assisted: bool = False


class ConceptResult(BaseModel):
    concept_id: str
    text: str
    weight: float
    required: bool
    alignment: float
    entailment: float
    neutrality: float
    contradiction: float
    support: float
    evidence_span: str
    contradiction_span: str | None = None
    qualifier_support: list[dict] = Field(default_factory=list)
    misconception_support: list[dict] = Field(default_factory=list)


class AssessmentResult(BaseModel):
    id: str
    assessment_id: str
    item_id: str
    mode: Literal['recall', 'tutor'] = 'recall'
    content_revision: int
    rubric_revision: int | None = None
    decision: Decision = 'uncertain'
    feedback: str
    reason: str
    coverage: float | None = None
    confidence: float | None = None
    experimental: bool = False
    assisted: bool = False
    concept_results: list[ConceptResult] = Field(default_factory=list)
    versions: dict[str, str | None]


class RubricRecord(RubricInput):
    id: str
    item_id: str
    revision: int
    status: Literal['draft','approved','retired']
    created_at: int
    approved_at: int | None = None
