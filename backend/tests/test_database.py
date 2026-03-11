"""Tests for database.py — expanded schema."""
import sqlite3
import time
import database


def _fresh(tmp_path) -> str:
    path = str(tmp_path / "test.sqlite")
    database.init_db(db_path=path)
    return path


def test_init_db_creates_words_table(tmp_path):
    path = _fresh(tmp_path)
    with sqlite3.connect(path) as conn:
        info = conn.execute("PRAGMA table_info(words)").fetchall()
    col_names = {row[1] for row in info}
    assert col_names >= {"id", "word", "definition", "example_sentence",
                         "source_type", "created_at", "updated_at", "deleted_at"}


def test_init_db_creates_tags_table(tmp_path):
    path = _fresh(tmp_path)
    with sqlite3.connect(path) as conn:
        info = conn.execute("PRAGMA table_info(tags)").fetchall()
    col_names = {row[1] for row in info}
    assert col_names >= {"id", "name"}


def test_init_db_creates_word_tags_table(tmp_path):
    path = _fresh(tmp_path)
    with sqlite3.connect(path) as conn:
        info = conn.execute("PRAGMA table_info(word_tags)").fetchall()
    col_names = {row[1] for row in info}
    assert col_names >= {"word_id", "tag_id"}


def test_init_db_is_idempotent(tmp_path):
    """Calling init_db twice must not raise."""
    path = _fresh(tmp_path)
    database.init_db(db_path=path)  # second call — must not raise


def test_init_db_migrates_old_schema(tmp_path):
    """A DB with the old single-column words table is upgraded automatically."""
    path = str(tmp_path / "old.sqlite")
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE words (word TEXT PRIMARY KEY COLLATE NOCASE)")
    database.init_db(db_path=path)
    with sqlite3.connect(path) as conn:
        words_info = conn.execute("PRAGMA table_info(words)").fetchall()
        tags_info = conn.execute("PRAGMA table_info(tags)").fetchall()
        word_tags_info = conn.execute("PRAGMA table_info(word_tags)").fetchall()
    assert "id" in {row[1] for row in words_info}
    assert {row[1] for row in tags_info} >= {"id", "name"}
    assert {row[1] for row in word_tags_info} >= {"word_id", "tag_id"}


def test_init_db_creates_llm_calls_table(tmp_path):
    path = _fresh(tmp_path)
    with sqlite3.connect(path) as conn:
        info = conn.execute("PRAGMA table_info(llm_calls)").fetchall()
    col_names = {row[1] for row in info}
    assert col_names >= {"id", "provider", "model", "task", "called_at"}


def test_record_llm_call_inserts_row(tmp_path):
    path = _fresh(tmp_path)
    database.record_llm_call("groq", "llama-3.3-70b", "extract", db_path=path)
    with sqlite3.connect(path) as conn:
        rows = conn.execute("SELECT provider, model, task FROM llm_calls").fetchall()
    assert rows == [("groq", "llama-3.3-70b", "extract")]


def test_record_llm_call_stores_timestamp(tmp_path):
    before = int(time.time())
    path = _fresh(tmp_path)
    database.record_llm_call("groq", "llama-3.3-70b", "grade", db_path=path)
    after = int(time.time())
    with sqlite3.connect(path) as conn:
        ts = conn.execute("SELECT called_at FROM llm_calls").fetchone()[0]
    assert before <= ts <= after


def test_record_llm_call_multiple_rows(tmp_path):
    path = _fresh(tmp_path)
    database.record_llm_call("groq", "llama-3.3-70b", "extract", db_path=path)
    database.record_llm_call("openrouter", "mistral-7b", "grade", db_path=path)
    with sqlite3.connect(path) as conn:
        count = conn.execute("SELECT COUNT(*) FROM llm_calls").fetchone()[0]
    assert count == 2
