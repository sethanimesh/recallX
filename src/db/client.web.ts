import { drizzle } from 'drizzle-orm/sql-js';
import initSqlJs from 'sql.js';
import * as schema from './schema';

let sqljsDb: any = null;
let drizzleDb: any = null;

// Proxy to dynamically resolve the initialized drizzle database instance
export const db = new Proxy({} as any, {
  get(target, prop) {
    if (!drizzleDb) {
      throw new Error(`[DB] Drizzle client accessed on web before runMigrations() completed.`);
    }
    return Reflect.get(drizzleDb, prop);
  }
});

export async function runMigrations(): Promise<void> {
  console.log('[DB] Initializing sql.js on Web...');
  const SQL = await initSqlJs({
    locateFile: (file) => `https://unpkg.com/sql.js@1.14.1/dist/${file}`,
  });
  
  sqljsDb = new SQL.Database();
  drizzleDb = drizzle({ client: sqljsDb, schema });

  // Patch transaction support to bypass BEGIN/COMMIT/ROLLBACK on web (sql.js limitation)
  drizzleDb.transaction = async function (callback: any) {
    return callback(drizzleDb);
  };


  // Execute schema definitions on in-memory SQLite database
  sqljsDb.run('PRAGMA journal_mode=WAL;');
  sqljsDb.run(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('image', 'pdf', 'video')),
      uri TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  sqljsDb.run(`
    CREATE TABLE IF NOT EXISTS words (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL,
      definition TEXT NOT NULL,
      example_sentence TEXT NOT NULL,
      source_id TEXT REFERENCES sources(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `);
  sqljsDb.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
  `);
  sqljsDb.run(`
    CREATE TABLE IF NOT EXISTS word_tags (
      word_id TEXT NOT NULL REFERENCES words(id),
      tag_id TEXT NOT NULL REFERENCES tags(id),
      PRIMARY KEY (word_id, tag_id)
    );
  `);
  sqljsDb.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN ('recall', 'flashcard')),
      tag_id TEXT REFERENCES tags(id),
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    );
  `);
  sqljsDb.run(`
    CREATE TABLE IF NOT EXISTS session_results (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      word_id TEXT NOT NULL REFERENCES words(id),
      correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
      attempt_number INTEGER NOT NULL,
      answered_at INTEGER NOT NULL
    );
  `);

  try { sqljsDb.run('CREATE INDEX IF NOT EXISTS idx_sr_word_at ON session_results(word_id, answered_at);'); } catch {}
  
  // SRS columns
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN srs_interval INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN srs_ease_factor REAL NOT NULL DEFAULT 2.5;'); } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN srs_next_review_at INTEGER;'); } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN srs_wrong_count INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN srs_consecutive_correct INTEGER NOT NULL DEFAULT 0;'); } catch {}
  
  // Flashcard columns
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN fc_interval INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN fc_ease_factor REAL NOT NULL DEFAULT 2.5;'); } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN fc_next_review_at INTEGER;'); } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN fc_wrong_count INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN fc_consecutive_correct INTEGER NOT NULL DEFAULT 0;'); } catch {}

  console.log('[DB] Web SQLite Ready (In-memory via sql.js)');
}
