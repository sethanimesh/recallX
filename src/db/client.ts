import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';

const expo = openDatabaseSync('recallx.db', { enableChangeListener: true });

export const db = drizzle(expo, { schema });

export async function runMigrations(): Promise<void> {
  await expo.execAsync('PRAGMA journal_mode=WAL;');
  await expo.execAsync(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('image', 'pdf', 'video')),
      uri TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  await expo.execAsync(`
    CREATE TABLE IF NOT EXISTS words (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL,
      definition TEXT NOT NULL,
      example_sentence TEXT NOT NULL,
      mnemonic TEXT,
      source_id TEXT REFERENCES sources(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `);
  await expo.execAsync(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
  `);
  await expo.execAsync(`
    CREATE TABLE IF NOT EXISTS word_tags (
      word_id TEXT NOT NULL REFERENCES words(id),
      tag_id TEXT NOT NULL REFERENCES tags(id),
      PRIMARY KEY (word_id, tag_id)
    );
  `);
  await expo.execAsync(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN ('recall', 'flashcard')),
      tag_id TEXT REFERENCES tags(id),
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    );
  `);
  await expo.execAsync(`
    CREATE TABLE IF NOT EXISTS session_results (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      word_id TEXT NOT NULL REFERENCES words(id),
      correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
      attempt_number INTEGER NOT NULL,
      answered_at INTEGER NOT NULL
    );
  `);
  try { await expo.execAsync('CREATE INDEX IF NOT EXISTS idx_sr_word_at ON session_results(word_id, answered_at);'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN mnemonic TEXT;'); } catch {}
  // SRS columns — ALTER TABLE errors if column already exists; suppress with try/catch
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN srs_interval INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN srs_ease_factor REAL NOT NULL DEFAULT 2.5;'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN srs_next_review_at INTEGER;'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN srs_wrong_count INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN srs_consecutive_correct INTEGER NOT NULL DEFAULT 0;'); } catch {}
  // Flashcard columns — ALTER TABLE errors if column already exists; suppress with try/catch
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN fc_interval INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN fc_ease_factor REAL NOT NULL DEFAULT 2.5;'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN fc_next_review_at INTEGER;'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN fc_wrong_count INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { await expo.execAsync('ALTER TABLE words ADD COLUMN fc_consecutive_correct INTEGER NOT NULL DEFAULT 0;'); } catch {}
  console.log('[DB] Ready');
}
