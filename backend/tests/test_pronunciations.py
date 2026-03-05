from unittest.mock import Mock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import pronunciations


app = FastAPI()
app.include_router(pronunciations.router)
client = TestClient(app)


def _response(status_code: int, payload):
    response = Mock()
    response.status_code = status_code
    response.json.return_value = payload
    return response


def test_pronunciation_returns_us_audio_when_available():
    payload = [
        {
            "word": "hello",
            "phonetics": [
                {"audio": "https://audio.example/hello-uk.mp3"},
                {"audio": "https://audio.example/hello-us.mp3"},
            ],
        }
    ]
    with patch("routers.pronunciations.httpx.get", return_value=_response(200, payload)):
        resp = client.get("/pronunciations/hello")

    assert resp.status_code == 200
    assert resp.json() == {
        "word": "hello",
        "audio_url": "https://audio.example/hello-us.mp3",
        "source": "dictionaryapi.dev",
        "accent": "us",
    }


def test_pronunciation_skips_empty_audio_fields():
    payload = [{"word": "test", "phonetics": [{"audio": ""}, {"audio": "  "}, {"audio": "https://audio.example/test.mp3"}]}]
    with patch("routers.pronunciations.httpx.get", return_value=_response(200, payload)):
        resp = client.get("/pronunciations/test")

    assert resp.status_code == 200
    assert resp.json()["audio_url"] == "https://audio.example/test.mp3"


def test_pronunciation_returns_404_when_no_audio_exists():
    payload = [{"word": "obscure", "phonetics": [{"text": "/x/"}]}]
    with patch("routers.pronunciations.httpx.get", return_value=_response(200, payload)):
        resp = client.get("/pronunciations/obscure")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Pronunciation not available"


def test_pronunciation_handles_provider_network_errors():
    with patch("routers.pronunciations.httpx.get", side_effect=httpx.ConnectError("offline")):
        resp = client.get("/pronunciations/hello")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Pronunciation not available"
