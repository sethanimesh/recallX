"""Tests for /words endpoints."""
import sqlite3
import pytest
from fastapi.testclient import TestClient
import database
from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    path = str(tmp_path / "test.sqlite")
    monkeypatch.setattr(database, "_DEFAULT_DB_PATH", path)
    database.init_db(db_path=path)


def _word_payload(**overrides):
    base = {
        "id": "w1",
        "word": "ephemeral",
        "definition": "Lasting for a very short time.",
        "example_sentence": "The joy was ephemeral.",
        "source_type": None,
        "created_at": 1713600000000,
        "updated_at": 1713600000000,
    }
    return {**base, **overrides}


# --- POST /words ---

def test_create_word_returns_201():
    resp = client.post("/words", json=_word_payload())
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == "w1"
    assert data["word"] == "Ephemeral"
    assert data["tags"] == []


def test_create_word_duplicate_returns_409():
    client.post("/words", json=_word_payload())
    resp = client.post("/words", json=_word_payload(id="w2"))
    assert resp.status_code == 409


def test_create_word_duplicate_case_insensitive():
    client.post("/words", json=_word_payload(word="Ephemeral"))
    resp = client.post("/words", json=_word_payload(id="w2", word="ephemeral"))
    assert resp.status_code == 409


def test_create_word_stores_source_type():
    resp = client.post("/words", json=_word_payload(source_type="image"))
    assert resp.json()["source_type"] == "image"


# --- GET /words ---

def test_get_words_empty():
    resp = client.get("/words")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_words_returns_created_word():
    client.post("/words", json=_word_payload())
    resp = client.get("/words")
    assert len(resp.json()) == 1
    assert resp.json()[0]["word"] == "Ephemeral"


def test_create_word_capitalizes_each_word_before_storing():
    resp = client.post("/words", json=_word_payload(word="ice cream"))
    assert resp.status_code == 201
    assert resp.json()["word"] == "Ice Cream"

    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        stored_word = conn.execute("SELECT word FROM words WHERE id = ?", ("w1",)).fetchone()[0]
    assert stored_word == "Ice Cream"


def test_get_words_excludes_soft_deleted():
    client.post("/words", json=_word_payload())
    client.delete("/words/w1")
    resp = client.get("/words")
    assert resp.json() == []


# --- PATCH /words/{id} ---

def test_patch_word_updates_word():
    client.post("/words", json=_word_payload())
    resp = client.patch("/words/w1", json={"word": "fleeting"})
    assert resp.status_code == 200
    assert resp.json()["word"] == "Fleeting"


def test_patch_word_duplicate_word_returns_409():
    client.post("/words", json=_word_payload(id="w1", word="first"))
    client.post("/words", json=_word_payload(id="w2", word="second"))
    resp = client.patch("/words/w2", json={"word": "first"})
    assert resp.status_code == 409


def test_patch_word_duplicate_soft_deleted_word_hard_deletes_and_updates():
    client.post("/words", json=_word_payload(id="w1", word="first"))
    client.delete("/words/w1")  # soft-delete w1
    client.post("/words", json=_word_payload(id="w2", word="second"))

    resp = client.patch("/words/w2", json={"word": "first"})
    assert resp.status_code == 200
    assert resp.json()["word"] == "First"

    # Check that w1 was hard deleted
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        rows = conn.execute("SELECT id FROM words WHERE id = ?", ("w1",)).fetchall()
    assert len(rows) == 0


def test_patch_word_updates_definition():
    client.post("/words", json=_word_payload())
    resp = client.patch("/words/w1", json={"definition": "Short-lived."})
    assert resp.status_code == 200
    assert resp.json()["definition"] == "Short-lived."


def test_patch_word_updates_example_sentence():
    client.post("/words", json=_word_payload())
    resp = client.patch("/words/w1", json={"example_sentence": "New example."})
    assert resp.status_code == 200
    assert resp.json()["example_sentence"] == "New example."


def test_patch_word_not_found_returns_404():
    resp = client.patch("/words/nonexistent", json={"definition": "x"})
    assert resp.status_code == 404


# --- DELETE /words/{id} ---

def test_delete_word_returns_200():
    client.post("/words", json=_word_payload())
    resp = client.delete("/words/w1")
    assert resp.status_code == 200


def test_delete_word_sets_deleted_at():
    client.post("/words", json=_word_payload())
    client.delete("/words/w1")
    resp = client.get("/words")
    assert resp.json() == []


def test_delete_word_not_found_returns_404():
    resp = client.delete("/words/nonexistent")
    assert resp.status_code == 404
