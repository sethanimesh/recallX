from fastapi import APIRouter
from models import ExtractRequest, ExtractResponse, ExtractedWord

router = APIRouter()

_SAMPLE_WORDS = [
    ExtractedWord(
        word="ephemeral",
        definition="Lasting for a very short time.",
        example_sentence="The ephemeral beauty of cherry blossoms draws thousands of visitors each spring.",
    ),
    ExtractedWord(
        word="perspicacious",
        definition="Having a ready insight into things; shrewd.",
        example_sentence="Her perspicacious analysis caught the flaw in the argument immediately.",
    ),
    ExtractedWord(
        word="laconic",
        definition="Using very few words; brief and concise.",
        example_sentence="His laconic reply of 'no' ended the discussion.",
    ),
    ExtractedWord(
        word="sanguine",
        definition="Optimistic, especially in a difficult situation.",
        example_sentence="Despite the setbacks, she remained sanguine about the project's success.",
    ),
    ExtractedWord(
        word="tenacious",
        definition="Not readily letting go; persistent and determined.",
        example_sentence="His tenacious grip on the rope saved him from falling.",
    ),
]


@router.post("/extract", response_model=ExtractResponse)
async def extract_words(request: ExtractRequest) -> ExtractResponse:
    return ExtractResponse(words=_SAMPLE_WORDS)
