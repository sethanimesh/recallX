import asyncio
import base64
import json
import os
import tempfile

import mlx_whisper
from fastapi import APIRouter, WebSocket

router = APIRouter()

_MODEL = "mlx-community/whisper-base.en-mlx"


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
