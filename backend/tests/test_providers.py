"""Tests for GET /providers endpoint."""
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_providers_returns_configured_providers(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OLLAMA_API_KEY", raising=False)
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)
    monkeypatch.delenv("HF_API_KEY", raising=False)

    resp = client.get("/providers")
    assert resp.status_code == 200
    data = resp.json()
    assert set(data["providers"]) == {"groq", "gemini"}


def test_providers_returns_empty_when_no_keys_set(monkeypatch):
    for env_var in ["GROQ_API_KEY", "OPENROUTER_API_KEY", "OLLAMA_API_KEY",
                    "GEMINI_API_KEY", "MISTRAL_API_KEY", "HF_API_KEY"]:
        monkeypatch.delenv(env_var, raising=False)

    resp = client.get("/providers")
    assert resp.status_code == 200
    assert resp.json()["providers"] == []


def test_providers_preserves_order(monkeypatch):
    for env_var in ["GROQ_API_KEY", "OPENROUTER_API_KEY", "OLLAMA_API_KEY",
                    "GEMINI_API_KEY", "MISTRAL_API_KEY", "HF_API_KEY"]:
        monkeypatch.setenv(env_var, "key")

    resp = client.get("/providers")
    assert resp.status_code == 200
    assert resp.json()["providers"] == ["groq", "openrouter", "ollama", "gemini", "mistral", "huggingface"]
