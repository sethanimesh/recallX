import os
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

_PROVIDER_ENV_VARS: list[tuple[str, str]] = [
    ("groq", "GROQ_API_KEY"),
    ("openrouter", "OPENROUTER_API_KEY"),
    ("ollama", "OLLAMA_API_KEY"),
    ("gemini", "GEMINI_API_KEY"),
    ("mistral", "MISTRAL_API_KEY"),
    ("huggingface", "HF_API_KEY"),
]


class ProvidersResponse(BaseModel):
    providers: list[str]


@router.get("/providers", response_model=ProvidersResponse)
def list_providers() -> ProvidersResponse:
    available = [name for name, env_var in _PROVIDER_ENV_VARS if os.environ.get(env_var)]
    return ProvidersResponse(providers=available)
