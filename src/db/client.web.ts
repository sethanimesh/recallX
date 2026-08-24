import { drizzle } from 'drizzle-orm/sql-js';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import * as schema from './schema';
import { migrate } from './migrations';
import { serialQueue, serializedDatabase } from './serialized';

let SQL: SqlJsStatic;
let engine: Database;
let raw: ReturnType<typeof drizzle<typeof schema>>;
let storage: IDBDatabase;
const enqueue = serialQueue();
const DATABASE_KEY = 'recallx';
function snapshot(write?: Uint8Array): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = storage.transaction('databases', write ? 'readwrite' : 'readonly');
    const request = write ? transaction.objectStore('databases').put(write, DATABASE_KEY) : transaction.objectStore('databases').get(DATABASE_KEY);
    transaction.oncomplete = () => resolve(write ?? request.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage write failed'));
  });
}
function load(bytes?: Uint8Array) {
  engine?.close();
  engine = bytes ? new SQL.Database(bytes) : new SQL.Database();
  raw = drizzle(engine, { schema });
}
function locked<T>(work: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return Promise.reject(new Error('This browser does not support durable cross-tab storage. Use a current Safari or Chrome.'));
  return navigator.locks.request('recallx-database', work) as unknown as Promise<T>;
}
export const db = serializedDatabase(() => {
  if (!raw) throw new Error('Database is not ready');
  return raw;
}, (work, write) => enqueue(() => locked(async () => {
  const before = await snapshot();
  load(before);
  if (write) engine.run('BEGIN IMMEDIATE');
  try {
    const result = await work(raw);
    if (write) {
      engine.run('COMMIT');
      await snapshot(engine.export());
    }
    return result;
  } catch (error) {
    // Restore the last durable snapshot even when IndexedDB failed after SQL COMMIT.
    load(before);
    throw error;
  }
})));
export async function runMigrations(): Promise<void> {
  if (typeof window === 'undefined') return; // Expo static rendering does not execute storage operations.
  SQL = await initSqlJs({ locateFile: file => `/${file}` });
  storage = await new Promise((resolve, reject) => {
    const request = indexedDB.open('recallx-storage', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('databases');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await enqueue(() => locked(async () => {
    load(await snapshot());
    migrate({ exec: sql => engine.run(sql), rows: sql => {
      const statement = engine.prepare(sql); const rows = [];
      try { while (statement.step()) rows.push(statement.getAsObject()); } finally { statement.free(); }
      return rows;
    }});
    await snapshot(engine.export());
  }));
}
