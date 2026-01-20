"""Tests for /tags endpoints."""
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


def _create_word(word_id="w1", word="ephemeral"):
    client.post("/words", json={
        "id": word_id, "word": word, "definition": "def",
        "example_sentence": "ex", "created_at": 1000, "updated_at": 1000,
    })


# --- POST /tags ---

def test_create_tag_returns_201():
    resp = client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == "t1"
    assert data["name"] == "GRE Prep"


def test_create_tag_duplicate_name_returns_409():
    client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    resp = client.post("/tags", json={"id": "t2", "name": "gre prep"})
    assert resp.status_code == 409


# --- GET /tags ---

def test_get_tags_empty():
    resp = client.get("/tags")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_tags_returns_word_count():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    client.post("/words/w1/tags/t1")
    resp = client.get("/tags")
    assert resp.json()[0]["word_count"] == 1


def test_get_tags_word_count_zero_when_no_words():
    client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    resp = client.get("/tags")
    assert resp.json()[0]["word_count"] == 0


# --- PATCH /tags/{id} ---

def test_patch_tag_renames():
    client.post("/tags", json={"id": "t1", "name": "Old"})
    resp = client.patch("/tags/t1", json={"name": "New"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New"


def test_patch_tag_name_collision_returns_409():
    client.post("/tags", json={"id": "t1", "name": "Alpha"})
    client.post("/tags", json={"id": "t2", "name": "Beta"})
    resp = client.patch("/tags/t2", json={"name": "alpha"})
    assert resp.status_code == 409


def test_patch_tag_not_found_returns_404():
    resp = client.patch("/tags/nonexistent", json={"name": "x"})
    assert resp.status_code == 404


# --- DELETE /tags/{id} ---

def test_delete_tag_returns_204():
    client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    resp = client.delete("/tags/t1")
    assert resp.status_code == 204


def test_delete_tag_removes_from_get():
    client.post("/tags", json={"id": "t1", "name": "GRE Prep"})
    client.delete("/tags/t1")
    assert client.get("/tags").json() == []


# --- POST /words/{id}/tags/{tag_id} ---

def test_add_tag_to_word_returns_204():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE"})
    resp = client.post("/words/w1/tags/t1")
    assert resp.status_code == 204


def test_add_tag_to_word_is_idempotent():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE"})
    client.post("/words/w1/tags/t1")
    resp = client.post("/words/w1/tags/t1")
    assert resp.status_code == 204


def test_add_tag_shows_in_get_words():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE"})
    client.post("/words/w1/tags/t1")
    words = client.get("/words").json()
    assert words[0]["tags"][0]["name"] == "GRE"


# --- DELETE /words/{id}/tags/{tag_id} ---

def test_remove_tag_from_word_returns_204():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE"})
    client.post("/words/w1/tags/t1")
    resp = client.delete("/words/w1/tags/t1")
    assert resp.status_code == 204


def test_remove_tag_from_word_removes_association():
    _create_word()
    client.post("/tags", json={"id": "t1", "name": "GRE"})
    client.post("/words/w1/tags/t1")
    client.delete("/words/w1/tags/t1")
    words = client.get("/words").json()
    assert words[0]["tags"] == []
