import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';
import { migrate } from './migrations';
import { serialQueue, serializedDatabase } from './serialized';

const sqlite = openDatabaseSync('recallx.db', { enableChangeListener: true });
const raw = drizzle(sqlite, { schema });
const enqueue = serialQueue();
export const db = serializedDatabase(() => raw, (work, write) => enqueue(async () => {
  if (write) sqlite.execSync('BEGIN IMMEDIATE');
  try {
    const result = await work(raw);
    if (write) sqlite.execSync('COMMIT');
    return result;
  } catch (error) { if (write) sqlite.execSync('ROLLBACK'); throw error; }
}));
export async function runMigrations(): Promise<void> {
  await enqueue(async () => {
    sqlite.execSync('PRAGMA journal_mode=WAL');
    migrate({ exec: sql => sqlite.execSync(sql), rows: sql => sqlite.getAllSync(sql) });
  });
}
