"""Tests for the database module using an in-memory SQLite database."""
import pytest
import database


@pytest.fixture
def db(tmp_path):
    """Return a path to a fresh temporary database, pre-initialised."""
    path = str(tmp_path / "test.sqlite")
    database.init_db(db_path=path)
    return path


def test_insert_word_returns_true_on_first_insert(db):
    assert database.insert_word("ephemeral", db_path=db) is True


def test_insert_word_returns_false_on_duplicate(db):
    database.insert_word("ephemeral", db_path=db)
    assert database.insert_word("ephemeral", db_path=db) is False


def test_insert_word_case_insensitive(db):
    assert database.insert_word("Ephemeral", db_path=db) is True
    assert database.insert_word("ephemeral", db_path=db) is False


def test_insert_word_different_words(db):
    assert database.insert_word("ephemeral", db_path=db) is True
    assert database.insert_word("ubiquitous", db_path=db) is True


def test_insert_word_case_insensitive_upper(db):
    """Lower inserted first, upper should also be treated as duplicate."""
    assert database.insert_word("serendipity", db_path=db) is True
    assert database.insert_word("SERENDIPITY", db_path=db) is False
