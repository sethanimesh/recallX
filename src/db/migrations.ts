export type MigrationConnection = { exec(sql: string): void; rows(sql: string): Record<string, any>[] };
/** The first numbered migration also adopts existing, previously unversioned databases. */
export function migrate(connection: MigrationConnection): void {
  connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const version = Number(connection.rows('SELECT MAX(version) AS version FROM schema_migrations')[0]?.version ?? 0);
  if (version >= 2) return;
  connection.exec('BEGIN IMMEDIATE');
  try {
    if (version < 1) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY,type TEXT NOT NULL,uri TEXT NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS words (id TEXT PRIMARY KEY,word TEXT NOT NULL,definition TEXT NOT NULL,example_sentence TEXT NOT NULL,source_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted_at INTEGER);
        CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS word_tags (word_id TEXT NOT NULL,tag_id TEXT NOT NULL,PRIMARY KEY(word_id,tag_id));
        CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,mode TEXT NOT NULL,tag_id TEXT,started_at INTEGER NOT NULL,ended_at INTEGER);
        CREATE TABLE IF NOT EXISTS session_results (id TEXT PRIMARY KEY,session_id TEXT NOT NULL,word_id TEXT NOT NULL,correct INTEGER NOT NULL,attempt_number INTEGER NOT NULL,answered_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_sr_word_at ON session_results(word_id,answered_at);
      `);
      const columns = new Set(connection.rows('PRAGMA table_info(words)').map(row => row.name));
      const additions: Record<string, string> = { mnemonic: 'TEXT', content_revision: 'INTEGER NOT NULL DEFAULT 1', sense_id: 'TEXT', etymology: 'TEXT' };
      for (const prefix of ['srs', 'fc']) Object.assign(additions, {
        [`${prefix}_interval`]: 'INTEGER NOT NULL DEFAULT 0', [`${prefix}_ease_factor`]: 'REAL NOT NULL DEFAULT 2.5',
        [`${prefix}_next_review_at`]: 'INTEGER', [`${prefix}_wrong_count`]: 'INTEGER NOT NULL DEFAULT 0', [`${prefix}_consecutive_correct`]: 'INTEGER NOT NULL DEFAULT 0',
      });
      for (const [name, type] of Object.entries(additions)) if (!columns.has(name)) connection.exec(`ALTER TABLE words ADD COLUMN ${name} ${type}`);
      connection.exec("INSERT INTO schema_migrations VALUES (1,datetime('now'))");
    }
    if (version < 2) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS cache_records (key TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pending_operations (id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',error TEXT,created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_operations(status,created_at);
        INSERT INTO schema_migrations VALUES (2,datetime('now'));
      `);
    }
    connection.exec('COMMIT');
  } catch (error) { connection.exec('ROLLBACK'); throw error; }
}
