"""Tests for /tags endpoints."""
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


# --- POST /tags/{source_tag_id}/merge ---

def test_merge_tag_moves_source_words_to_target():
    _create_word("w1", "alpha")
    _create_word("w2", "beta")
    client.post("/tags", json={"id": "source", "name": "Source"})
    client.post("/tags", json={"id": "target", "name": "Target"})
    client.post("/words/w1/tags/source")
    client.post("/words/w2/tags/target")

    resp = client.post("/tags/source/merge", json={"target_tag_id": "target"})

    assert resp.status_code == 200
    assert resp.json()["id"] == "target"
    assert resp.json()["word_count"] == 2
    words = client.get("/words").json()
    tags_by_word = {word["id"]: [tag["id"] for tag in word["tags"]] for word in words}
    assert tags_by_word["w1"] == ["target"]
    assert tags_by_word["w2"] == ["target"]


def test_merge_tag_dedupes_words_already_on_target():
    _create_word("w1", "alpha")
    client.post("/tags", json={"id": "source", "name": "Source"})
    client.post("/tags", json={"id": "target", "name": "Target"})
    client.post("/words/w1/tags/source")
    client.post("/words/w1/tags/target")

    resp = client.post("/tags/source/merge", json={"target_tag_id": "target"})

    assert resp.status_code == 200
    assert resp.json()["word_count"] == 1
    words = client.get("/words").json()
    assert words[0]["tags"] == [{"id": "target", "name": "Target"}]


def test_merge_tag_removes_source_tag():
    client.post("/tags", json={"id": "source", "name": "Source"})
    client.post("/tags", json={"id": "target", "name": "Target"})

    resp = client.post("/tags/source/merge", json={"target_tag_id": "target"})

    assert resp.status_code == 200
    assert [tag["id"] for tag in client.get("/tags").json()] == ["target"]


def test_merge_tag_missing_source_or_target_returns_404():
    client.post("/tags", json={"id": "target", "name": "Target"})

    missing_source = client.post("/tags/missing/merge", json={"target_tag_id": "target"})
    missing_target = client.post("/tags/target/merge", json={"target_tag_id": "missing"})

    assert missing_source.status_code == 404
    assert missing_target.status_code == 404


def test_merge_tag_into_itself_returns_400():
    client.post("/tags", json={"id": "target", "name": "Target"})

    resp = client.post("/tags/target/merge", json={"target_tag_id": "target"})

    assert resp.status_code == 400


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


def test_tag_rename_lost_ack_does_not_undo_later_name():
    client.post('/tags', json={'id':'t1','name':'Original'})
    headers={'X-Operation-ID':str(uuid.uuid4())}
    first=client.patch('/tags/t1', json={'name':'Renamed'}, headers=headers)
    assert first.status_code==200
    client.patch('/tags/t1', json={'name':'Latest'})
    assert client.patch('/tags/t1', json={'name':'Renamed'}, headers=headers).json()==first.json()
    assert client.get('/tags').json()[0]['name']=='Latest'
    assert client.patch('/tags/t1', json={'name':'Collision'}, headers=headers).status_code==409


def test_tag_merge_receipt_survives_source_deletion_and_target_edit():
    _create_word()
    for tag in ('source','target'):
        client.post('/tags', json={'id':tag,'name':tag})
    client.post('/words/w1/tags/source')
    headers={'X-Operation-ID':str(uuid.uuid4())}
    payload={'target_tag_id':'target'}
    first=client.post('/tags/source/merge', json=payload, headers=headers)
    assert first.status_code==200
    client.patch('/tags/target', json={'name':'Later name'})
    assert client.post('/tags/source/merge', json=payload, headers=headers).json()==first.json()
    assert client.post('/tags/source/merge', json={'target_tag_id':'other'}, headers=headers).status_code==409
    assert client.post('/tags/other/merge', json=payload, headers=headers).status_code==409
    assert client.get('/words').json()[0]['tags']==[{'id':'target','name':'Later name'}]


def test_tag_membership_retry_does_not_reverse_a_subsequent_removal():
    _create_word()
    client.post('/tags', json={'id':'t1','name':'Test'})
    add={'X-Operation-ID':str(uuid.uuid4())}
    remove={'X-Operation-ID':str(uuid.uuid4())}
    assert client.post('/words/w1/tags/t1', headers=add).status_code==204
    assert client.delete('/words/w1/tags/t1', headers=remove).status_code==204
    assert client.post('/words/w1/tags/t1', headers=add).status_code==204
    assert client.get('/words').json()[0]['tags']==[]
    assert client.delete('/words/w1/tags/t1', headers=add).status_code==409


def test_tag_creation_and_deletion_replay_uuid_receipts():
    create={'X-Operation-ID':str(uuid.uuid4())}
    remove={'X-Operation-ID':str(uuid.uuid4())}
    payload={'id':'t1','name':'Test'}
    first=client.post('/tags', json=payload, headers=create)
    assert first.status_code==201
    assert client.post('/tags', json=payload, headers=create).json()==first.json()
    assert client.post('/tags', json={**payload,'name':'Other'}, headers=create).status_code==409
    assert client.delete('/tags/t1', headers=remove).status_code==204
    assert client.delete('/tags/t1', headers=remove).status_code==204
    assert client.delete('/tags/missing', headers=remove).status_code==409
    assert client.post('/tags', json=payload, headers={'X-Operation-ID':'not-a-uuid'}).status_code==422


def test_tag_merge_and_receipt_roll_back_together(monkeypatch):
    from services.library_operations import LibraryOperation
    _create_word()
    for tag in ('source','target'):
        client.post('/tags', json={'id':tag,'name':tag})
    client.post('/words/w1/tags/source')
    def interrupted(*_):
        raise RuntimeError('Interrupted receipt write')
    monkeypatch.setattr(LibraryOperation,'remember',interrupted)
    with pytest.raises(RuntimeError,match='Interrupted receipt write'):
        client.post('/tags/source/merge', json={'target_tag_id':'target'}, headers={'X-Operation-ID':str(uuid.uuid4())})
    assert {tag['id'] for tag in client.get('/tags').json()}=={'source','target'}
    assert client.get('/words').json()[0]['tags']==[{'id':'source','name':'source'}]
