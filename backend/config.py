import os
from typing import Any
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env.local
env_file = Path(__file__).parent / ".env.local"
load_dotenv(dotenv_path=str(env_file))

_DEFAULT_PRIORITY = "groq, ollama, gemini, mistral, openrouter, huggingface"

_PROVIDER_CONFIGS: dict[str, dict[str, Any]] = {
    "groq": {
        "api_key_env": "GROQ_API_KEY",
        "base_url": "https://api.groq.com/openai/v1",
        "vision_model": "qwen/qwen3.6-27b",
        "text_model": "llama-3.3-70b-versatile",
    },
    "openrouter": {
        "api_key_env": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
        "vision_model": "meta-llama/llama-4-scout",
        "text_model": "google/gemma-4-31b-it:free",
    },
    "ollama": {
        "api_key_env": "OLLAMA_API_KEY",
        "base_url_env": "OLLAMA_BASE_URL",
        "default_base_url": "http://localhost:11434",
        "cloud_base_url": "https://ollama.com",
        "vision_model": "llama3.2-vision",
        "text_model": "llama3.2",
    },
    "gemini": {
        "api_key_env": "GEMINI_API_KEY",
        "model": "gemini-2.5-flash",
    },
    "mistral": {
        "api_key_env": "MISTRAL_API_KEY",
        "base_url": "https://api.mistral.ai/v1",
        "vision_model": "pixtral-large-latest",
        "text_model": "mistral-small-latest",
    },
    "huggingface": {
        "api_key_env": "HF_API_KEY",
        "text_model": "mistralai/Mistral-7B-Instruct-v0.3",
    },
}


def get_provider_order() -> list[str]:
    raw = os.environ.get("PROVIDER_PRIORITY", _DEFAULT_PRIORITY)
    return [p.strip() for p in raw.split(",") if p.strip()]


def get_provider_config(name: str) -> dict[str, Any]:
    cfg = _PROVIDER_CONFIGS.get(name, {}).copy()
    if "api_key_env" in cfg:
        api_key_env = cfg["api_key_env"]
        cfg["api_key"] = os.environ.get(api_key_env) if api_key_env else None
        del cfg["api_key_env"]  # don't expose the env-var name
    if "base_url_env" in cfg:
        explicit_base_url = os.environ.get(cfg["base_url_env"])
        if explicit_base_url:
            cfg["base_url"] = explicit_base_url
        elif cfg.get("api_key") and "cloud_base_url" in cfg:
            cfg["base_url"] = cfg["cloud_base_url"]
        else:
            cfg["base_url"] = cfg.get("default_base_url")
        del cfg["base_url_env"]
        cfg.pop("default_base_url", None)
        cfg.pop("cloud_base_url", None)
    return cfg
