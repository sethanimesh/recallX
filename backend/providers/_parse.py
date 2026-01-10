import json
import re
from providers.base import ExtractedWord


def parse_llm_response(text: str) -> list[ExtractedWord]:
    """Extract JSON array from LLM response and validate into ExtractedWord list."""
    # Strip markdown code fences if present
    text = re.sub(r"```(?:json)?\s*", "", text).strip()
    # Find the JSON array
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON array found in response: {text[:200]}")
    data = json.loads(match.group())
    if not isinstance(data, list):
        raise ValueError("LLM response JSON was not an array")
    return [ExtractedWord(**_normalize_item(item)) for item in data]


def _normalize_item(item: object) -> dict[str, str]:
    if isinstance(item, str):
        return {
            "word": item.strip(),
            "definition": "",
            "example_sentence": "",
        }
    if not isinstance(item, dict):
        raise ValueError(f"Invalid extraction item type: {type(item).__name__}")
    word = str(item.get("word", "")).strip()
    if not word:
        raise ValueError("Extraction item missing non-empty 'word'")
    return {
        "word": word,
        "definition": str(item.get("definition", "")).strip(),
        "example_sentence": str(item.get("example_sentence", "")).strip(),
    }
