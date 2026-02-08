import base64
import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _fake_audio_b64() -> str:
    return base64.b64encode(b"fake-audio-bytes").decode()


def test_transcribe_success():
    fake_result = {"text": "  eloquent  "}
    with patch("routers.transcribe.mlx_whisper") as mock_whisper:
        mock_whisper.transcribe.return_value = fake_result
        with client.websocket_connect("/ws/transcribe") as ws:
            ws.send_text(_fake_audio_b64())
            ws.send_text("END")
            data = json.loads(ws.receive_text())
    assert data == {"transcript": "eloquent"}
    mock_whisper.transcribe.assert_called_once()


def test_transcribe_empty_audio_returns_empty_transcript():
    fake_result = {"text": "   "}
    with patch("routers.transcribe.mlx_whisper") as mock_whisper:
        mock_whisper.transcribe.return_value = fake_result
        with client.websocket_connect("/ws/transcribe") as ws:
            ws.send_text(_fake_audio_b64())
            ws.send_text("END")
            data = json.loads(ws.receive_text())
    assert data == {"transcript": ""}


def test_transcribe_error_returns_error_payload():
    with patch("routers.transcribe.mlx_whisper") as mock_whisper:
        mock_whisper.transcribe.side_effect = RuntimeError("model error")
        with client.websocket_connect("/ws/transcribe") as ws:
            ws.send_text(_fake_audio_b64())
            ws.send_text("END")
            data = json.loads(ws.receive_text())
    assert data == {"error": "transcription_failed"}
