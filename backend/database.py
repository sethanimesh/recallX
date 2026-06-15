"""SQLite persistence layer for RecallX. Exposes init_db() to create the schema."""
import sqlite3
import time
from pathlib import Path

_DEFAULT_DB_PATH = str(Path(__file__).parent / "db.sqlite")


def init_db(db_path: str = _DEFAULT_DB_PATH) -> None:
    """Create or migrate the database schema. Safe to call multiple times."""
    with sqlite3.connect(db_path) as conn:
        # Migrate old single-column words table if present — safe to drop, it stored only bare strings
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
                mnemonic         TEXT,
                source_type      TEXT,
                created_at       INTEGER NOT NULL,
                updated_at       INTEGER NOT NULL,
                deleted_at       INTEGER
            )
        """)
        if info and "mnemonic" not in col_names:
            conn.execute("ALTER TABLE words ADD COLUMN mnemonic TEXT")

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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS llm_calls (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                provider  TEXT    NOT NULL,
                model     TEXT    NOT NULL,
                task      TEXT    NOT NULL,
                called_at INTEGER NOT NULL   -- Unix timestamp (UTC seconds)
            )
        """)
        conn.commit()


def record_llm_call(
    provider: str,
    model: str,
    task: str,
    db_path: str = _DEFAULT_DB_PATH,
) -> None:
    """Append one row to llm_calls. Requires init_db() to have been called first."""
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO llm_calls (provider, model, task, called_at) VALUES (?, ?, ?, ?)",
            (provider, model, task, int(time.time())),
        )
        conn.commit()
