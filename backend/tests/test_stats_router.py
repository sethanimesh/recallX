"""Tests for GET /stats/llm endpoint."""
import sqlite3
import time
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

import database
from main import app

client = TestClient(app)


def _seed(tmp_path, rows: list[tuple[str, str, str, int]]) -> str:
    """Insert rows into a temp DB. Each row: (provider, model, task, called_at)."""
    path = str(tmp_path / "test.sqlite")
    database.init_db(db_path=path)
    with sqlite3.connect(path) as conn:
        conn.executemany(
            "INSERT INTO llm_calls (provider, model, task, called_at) VALUES (?, ?, ?, ?)",
            rows,
        )
        conn.commit()
    return path


def test_stats_empty_db(tmp_path):
    path = _seed(tmp_path, [])
    with patch("database._DEFAULT_DB_PATH", path):
        resp = client.get("/stats/llm?period=all")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_calls"] == 0
    assert data["by_provider"] == []
    assert data["calls"] == []


def test_stats_all_period(tmp_path):
    now = int(time.time())
    path = _seed(tmp_path, [
        ("groq", "llama-3.3-70b", "extract", now - 100),
        ("groq", "llama-3.3-70b", "grade", now - 50),
        ("openrouter", "mistral-7b", "extract", now - 10),
    ])
    with patch("database._DEFAULT_DB_PATH", path):
        resp = client.get("/stats/llm?period=all")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_calls"] == 3
    counts = {(r["provider"], r["model"]): r["count"] for r in data["by_provider"]}
    assert counts[("groq", "llama-3.3-70b")] == 2
    assert counts[("openrouter", "mistral-7b")] == 1
    assert len(data["calls"]) == 3
    # calls ordered newest first
    assert data["calls"][0]["called_at"] >= data["calls"][1]["called_at"]


def test_stats_today_period_filters_old(tmp_path):
    from datetime import datetime, timezone
    midnight = int(datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    path = _seed(tmp_path, [
        ("groq", "llama-3.3-70b", "extract", midnight + 60),   # today
        ("groq", "llama-3.3-70b", "grade", midnight - 3600),   # yesterday
    ])
    with patch("database._DEFAULT_DB_PATH", path):
        resp = client.get("/stats/llm?period=today")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_calls"] == 1
    assert data["calls"][0]["task"] == "extract"


def test_stats_week_period(tmp_path):
    now = int(time.time())
    path = _seed(tmp_path, [
        ("groq", "llama-3.3-70b", "extract", now - 3 * 86400),   # 3 days ago — in
        ("groq", "llama-3.3-70b", "grade", now - 8 * 86400),     # 8 days ago — out
    ])
    with patch("database._DEFAULT_DB_PATH", path):
        resp = client.get("/stats/llm?period=week")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_calls"] == 1


def test_stats_month_period(tmp_path):
    now = int(time.time())
    path = _seed(tmp_path, [
        ("groq", "llama-3.3-70b", "extract", now - 15 * 86400),  # 15 days ago — in
        ("groq", "llama-3.3-70b", "grade", now - 31 * 86400),    # 31 days ago — out
    ])
    with patch("database._DEFAULT_DB_PATH", path):
        resp = client.get("/stats/llm?period=month")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_calls"] == 1


def test_stats_calls_capped_at_200(tmp_path):
    now = int(time.time())
    rows = [("groq", "llama-3.3-70b", "extract", now - i) for i in range(250)]
    path = _seed(tmp_path, rows)
    with patch("database._DEFAULT_DB_PATH", path):
        resp = client.get("/stats/llm?period=all")
    assert resp.status_code == 200
    assert len(resp.json()["calls"]) == 200


def test_stats_invalid_period(tmp_path):
    path = _seed(tmp_path, [])
    with patch("database._DEFAULT_DB_PATH", path):
        resp = client.get("/stats/llm?period=invalid")
    assert resp.status_code == 422
