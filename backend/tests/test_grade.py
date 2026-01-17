"""Tests for POST /grade endpoint."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from providers.base import GradeResult

client = TestClient(app)


def _grade_payload(word="ephemeral", user_answer="lasting for a short time", stored_def="lasting for a very short time"):
    return {"word": word, "user_answer": user_answer, "stored_definition": stored_def}


# ---------------------------------------------------------------------------
# Blank answer — no LLM call
# ---------------------------------------------------------------------------

def test_blank_answer_no_llm_call():
    with patch("routers.grade.get_chain") as mock_gc:
        chain = MagicMock()
        chain.grade = AsyncMock()
        mock_gc.return_value = chain

        resp = client.post("/grade", json=_grade_payload(user_answer=""))
    assert resp.status_code == 200
    data = resp.json()
    assert data["correct"] is False
    assert data["feedback"] == "No answer provided."
    chain.grade.assert_not_called()


def test_single_word_answer_calls_llm():
    with patch("routers.grade.get_chain") as mock_gc:
        chain = MagicMock()
        chain.grade = AsyncMock(
            return_value=GradeResult(correct=True, feedback="Close enough.")
        )
        mock_gc.return_value = chain

        resp = client.post("/grade", json=_grade_payload(user_answer="temporary"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["correct"] is True
    assert data["feedback"] == "Close enough."
    chain.grade.assert_awaited_once_with(
        word="ephemeral",
        user_answer="temporary",
        stored_definition="lasting for a very short time",
    )


def test_two_word_answer_calls_llm():
    with patch("routers.grade.get_chain") as mock_gc:
        chain = MagicMock()
        chain.grade = AsyncMock(
            return_value=GradeResult(correct=True, feedback="That works.")
        )
        mock_gc.return_value = chain

        resp = client.post("/grade", json=_grade_payload(user_answer="short lived"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["correct"] is True
    assert data["feedback"] == "That works."
    chain.grade.assert_awaited_once_with(
        word="ephemeral",
        user_answer="short lived",
        stored_definition="lasting for a very short time",
    )


def test_whitespace_only_answer_no_llm_call():
    with patch("routers.grade.get_chain") as mock_gc:
        chain = MagicMock()
        chain.grade = AsyncMock()
        mock_gc.return_value = chain

        resp = client.post("/grade", json=_grade_payload(user_answer="   "))
    assert resp.status_code == 200
    data = resp.json()
    assert data["correct"] is False
    assert data["feedback"] == "No answer provided."
    chain.grade.assert_not_called()


# ---------------------------------------------------------------------------
# LLM returns correct
# ---------------------------------------------------------------------------

def test_correct_answer_stub():
    with patch("routers.grade.get_chain") as mock_gc:
        chain = MagicMock()
        chain.grade = AsyncMock(
            return_value=GradeResult(correct=True, feedback="Great answer!")
        )
        mock_gc.return_value = chain

        resp = client.post("/grade", json=_grade_payload(user_answer="lasting for a short time"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["correct"] is True
    assert data["feedback"] == "Great answer!"


# ---------------------------------------------------------------------------
# LLM returns incorrect
# ---------------------------------------------------------------------------

def test_incorrect_answer_stub():
    with patch("routers.grade.get_chain") as mock_gc:
        chain = MagicMock()
        chain.grade = AsyncMock(
            return_value=GradeResult(correct=False, feedback="Not quite right.")
        )
        mock_gc.return_value = chain

        resp = client.post("/grade", json=_grade_payload(user_answer="this is totally wrong answer"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["correct"] is False
    assert data["feedback"] == "Not quite right."


# ---------------------------------------------------------------------------
# Provider failure → 503
# ---------------------------------------------------------------------------

def test_grade_503_when_all_providers_fail():
    from providers.chain import ExtractionFailedError

    with patch("routers.grade.get_chain") as mock_gc:
        chain = MagicMock()
        chain.grade = AsyncMock(
            side_effect=ExtractionFailedError(["groq: RateLimitError"])
        )
        mock_gc.return_value = chain

        resp = client.post("/grade", json=_grade_payload(user_answer="something correct enough"))
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert detail["error"] == "All providers failed"
    assert "failures" in detail
