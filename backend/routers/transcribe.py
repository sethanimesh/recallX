import asyncio
import base64
import json
import os
import tempfile
from pathlib import Path

import mlx_whisper
from dotenv import load_dotenv
from fastapi import APIRouter, WebSocket

router = APIRouter()

_ENV_FILE = Path(__file__).resolve().parents[1] / ".env.local"

# Keep HF auth available for mlx_whisper model downloads even when only HF_API_KEY is set.
load_dotenv(dotenv_path=str(_ENV_FILE))
if not os.environ.get("HF_TOKEN") and os.environ.get("HF_API_KEY"):
    os.environ["HF_TOKEN"] = os.environ["HF_API_KEY"]

_MODEL = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-base")


@router.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    audio_b64: str | None = None

    while True:
        frame = await websocket.receive_text()
        if frame == "END":
            break
        audio_b64 = frame

    if audio_b64 is None:
        await websocket.send_text(json.dumps({"error": "transcription_failed"}))
        await websocket.close()
        return

    tmp_path = None
    try:
        audio_bytes = base64.b64decode(audio_b64)
        fd, tmp_path = tempfile.mkstemp(suffix=".m4a")
        os.close(fd)
        with open(tmp_path, "wb") as f:
            f.write(audio_bytes)

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, lambda: mlx_whisper.transcribe(tmp_path, path_or_hf_repo=_MODEL)
        )
        transcript = result.get("text", "").strip()
        await websocket.send_text(json.dumps({"transcript": transcript}))
    except Exception:
        await websocket.send_text(json.dumps({"error": "transcription_failed"}))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        await websocket.close()
