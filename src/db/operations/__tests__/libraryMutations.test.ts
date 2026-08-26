/** @jest-environment node */
Object.defineProperty(globalThis, 'TextDecoder', { value: require('node:util').TextDecoder, configurable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: require('node:util').TextEncoder, configurable: true });
import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from '../../migrations';
import { serialQueue, serializedDatabase } from '../../serialized';
import * as schema from '../../schema';
import { allLibraryMutations } from '../libraryMutations';
import { patchWord, postWord, flushPendingLibraryMutations } from '@/src/api/wordServerClient';
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
jest.mock('@/src/config/settings', () => ({ getBackendUrl: () => 'http://localhost:8000', getCommonHeaders: () => ({ Authorization: 'Bearer test-device' }) }));
let mockDatabase: any;
jest.mock('@/src/db/client', () => ({ get db() { return mockDatabase; } }));
let engine: any;
beforeEach(async () => {
  const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) }); engine = new SQL.Database();
  migrate({ exec: sql => engine.run(sql), rows: sql => { const s = engine.prepare(sql); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; } });
  const raw = drizzle(engine, { schema }); const queue = serialQueue();
  mockDatabase = serializedDatabase(() => raw, (work, write) => queue(async () => { if (write) engine.run('BEGIN'); try { const result = await work(raw); if (write) engine.run('COMMIT'); return result; } catch (error) { if (write) engine.run('ROLLBACK'); throw error; } }));
  global.fetch = jest.fn();
});
afterEach(() => engine.close());
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
it('commits a mutation before sending and retries the same UUID and body after a lost acknowledgement', async () => {
  (global.fetch as jest.Mock).mockImplementationOnce(async () => {
    expect(await allLibraryMutations()).toEqual([expect.objectContaining({ status: 'pending', body: JSON.stringify({ definition: 'Clear', expected_content_revision: 2 }) })]);
    throw new TypeError('Response lost');
  });
  await expect(patchWord('word', { definition: 'Clear', expected_content_revision: 2 })).rejects.toMatchObject({ statusCode: 0 });
  const firstRequest = (global.fetch as jest.Mock).mock.calls[0][1];
  (global.fetch as jest.Mock).mockResolvedValueOnce(response({ id: 'word', content_revision: 3 }));
  await patchWord('word', { definition: 'Clear', expected_content_revision: 2 });
  const retry = (global.fetch as jest.Mock).mock.calls[1][1];
  expect(retry.body).toBe(firstRequest.body); expect(retry.headers['X-Operation-ID']).toBe(firstRequest.headers['X-Operation-ID']);
  expect(await allLibraryMutations()).toEqual([expect.objectContaining({ status: 'acknowledged', response: { id: 'word', content_revision: 3 } })]);
});
it('preserves the original item ID and timestamps when a create caller retries after restarting', async () => {
  const body = { id: 'original-id', word: 'Lucid', definition: 'Clear', example_sentence: '', mnemonic: null, source_type: null, created_at: 1, updated_at: 1 };
  (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Response lost'));
  await expect(postWord(body)).rejects.toMatchObject({ statusCode: 0 });
  (global.fetch as jest.Mock).mockResolvedValueOnce(response(body));
  const saved = await postWord({ ...body, id: 'newly-generated-id', created_at: 2, updated_at: 2 });
  expect(saved.id).toBe('original-id');
  expect((global.fetch as jest.Mock).mock.calls[1][1].body).toBe(JSON.stringify(body));
  expect(await allLibraryMutations()).toHaveLength(1);
});
it('recovers queued library changes automatically during sync', async () => {
  (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Offline'));
  await expect(patchWord('word', { mnemonic: 'Cue' })).rejects.toMatchObject({ statusCode: 0 });
  (global.fetch as jest.Mock).mockResolvedValueOnce(response({ id: 'word', mnemonic: 'Cue' }));
  await flushPendingLibraryMutations();
  expect((await allLibraryMutations())[0].status).toBe('acknowledged');
});
it('retains a stale mutation as failed instead of retrying it indefinitely', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ detail: 'Item changed' }) });
  await expect(patchWord('word', { definition: 'Older edit', expected_content_revision: 1 })).rejects.toMatchObject({ statusCode: 409 });
  await flushPendingLibraryMutations();
  expect(global.fetch).toHaveBeenCalledTimes(1); expect((await allLibraryMutations())[0].status).toBe('failed');
});
it('retains the operation when response headers arrive but its body is lost', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('Truncated response'); } });
  await expect(patchWord('word', { definition: 'Meaning' })).rejects.toMatchObject({ statusCode: 0 });
  expect((await allLibraryMutations())[0].status).toBe('pending');
});
it('does not send anything when durable storage cannot commit the operation', async () => {
  const previous = mockDatabase;
  mockDatabase = { transaction: () => Promise.reject(new Error('Storage unavailable')) };
  await expect(patchWord('word', { definition: 'Meaning' })).rejects.toThrow('Storage unavailable');
  expect(global.fetch).not.toHaveBeenCalled(); mockDatabase = previous;
});
