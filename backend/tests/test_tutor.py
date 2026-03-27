from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from main import app
from providers.base import TutorChatResponse

client = TestClient(app)


def _tutor_payload(
    word="obdurate",
    stored_definition="stubborn",
    stored_example="he was obdurate",
    user_answer="stubborn",
    history=None,
    is_retry=False,
):
    if history is None:
        history = []
    return {
        "word": word,
        "stored_definition": stored_definition,
        "stored_example": stored_example,
        "user_answer": user_answer,
        "history": history,
        "is_retry": is_retry,
    }


def test_tutor_chat_success():
    with patch("routers.tutor.get_chain") as mock_gc:
        chain = MagicMock()
        chain.tutor_chat = AsyncMock(
            return_value=TutorChatResponse(
                response="Excellent! That's correct.",
                evaluation="correct",
                hint_provided=False,
            )
        )
        mock_gc.return_value = chain

        payload = _tutor_payload(
            word="obdurate",
            stored_definition="stubborn",
            user_answer="stubborn person",
            history=[{"role": "user", "content": "hello"}],
            is_retry=True,
        )
        resp = client.post("/tutor/chat", json=payload)

    assert resp.status_code == 200
    data = resp.json()
    assert data["evaluation"] == "correct"
    assert data["response"] == "Excellent! That's correct."
    assert data["hint_provided"] is False

    chain.tutor_chat.assert_awaited_once_with(
        word="obdurate",
        stored_definition="stubborn",
        stored_example="he was obdurate",
        user_answer="stubborn person",
        history=[{"role": "user", "content": "hello"}],
        is_retry=True,
    )


def test_tutor_chat_503_when_chain_fails():
    from providers.chain import ExtractionFailedError

    with patch("routers.tutor.get_chain") as mock_gc:
        chain = MagicMock()
        chain.tutor_chat = AsyncMock(
            side_effect=ExtractionFailedError(["ollama: rate limit"])
        )
        mock_gc.return_value = chain

        resp = client.post("/tutor/chat", json=_tutor_payload())

    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert detail["error"] == "All providers failed"
    assert "failures" in detail


def test_tutor_speak_success():
    with patch("routers.tutor.edge_tts.Communicate") as mock_comm:
        instance = MagicMock()
        async def mock_stream():
            yield {"type": "audio", "data": b"fake audio bytes"}
        instance.stream = mock_stream
        mock_comm.return_value = instance

        resp = client.get("/tutor/speak?text=hello")
    
    assert resp.status_code == 200
    assert resp.content == b"fake audio bytes"
