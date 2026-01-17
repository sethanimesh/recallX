"""SQLite persistence layer for RecallX.

All functions accept an optional ``db_path`` argument so tests can use
an in-memory database without touching the real ``backend/db.sqlite``.
"""
import sqlite3
from pathlib import Path

_DEFAULT_DB_PATH = str(Path(__file__).parent / "db.sqlite")


def init_db(db_path: str = _DEFAULT_DB_PATH) -> None:
    """Create the words table if it does not already exist."""
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS words "
            "(word TEXT PRIMARY KEY COLLATE NOCASE)"
        )
        conn.commit()


def insert_word(word: str, db_path: str = _DEFAULT_DB_PATH) -> bool:
    """Insert *word* into the database.

    Returns ``True`` if the word was inserted, ``False`` if it already
    existed (duplicate, case-insensitive).
    """
    try:
        with sqlite3.connect(db_path) as conn:
            conn.execute("INSERT INTO words (word) VALUES (?)", (word,))
            conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
