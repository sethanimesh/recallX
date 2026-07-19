"""Central SQLite storage with explicit, checked, numbered migrations."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid

_DEFAULT_DB_PATH = str(Path(__file__).parent / 'db.sqlite')


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def path() -> str:
    return os.environ.get('RECALLX_DB_PATH', _DEFAULT_DB_PATH)


@contextmanager
def connect(db_path: str | None = None, *, immediate: bool = False):
    conn = sqlite3.connect(db_path or path(), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA busy_timeout=10000')
    try:
        if immediate:
            conn.execute('BEGIN IMMEDIATE')
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def _statements(script):
    statement = ''
    for line in script.splitlines(True):
        statement += line
        if sqlite3.complete_statement(statement):
            yield statement
            statement = ''
    if statement.strip():
        raise RuntimeError('Incomplete migration statement')


def init_db(db_path: str | None = None) -> None:
    target=Path(db_path or path())
    target.parent.mkdir(parents=True,exist_ok=True)
    # Separate processes must not both attempt the same migration.
    with Path(str(target)+'.migrate.lock').open('a') as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
        if target.exists() and target.stat().st_size:
            with sqlite3.connect(target) as source:
                has_versions=source.execute("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").fetchone()
                applied={row[0] for row in source.execute('SELECT version FROM schema_migrations')} if has_versions else set()
                pending={file.name for file in (Path(__file__).parent/'migrations').glob('*.sql')}-applied
                if pending:
                    backups=Path(os.environ.get('RECALLX_DATA_DIR',str(target.parent/'data')))/'backups'
                    backups.mkdir(parents=True,exist_ok=True)
                    destination=backups/f'{target.stem}-before-migration-{time.time_ns()}.sqlite'
                    with sqlite3.connect(destination) as backup:
                        source.backup(backup)
                        if backup.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
                            raise RuntimeError('Pre-migration backup failed its integrity check')
        _migrate(str(target))


def _migrate(db_path: str | None = None) -> None:
    target = db_path or path()
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target, timeout=10)
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=10000')
        conn.execute('PRAGMA foreign_keys=OFF')
        cols = {r[1] for r in conn.execute('PRAGMA table_info(words)')}
        if cols and 'id' not in cols:
            conn.execute('ALTER TABLE words RENAME TO legacy_bare_words')
        conn.executescript('''
        CREATE TABLE IF NOT EXISTS words(id TEXT PRIMARY KEY,word TEXT NOT NULL UNIQUE COLLATE NOCASE,definition TEXT NOT NULL,example_sentence TEXT NOT NULL,mnemonic TEXT,source_type TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted_at INTEGER);
        CREATE TABLE IF NOT EXISTS tags(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS word_tags(word_id TEXT NOT NULL REFERENCES words(id),tag_id TEXT NOT NULL REFERENCES tags(id),PRIMARY KEY(word_id,tag_id));
        CREATE TABLE IF NOT EXISTS llm_calls(id INTEGER PRIMARY KEY AUTOINCREMENT,provider TEXT NOT NULL,model TEXT NOT NULL,task TEXT NOT NULL,called_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS stories(id TEXT PRIMARY KEY,tag_id TEXT,prompt TEXT,title TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS system_prompts(id TEXT PRIMARY KEY,prompt_text TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL);
        ''')
        if cols and 'mnemonic' not in cols and 'id' in cols:
            conn.execute('ALTER TABLE words ADD COLUMN mnemonic TEXT')
        if cols and 'id' not in cols:
            for row in conn.execute('SELECT word FROM legacy_bare_words').fetchall():
                conn.execute('INSERT INTO words(id,word,definition,example_sentence,created_at,updated_at) VALUES(?,?,?,?,?,?)', (str(uuid.uuid5(uuid.NAMESPACE_URL,'recallx:legacy:'+row[0])),row[0],'','',int(time.time()*1000),int(time.time()*1000)))
        conn.commit()
        for migration in sorted((Path(__file__).parent / 'migrations').glob('*.sql')):
            script = migration.read_text()
            checksum = hashlib.sha256(script.encode()).hexdigest()
            applied = conn.execute('SELECT checksum FROM schema_migrations WHERE version=?',(migration.name,)).fetchone()
            if applied:
                if applied[0] != checksum:
                    raise RuntimeError(f'Applied migration changed: {migration.name}')
                continue
            conn.execute('BEGIN IMMEDIATE')
            try:
                for statement in _statements(script):
                    conn.execute(statement)
                violations = conn.execute('PRAGMA foreign_key_check').fetchall()
                if violations:
                    raise RuntimeError(f'Migration foreign-key violations: {violations[:5]}')
                conn.execute('INSERT INTO schema_migrations VALUES(?,?,?)',(migration.name,checksum,utcnow()))
                conn.commit()
            except BaseException:
                conn.rollback()
                raise
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in ('words','tags','word_tags','memory_states','review_events','learner_settings','rubrics','review_corrections'):
            if table in tables:
                for operation in ('INSERT','UPDATE','DELETE'):
                    conn.execute(f'CREATE TRIGGER IF NOT EXISTS sync_{table}_{operation} AFTER {operation} ON {table} BEGIN UPDATE sync_meta SET revision=revision+1 WHERE id=1; END')
        conn.commit()
    finally:
        conn.close()


def record_llm_call(provider: str, model: str, task: str, db_path: str | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute('INSERT INTO llm_calls(provider,model,task,called_at) VALUES(?,?,?,?)',(provider,model,task,int(time.time())))


def get_system_prompt(prompt_id: str, db_path: str | None = None) -> str:
    from prompts import DEFAULT_PROMPTS
    with connect(db_path) as conn:
        row=conn.execute('SELECT prompt_text FROM system_prompts WHERE id=?',(prompt_id,)).fetchone()
    return row[0] if row else DEFAULT_PROMPTS.get(prompt_id,'')


def set_system_prompt(prompt_id: str, prompt_text: str, db_path: str | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute('INSERT INTO system_prompts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET prompt_text=excluded.prompt_text',(prompt_id,prompt_text))


def reset_system_prompt(prompt_id: str, db_path: str | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute('DELETE FROM system_prompts WHERE id=?',(prompt_id,))
