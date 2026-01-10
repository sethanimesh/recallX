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
    return [ExtractedWord(**item) for item in data]
