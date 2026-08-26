/** @jest-environment node */
import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from '../../migrations';
import { serialQueue, serializedDatabase } from '../../serialized';
import * as schema from '../../schema';
import { api } from '@/src/api/centralClient';
Object.defineProperty(globalThis, 'TextDecoder', { value: require('node:util').TextDecoder, configurable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: require('node:util').TextEncoder, configurable: true });
jest.mock('@/src/api/centralClient', () => { const actual = jest.requireActual('@/src/api/centralClient'); return { ...actual, api: jest.fn() }; });
jest.mock('@/src/config/settings', () => ({ getDeviceId: () => 'device', getBackendUrl: () => '', getCommonHeaders: () => ({}) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
let mockDatabase: any;
jest.mock('@/src/db/client', () => ({ get db() { return mockDatabase; } }));
import { enqueueReview, flushPendingReviews, readCache, allOperations, preparePendingRequest, completePendingRequest, failPendingRequest, reviewContext, writeCache } from '../central';
let engine: any;
beforeEach(async () => {
 const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) }); engine = new SQL.Database();
 migrate({ exec: sql => engine.run(sql), rows: sql => { const s = engine.prepare(sql); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; } });
 const raw = drizzle(engine, { schema }); const queue = serialQueue();
 mockDatabase = serializedDatabase(() => raw, (work, write) => queue(async () => { if (write) engine.run('BEGIN'); try { const result = await work(raw); if (write) engine.run('COMMIT'); return result; } catch (error) { if (write) engine.run('ROLLBACK'); throw error; } }));
 await mockDatabase.insert(schema.cacheRecords).values({ key: 'snapshot', payload: JSON.stringify({ version: 1, words: [{ id: 'word', content_revision: 2, deleted_at: null }], memory_states: [], reviews: [], settings: { progress_generation: 3, revision: 6 }, parameter_versions: [{ id: 'fitted-parameters', mode: 'flashcard', status: 'active' }] }) });
 jest.clearAllMocks();
});
afterEach(() => engine.close());
it('pins the displayed card context when a background sync changes content, reset generation, and parameters', async () => {
 const displayed = await readCache<any>('snapshot');
 const context = reviewContext(displayed, 'word', 'flashcard', 2);
 await writeCache('snapshot', { ...displayed, words: [{ id: 'word', content_revision: 3 }], settings: { progress_generation: 4, revision: 7 }, parameter_versions: [{ id: 'new-parameters', mode: 'flashcard', status: 'active' }] });
 const event = await enqueueReview({ item_id: 'word', mode: 'flashcard', rating: 3, context, draftKey: 'draft', draft: { context } });
 expect(event).toMatchObject({ content_revision: 2, progress_generation: 3, settings_revision: 6, parameter_version: 'fitted-parameters' });
 expect(await readCache('draft')).toMatchObject({ context, operationId: event.id });
 expect(event).not.toHaveProperty('context');
});
it('persists the flashcard draft and immutable event together, then retries identical payload after lost response', async () => {
 const event = await enqueueReview({ item_id: 'word', mode: 'flashcard', rating: 3, offline: true, revealed: true, draftKey: 'draft', draft: { answer: '', revealed: true } });
 expect(await readCache('draft')).toEqual({ answer: '', revealed: true, operationId: event.id });
 expect(event).toMatchObject({ content_revision: 2, progress_generation: 3, device_sequence: 1, settings_revision: 6, parameter_version: 'fitted-parameters' });
 (api as jest.Mock).mockRejectedValueOnce(new Error('response lost'));
 await expect(flushPendingReviews()).rejects.toThrow('response lost'); expect((await allOperations())[0].status).toBe('pending');
 (api as jest.Mock).mockResolvedValueOnce({ id: event.id, status: 'acknowledged', rating: 3, memory_state: null });
 await flushPendingReviews();
 expect((api as jest.Mock).mock.calls[0][1]).toEqual((api as jest.Mock).mock.calls[1][1]); expect((await allOperations())[0].status).toBe('acknowledged');
});
it('persists the exact settings or rubric request across lost replies without clearing a newer operation', async () => {
 const first = await preparePendingRequest('pending_settings', { desired_retention: .9, expected_revision: 1 }, { desired_retention: .9 });
 const retry = await preparePendingRequest('pending_settings', { desired_retention: .9, expected_revision: 2 }, { desired_retention: .9 });
 expect(retry.id).toBe(first.id); expect(retry.body.expected_revision).toBe(1);
 await expect(preparePendingRequest('pending_settings', { desired_retention: .95, expected_revision: 2 }, { desired_retention: .95 })).rejects.toThrow('previous change');
 expect(await readCache('pending_settings')).toMatchObject({ id: first.id });
 await completePendingRequest('pending_settings', first.id);
 const changed = await preparePendingRequest('pending_settings', { desired_retention: .95, expected_revision: 2 }, { desired_retention: .95 });
 await completePendingRequest('pending_settings', first.id); expect(await readCache('pending_settings')).toMatchObject({ id: changed.id });
 await completePendingRequest('pending_settings', changed.id); expect(await readCache('pending_settings')).toBeNull();
});
it('rolls back the outbox insertion when storing its linked draft fails', async () => {
 const circular: Record<string, unknown> = {}; circular.self = circular;
 await expect(enqueueReview({ item_id: 'word', mode: 'flashcard', rating: 1, draftKey: 'draft', draft: circular })).rejects.toThrow();
 expect(await allOperations()).toEqual([]); expect(await readCache('device_sequence')).toBeNull();
});
it('archives a definitively rejected mutation before allowing a corrected intent', async () => {
 const first = await preparePendingRequest('pending_settings', { desired_retention: .9 });
 await failPendingRequest('pending_settings', first.id, 'Revision conflict');
 expect(await readCache('pending_settings')).toBeNull();
 expect(await readCache(`failed_request:${first.id}`)).toMatchObject({ status: 'failed', operation: { body: { desired_retention: .9 } } });
 await expect(preparePendingRequest('pending_settings', { desired_retention: .95 })).resolves.toBeDefined();
});
it('deduplicates assessment retry and uses server-inferred rating in cached history', async () => {
 const input = { item_id: 'word', mode: 'recall' as const, assessment_id: 'assessment' };
 const first = await enqueueReview(input); const retry = await enqueueReview(input); expect(first.id).toBe(retry.id);
 (api as jest.Mock).mockResolvedValue({ id: first.id, status: 'acknowledged', rating: 1, memory_state: null }); await flushPendingReviews();
 const snapshot = await readCache<any>('snapshot'); expect(snapshot.reviews).toHaveLength(1); expect(snapshot.reviews[0].rating).toBe(1);
});
