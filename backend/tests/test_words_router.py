"""Tests for /words endpoints."""
import sqlite3
import uuid
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


def test_patch_word_deleted_sense_preserves_tombstone_and_updates():
    client.post("/words", json=_word_payload(id="w1", word="first"))
    client.delete("/words/w1")  # soft-delete w1
    client.post("/words", json=_word_payload(id="w2", word="second"))

    resp = client.patch("/words/w2", json={"word": "first"})
    assert resp.status_code == 200
    assert resp.json()["word"] == "First"

    # Historical item identity must survive reuse of its spelling.
    with sqlite3.connect(database._DEFAULT_DB_PATH) as conn:
        rows = conn.execute("SELECT deleted_at FROM words WHERE id = ?", ("w1",)).fetchall()
    assert len(rows) == 1 and rows[0][0] is not None


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


def test_word_edit_lost_ack_replays_original_receipt_without_overwriting_later_edit():
    client.post('/words', json=_word_payload())
    headers={'X-Operation-ID':str(uuid.uuid4())}
    edit={'definition':'Short-lived.', 'expected_content_revision':1}
    first=client.patch('/words/w1', json=edit, headers=headers)
    assert first.status_code==200
    later=client.patch('/words/w1', json={'definition':'Lasting only briefly.', 'expected_content_revision':2})
    assert later.json()['content_revision']==3
    assert client.patch('/words/w1', json=edit, headers=headers).json()==first.json()
    assert client.get('/words').json()[0]['definition']=='Lasting only briefly.'
    assert client.patch('/words/w1', json={**edit,'definition':'Different.'}, headers=headers).status_code==409
    assert client.patch('/words/missing', json=edit, headers=headers).status_code==409
    with database.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM item_revisions WHERE item_id=?',('w1',)).fetchone()[0]==3
        operation=conn.execute('SELECT payload_json FROM operations WHERE id=?',(headers['X-Operation-ID'],)).fetchone()[0]
        assert 'sha256' in operation


def test_word_delete_is_revision_checked_and_uuid_idempotent():
    client.post('/words', json=_word_payload())
    client.patch('/words/w1', json={'definition':'Updated definition.'})
    headers={'X-Operation-ID':str(uuid.uuid4())}
    assert client.delete('/words/w1?expected_content_revision=1', headers=headers).status_code==409
    first=client.delete('/words/w1?expected_content_revision=2', headers=headers)
    assert first.status_code==200
    assert client.delete('/words/w1?expected_content_revision=2', headers=headers).json()==first.json()
    assert client.delete('/words/w1?expected_content_revision=1', headers=headers).status_code==409
    assert client.delete('/words/missing?expected_content_revision=2', headers=headers).status_code==409


def test_word_edit_and_operation_receipt_roll_back_together(monkeypatch):
    from services.library_operations import LibraryOperation
    client.post('/words', json=_word_payload())
    def interrupted(*_):
        raise RuntimeError('Interrupted receipt write')
    monkeypatch.setattr(LibraryOperation,'remember',interrupted)
    with pytest.raises(RuntimeError, match='Interrupted receipt write'):
        client.patch('/words/w1', json={'definition':'Should roll back.'}, headers={'X-Operation-ID':str(uuid.uuid4())})
    with database.connect() as conn:
        current=conn.execute('SELECT * FROM words WHERE id=?',('w1',)).fetchone()
        assert current['content_revision']==1
        assert current['definition']==_word_payload()['definition']
        assert conn.execute('SELECT COUNT(*) FROM item_revisions WHERE item_id=?',('w1',)).fetchone()[0]==1
        assert conn.execute('SELECT COUNT(*) FROM rubrics WHERE item_id=?',('w1',)).fetchone()[0]==1


def test_word_create_uuid_replays_original_payload_and_rejects_reuse():
    headers={'X-Operation-ID':str(uuid.uuid4())}
    first=client.post('/words', json=_word_payload(), headers=headers)
    assert first.status_code==201
    assert client.post('/words', json=_word_payload(), headers=headers).json()==first.json()
    assert client.post('/words', json=_word_payload(mnemonic='Changed request'), headers=headers).status_code==409
    assert client.post('/words', json=_word_payload(id='w2'), headers=headers).status_code==409


def test_mnemonic_lost_ack_reuses_receipt_without_repeating_generation(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from routers import words
    client.post('/words', json=_word_payload())
    generate=AsyncMock(return_value='A brief rainbow.')
    monkeypatch.setattr(words,'get_chain',lambda:SimpleNamespace(generate_mnemonic=generate))
    headers={'X-Operation-ID':str(uuid.uuid4())}
    first=client.post('/words/w1/generate-mnemonic',headers=headers)
    assert first.status_code==200
    client.patch('/words/w1',json={'mnemonic':'My own memory aid.'})
    assert client.post('/words/w1/generate-mnemonic',headers=headers).json()==first.json()
    assert client.get('/words').json()[0]['mnemonic']=='My own memory aid.'
    assert generate.await_count==1
