from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


router = APIRouter()

_DICTIONARY_API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en"


class PronunciationRecord(BaseModel):
    word: str
    audio_url: str
    source: str
    accent: str | None = None


def _accent_from_audio_url(audio_url: str) -> str | None:
    lowered = audio_url.lower()
    if "-us." in lowered or "/us/" in lowered:
        return "us"
    if "-uk." in lowered or "/uk/" in lowered:
        return "uk"
    return None


def _normalize_audio_url(audio_url: str) -> str:
    if audio_url.startswith("//"):
        return f"https:{audio_url}"
    return audio_url


def _extract_audio_url(entries: Any) -> tuple[str, str | None] | None:
    if not isinstance(entries, list):
        return None

    candidates: list[tuple[str, str | None]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        for phonetic in entry.get("phonetics", []):
            if not isinstance(phonetic, dict):
                continue
            audio_url = str(phonetic.get("audio") or "").strip()
            if audio_url:
                candidates.append((_normalize_audio_url(audio_url), _accent_from_audio_url(audio_url)))

    if not candidates:
        return None

    for audio_url, accent in candidates:
        if accent == "us":
            return audio_url, accent
    return candidates[0]


@router.get("/pronunciations/{word}", response_model=PronunciationRecord)
def get_pronunciation(word: str) -> PronunciationRecord:
    normalized_word = word.strip()
    if not normalized_word:
        raise HTTPException(status_code=404, detail="Pronunciation not available")

    try:
        response = httpx.get(
            f"{_DICTIONARY_API_BASE}/{quote(normalized_word, safe='')}",
            timeout=5.0,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=404, detail="Pronunciation not available")

    if response.status_code != 200:
        raise HTTPException(status_code=404, detail="Pronunciation not available")

    try:
        result = _extract_audio_url(response.json())
    except ValueError:
        result = None
    if result is None:
        raise HTTPException(status_code=404, detail="Pronunciation not available")

    audio_url, accent = result
    return PronunciationRecord(
        word=normalized_word,
        audio_url=audio_url,
        source="dictionaryapi.dev",
        accent=accent,
    )
