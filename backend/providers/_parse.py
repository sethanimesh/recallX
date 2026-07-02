import json
import re
from providers.base import ExtractedWord


def parse_llm_response(text: str) -> list[ExtractedWord]:
    """Extract JSON array from LLM response and validate into ExtractedWord list."""
    # Strip markdown code fences if present
    text = re.sub(r"```(?:json)?\s*", "", text).strip()
    
    # Try parsing the whole text first
    try:
        data = json.loads(text)
        if isinstance(data, dict) and "words" in data:
            data = data["words"]
    except json.JSONDecodeError:
        # Fallback: find the first { or [ and the last } or ]
        start_obj = text.find('{')
        end_obj = text.rfind('}')
        start_arr = text.find('[')
        end_arr = text.rfind(']')
        
        # Determine whether to parse as an object or an array based on which comes first
        if start_obj != -1 and (start_arr == -1 or start_obj < start_arr):
            # Parse as object
            if end_obj == -1:
                raise ValueError("Unmatched '{' in response")
            json_str = text[start_obj:end_obj+1]
            data = json.loads(json_str)
            if isinstance(data, dict) and "words" in data:
                data = data["words"]
        elif start_arr != -1:
            # Parse as array
            if end_arr == -1:
                raise ValueError("Unmatched '[' in response")
            json_str = text[start_arr:end_arr+1]
            data = json.loads(json_str)
        else:
            raise ValueError(f"No JSON object or array found in response: {text[:200]}")

    if not isinstance(data, list):
        raise ValueError("LLM response JSON did not contain an array of words")
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
