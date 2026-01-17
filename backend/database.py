"""SQLite persistence layer for RecallX.

All functions accept an optional ``db_path`` argument so tests can use
an in-memory database without touching the real ``backend/db.sqlite``.
"""
import sqlite3
from pathlib import Path

_DEFAULT_DB_PATH = str(Path(__file__).parent / "db.sqlite")


def init_db(db_path: str = _DEFAULT_DB_PATH) -> None:
    with sqlite3.connect(db_path) as conn:
        # Migrate old single-column words table if present
        info = conn.execute("PRAGMA table_info(words)").fetchall()
        col_names = {row[1] for row in info}
        if info and "id" not in col_names:
            conn.execute("DROP TABLE IF EXISTS words")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS words (
                id               TEXT PRIMARY KEY,
                word             TEXT NOT NULL UNIQUE COLLATE NOCASE,
                definition       TEXT NOT NULL,
                example_sentence TEXT NOT NULL,
                source_type      TEXT,
                created_at       INTEGER NOT NULL,
                updated_at       INTEGER NOT NULL,
                deleted_at       INTEGER
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tags (
                id   TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS word_tags (
                word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
                tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
                PRIMARY KEY (word_id, tag_id)
            )
        """)
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
