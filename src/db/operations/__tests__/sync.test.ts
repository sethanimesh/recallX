/** @jest-environment node */
Object.defineProperty(globalThis, 'TextDecoder', { value: require('node:util').TextDecoder, configurable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: require('node:util').TextEncoder, configurable: true });
import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { eq } from 'drizzle-orm';
import { migrate } from '../../migrations';
import { serialQueue, serializedDatabase } from '../../serialized';
import * as schema from '../../schema';
import { api } from '@/src/api/centralClient';
jest.mock('@/src/api/centralClient', () => ({ api: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'd9966497-ec13-4f24-b2b8-0f9b491d7057' }));
let mockDatabase: any;
jest.mock('@/src/db/client', () => ({ get db() { return mockDatabase; } }));
jest.mock('../central', () => ({ flushPendingReviews: jest.fn().mockResolvedValue(undefined) }));
import { syncFromServer } from '../sync';
let engine: any;
beforeEach(async () => {
  const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) }); engine = new SQL.Database();
  migrate({ exec: sql => engine.run(sql), rows: sql => { const s = engine.prepare(sql); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; } });
  const raw = drizzle(engine, { schema }); const queue = serialQueue();
  mockDatabase = serializedDatabase(() => raw, (work, write) => queue(async () => { if (write) engine.run('BEGIN'); try { const result = await work(raw); if (write) engine.run('COMMIT'); return result; } catch (error) { if (write) engine.run('ROLLBACK'); throw error; } }));
  jest.clearAllMocks();
});
afterEach(() => engine.close());
it('upserts content while preserving source and history, and applies canonical due dates', async () => {
  await mockDatabase.insert(schema.words).values({ id: 'word', word: 'old', definition: 'old', example_sentence: '', source_id: 'source', created_at: new Date(), updated_at: new Date(), srs_wrong_count: 3 });
  await mockDatabase.insert(schema.pendingOperations).values({ id: 'pending', payload: '{}', created_at: 1 });
  const snapshot = { version: 1, server_time: new Date().toISOString(), words: [{ id: 'word', word: 'new', definition: 'new', example_sentence: '', mnemonic: 'cue', content_revision: 2, created_at: 1000, updated_at: 2000, deleted_at: null, tags: [] }], tags: [], memory_states: [{ item_id: 'word', mode: 'recall', due: '2030-01-01T00:00:00Z' }], reviews: [], settings: { progress_generation: 1 } };
  (api as jest.Mock).mockImplementation((path: string) => Promise.resolve(path === '/sync/snapshot' ? snapshot : {}));
  await syncFromServer();
  const [row] = await mockDatabase.select().from(schema.words);
  expect(row).toMatchObject({ id: 'word', source_id: 'source', srs_wrong_count: 3, definition: 'new', mnemonic: 'cue', content_revision: 2 });
  expect(row.srs_next_review_at.toISOString()).toBe('2030-01-01T00:00:00.000Z');
  expect(await mockDatabase.select().from(schema.pendingOperations)).toHaveLength(1);
  expect(api).toHaveBeenCalledWith('/sync/legacy-archive', expect.objectContaining({ data: expect.any(Object) }));
  snapshot.words[0].deleted_at = 3000 as any; snapshot.version = 2; await syncFromServer();
  const [deleted] = await mockDatabase.select().from(schema.words).where(eq(schema.words.id, 'word'));
  expect(deleted.deleted_at.getTime()).toBe(3000);
});
it('keeps a newer acknowledged card when another tab returns an earlier snapshot', async () => {
  const snapshot: any = { version: 4, server_time: new Date().toISOString(), words: [{ id: 'word', word: 'word', definition: 'meaning', example_sentence: '', created_at: 1000, updated_at: 1000, tags: [] }], tags: [], memory_states: [{ item_id: 'word', mode: 'flashcard', state_version: 1, due: '2030-01-01T00:00:00Z' }], reviews: [], settings: { progress_generation: 1 } };
  const cached = { ...snapshot, memory_states: [{ ...snapshot.memory_states[0], state_version: 2, due: '2030-01-02T00:00:00Z' }], reviews: [{ id: 'acknowledged-review', item_id: 'word', mode: 'flashcard', rating: 3 }] };
  await mockDatabase.insert(schema.cacheRecords).values({ key: 'snapshot', payload: JSON.stringify(cached) });
  (api as jest.Mock).mockResolvedValue(snapshot);
  await syncFromServer();
  const [record] = await mockDatabase.select().from(schema.cacheRecords).where(eq(schema.cacheRecords.key, 'snapshot'));
  expect(JSON.parse(record.payload).memory_states[0].state_version).toBe(2);
  expect(JSON.parse(record.payload).reviews).toHaveLength(1);
  const [word] = await mockDatabase.select().from(schema.words);
  expect(word.fc_next_review_at.toISOString()).toBe('2030-01-02T00:00:00.000Z');
  // A reset is an intentional new generation and must replace the old state.
  (api as jest.Mock).mockResolvedValue({ ...snapshot, version: 5, memory_states: [], reviews: [], settings: { progress_generation: 2 } });
  await syncFromServer();
  const [reset] = await mockDatabase.select().from(schema.cacheRecords).where(eq(schema.cacheRecords.key, 'snapshot'));
  expect(JSON.parse(reset.payload).memory_states).toEqual([]);
});
