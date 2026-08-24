/** @jest-environment node */
import { indexedDB, IDBDatabase } from 'fake-indexeddb';
import { serialQueue } from '../serialized';
import { cacheRecords } from '../schema';
Object.defineProperty(globalThis, 'TextDecoder', { value: require('node:util').TextDecoder, configurable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: require('node:util').TextEncoder, configurable: true });
Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
const lock = serialQueue();
Object.defineProperty(navigator, 'locks', { value: { request: (_name: string, work: () => Promise<unknown>) => lock(work) }, configurable: true });
jest.mock('sql.js', () => ({ __esModule: true, default: () => jest.requireActual('sql.js')({ locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`) }) }));
import { db, runMigrations } from '../client.web';
it('persists a write across reload and rolls back async partial transactions', async () => {
 await runMigrations();
 await db.insert(cacheRecords).values({ key: 'persisted', payload: 'saved' });
 await runMigrations();
 expect(await db.select().from(cacheRecords)).toEqual([{ key: 'persisted', payload: 'saved' }]);
 await expect(db.transaction(async tx => { await tx.insert(cacheRecords).values({ key: 'partial', payload: 'not durable' }); await Promise.resolve(); throw new Error('rollback'); })).rejects.toThrow('rollback');
 await runMigrations(); expect(await db.select().from(cacheRecords)).toHaveLength(1);
});
it('independent tabs reload inside their shared lock and cannot lose another tab write', async () => {
 let second: typeof import('../client.web');
 jest.isolateModules(() => { second = require('../client.web'); });
 await second!.runMigrations();
 await Promise.all([db.insert(cacheRecords).values({ key: 'tab-a', payload: 'a' }), second!.db.insert(cacheRecords).values({ key: 'tab-b', payload: 'b' })]);
 const rows = await db.select().from(cacheRecords);
 expect(rows.map(row => row.key)).toEqual(expect.arrayContaining(['persisted', 'tab-a', 'tab-b']));
});
it('rejects quota failure and never reports a memory-only commit as durable', async () => {
 const original = IDBDatabase.prototype.transaction;
 const spy = jest.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function(this: IDBDatabase, ...args: Parameters<typeof original>) {
  if (args[1] === 'readwrite') throw new Error('Quota exceeded');
  return original.apply(this, args);
 });
 await expect(db.insert(cacheRecords).values({ key: 'quota', payload: 'lost' })).rejects.toThrow('Quota exceeded');
 spy.mockRestore(); await runMigrations();
 expect((await db.select().from(cacheRecords)).some(row => row.key === 'quota')).toBe(false);
});

it('bundles the WASM requested by both installed SQL.js entrypoints', () => {
 const fs = require('node:fs'); const path = require('node:path');
 for (const name of ['sql-wasm', 'sql-wasm-browser']) {
  const asset = `${name}.wasm`;
  const bundled = fs.readFileSync(path.join(process.cwd(), 'public', asset));
  const installed = fs.readFileSync(require.resolve(`sql.js/dist/${asset}`));
  expect(bundled.equals(installed)).toBe(true);
 }
});
