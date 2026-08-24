/** @jest-environment node */
Object.defineProperty(globalThis, 'TextDecoder', { value: require('node:util').TextDecoder, configurable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: require('node:util').TextEncoder, configurable: true });
import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from '../migrations';
import { serialQueue, serializedDatabase } from '../serialized';
import * as schema from '../schema';
it('adopts legacy rows, supplies mnemonic and keeps numbered migrations repeatable', async () => {
 const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) }); const engine = new SQL.Database();
 engine.run("CREATE TABLE words (id TEXT PRIMARY KEY, word TEXT NOT NULL, definition TEXT NOT NULL, example_sentence TEXT NOT NULL, source_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER); INSERT INTO words VALUES('old','word','meaning','','source',1,1,NULL)");
 const connection = { exec: (sql: string) => { engine.run(sql); }, rows: (sql: string) => { const s = engine.prepare(sql); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; } };
 migrate(connection); migrate(connection);
 expect(connection.rows('SELECT id,source_id,mnemonic,content_revision FROM words')).toEqual([{ id: 'old', source_id: 'source', mnemonic: null, content_revision: 1 }]);
 expect(connection.rows('SELECT version FROM schema_migrations')).toEqual([{ version: 1 }, { version: 2 }]);
 engine.close();
});
it('rolls back an asynchronous failure and serializes concurrent readers behind writes', async () => {
 const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) }); const engine = new SQL.Database();
 engine.run('CREATE TABLE cache_records (key TEXT PRIMARY KEY,payload TEXT NOT NULL)');
 const raw = drizzle(engine, { schema }); const queue = serialQueue();
 const db = serializedDatabase(() => raw, (work, write) => queue(async () => {
  if (write) engine.run('BEGIN'); try { const result = await work(raw); if (write) engine.run('COMMIT'); return result; } catch (error) { if (write) engine.run('ROLLBACK'); throw error; }
 }));
 await expect(db.transaction(async tx => { await tx.insert(schema.cacheRecords).values({ key: 'partial', payload: '{}' }); await Promise.resolve(); throw new Error('failure after await'); })).rejects.toThrow('failure after await');
 expect(await db.select().from(schema.cacheRecords)).toEqual([]);
 const write = db.transaction(async tx => { await tx.insert(schema.cacheRecords).values({ key: 'a', payload: '1' }); await Promise.resolve(); await tx.insert(schema.cacheRecords).values({ key: 'b', payload: '2' }); });
 const read = db.select().from(schema.cacheRecords);
 await write; expect(await read).toHaveLength(2); engine.close();
});
