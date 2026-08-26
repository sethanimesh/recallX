import * as Crypto from 'expo-crypto';
import { eq, asc } from 'drizzle-orm';
import { db } from '@/src/db/client';
import { cacheRecords, pendingOperations, words } from '@/src/db/schema';
import { getDeviceId } from '@/src/config/settings';
import { api, ApiError, type Snapshot, type ReviewRequest, type ReviewReceipt } from '@/src/api/centralClient';

export async function readCache<T>(key: string): Promise<T | null> {
  const rows = await db.select().from(cacheRecords).where(eq(cacheRecords.key, key));
  return rows[0] ? JSON.parse(rows[0].payload) : null;
}
export async function writeCache(key: string, value: unknown): Promise<void> {
  await db.insert(cacheRecords).values({ key, payload: JSON.stringify(value) }).onConflictDoUpdate({ target: cacheRecords.key, set: { payload: JSON.stringify(value) } });
}
export const getSnapshot = () => readCache<Snapshot>('snapshot');
export type ReviewContext = Pick<ReviewRequest, 'content_revision' | 'progress_generation' | 'expected_state_version' | 'settings_revision' | 'parameter_version'>;
export function reviewContext(snapshot: Snapshot, itemId: string, mode: 'recall' | 'flashcard', contentRevision?: number): ReviewContext {
  const state = snapshot.memory_states.find(state => state.item_id === itemId && state.mode === mode);
  const activeParameters = snapshot.parameter_versions?.find(version => version.mode === mode && version.status === 'active');
  return { content_revision: contentRevision ?? snapshot.words.find(item => item.id === itemId)?.content_revision ?? 1,
    progress_generation: snapshot.settings.progress_generation, expected_state_version: state?.state_version ?? 0,
    settings_revision: snapshot.settings.revision, parameter_version: typeof activeParameters?.id === 'string' ? activeParameters.id : state?.parameter_version };
}
export async function preparePendingRequest<T>(key: string, body: T, intent: unknown = body): Promise<{ id: string; body: T }> {
  return db.transaction(async tx => {
    const rows = await tx.select().from(cacheRecords).where(eq(cacheRecords.key, key));
    const pending = rows[0] ? JSON.parse(rows[0].payload) : null;
    if (pending) {
      if (JSON.stringify(pending.intent) === JSON.stringify(intent)) return pending;
      throw new Error('A previous change is still awaiting confirmation. Retry that saved change before submitting different values.');
    }
    const operation = { id: Crypto.randomUUID(), body, intent };
    await tx.insert(cacheRecords).values({ key, payload: JSON.stringify(operation) }).onConflictDoUpdate({ target: cacheRecords.key, set: { payload: JSON.stringify(operation) } });
    return operation;
  });
}
export async function completePendingRequest(key: string, id: string): Promise<void> {
  await db.transaction(async tx => {
    const rows = await tx.select().from(cacheRecords).where(eq(cacheRecords.key, key));
    if (rows[0] && JSON.parse(rows[0].payload)?.id === id) await tx.delete(cacheRecords).where(eq(cacheRecords.key, key));
  });
}
export async function failPendingRequest(key: string, id: string, error: string): Promise<void> {
  await db.transaction(async tx => {
    const rows = await tx.select().from(cacheRecords).where(eq(cacheRecords.key, key));
    if (!rows[0] || JSON.parse(rows[0].payload)?.id !== id) return;
    const payload = JSON.stringify({ key, operation: JSON.parse(rows[0].payload), status: 'failed', error, failed_at: new Date().toISOString() });
    await tx.insert(cacheRecords).values({ key: `failed_request:${id}`, payload }).onConflictDoUpdate({ target: cacheRecords.key, set: { payload } });
    await tx.delete(cacheRecords).where(eq(cacheRecords.key, key));
  });
}
export async function pendingReviews() {
  return db.select().from(pendingOperations).where(eq(pendingOperations.status, 'pending')).orderBy(asc(pendingOperations.created_at));
}
export async function allOperations() { return db.select().from(pendingOperations).orderBy(asc(pendingOperations.created_at)); }

/** Allocates sequence, UUID and immutable payload in one durable transaction before I/O. */
export async function enqueueReview(input: {
  item_id: string; mode: 'recall' | 'flashcard'; rating?: 1 | 3; assessment_id?: string; revealed?: boolean; offline?: boolean; assisted?: boolean; context?: ReviewContext; draftKey?: string; draft?: Record<string, unknown>;
}): Promise<ReviewRequest> {
  return db.transaction(async tx => {
    if (input.assessment_id) {
      const existing = await tx.select().from(pendingOperations);
      const duplicate = existing.find(operation => JSON.parse(operation.payload).assessment_id === input.assessment_id);
      if (duplicate) return JSON.parse(duplicate.payload) as ReviewRequest;
    }
    const values = await tx.select().from(cacheRecords);
    const snapshot = JSON.parse(values.find(row => row.key === 'snapshot')?.payload ?? 'null') as Snapshot | null;
    if (!snapshot) throw new Error('Pair and sync this device before reviewing.');
    const item = snapshot.words.find(item => item.id === input.item_id && item.deleted_at == null);
    if (!item) throw new Error('This item is no longer available. Refresh the library.');
    const sequence = Number(JSON.parse(values.find(row => row.key === 'device_sequence')?.payload ?? '0')) + 1;
    const { draftKey, draft, context, ...reviewInput } = input;
    const request: ReviewRequest = {
      ...reviewInput, id: Crypto.randomUUID(), answered_at: new Date().toISOString(), device_sequence: sequence,
      ...(context ?? reviewContext(snapshot, item.id, input.mode)),
      assisted: input.assisted ?? false, revealed: input.revealed ?? false, offline: input.offline ?? false,
    };
    await tx.insert(cacheRecords).values({ key: 'device_sequence', payload: JSON.stringify(sequence) }).onConflictDoUpdate({ target: cacheRecords.key, set: { payload: JSON.stringify(sequence) } });
    await tx.insert(pendingOperations).values({ id: request.id, payload: JSON.stringify(request), status: 'pending', error: null, created_at: Date.now() });
    if (draftKey && draft) {
      const payload = JSON.stringify({ ...draft, operationId: request.id });
      await tx.insert(cacheRecords).values({ key: draftKey, payload }).onConflictDoUpdate({ target: cacheRecords.key, set: { payload } });
    }
    return request;
  });
}
async function acknowledge(request: ReviewRequest, receipt: ReviewReceipt): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(pendingOperations).set({ status: receipt.status, error: receipt.reason ?? null }).where(eq(pendingOperations.id, request.id));
    await tx.insert(cacheRecords).values({ key: `receipt:${request.id}`, payload: JSON.stringify(receipt) }).onConflictDoUpdate({ target: cacheRecords.key, set: { payload: JSON.stringify(receipt) } });
    const records = await tx.select().from(cacheRecords).where(eq(cacheRecords.key, 'snapshot'));
    const snapshot = records[0] ? JSON.parse(records[0].payload) as Snapshot : null;
    if (snapshot && receipt.memory_state && receipt.memory_state.progress_generation === snapshot.settings.progress_generation) {
      const incoming = receipt.memory_state;
      const existing = snapshot.memory_states.find(state => state.item_id === incoming.item_id && state.mode === incoming.mode);
      if (!existing || existing.state_version <= incoming.state_version) {
        snapshot.memory_states = snapshot.memory_states.filter(state => !(state.item_id === incoming.item_id && state.mode === incoming.mode));
        snapshot.memory_states.push(incoming);
        await tx.update(words).set(incoming.mode === 'recall' ? { srs_next_review_at: new Date(incoming.due) } : { fc_next_review_at: new Date(incoming.due) }).where(eq(words.id, incoming.item_id));
      }
    }
    if (snapshot && !snapshot.reviews.some(review => review.id === request.id)) {
      snapshot.reviews.push({ id: request.id, item_id: request.item_id, mode: request.mode, rating: receipt.rating ?? request.rating ?? null, answered_at: request.answered_at, status: receipt.status, assessment_id: request.assessment_id, progress_generation: request.progress_generation, device_id: getDeviceId() ?? '' });
    }
    if (snapshot) await tx.update(cacheRecords).set({ payload: JSON.stringify(snapshot) }).where(eq(cacheRecords.key, 'snapshot'));
  });
}
let flushing: Promise<void> | null = null;
export function flushPendingReviews(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const operation of await pendingReviews()) {
      const payload = JSON.parse(operation.payload) as ReviewRequest;
      try {
        const receipt = await api<ReviewReceipt>('/reviews', payload);
        await acknowledge(payload, receipt);
      } catch (error) {
        const permanent = error instanceof ApiError && [400, 404, 409, 422].includes(error.status);
        await db.update(pendingOperations).set({ status: permanent ? 'failed' : 'pending', error: error instanceof Error ? error.message : String(error) }).where(eq(pendingOperations.id, operation.id));
        if (!permanent) throw error;
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
export async function operationResult(id: string) {
  const rows = await db.select().from(pendingOperations).where(eq(pendingOperations.id, id));
  return rows[0] ?? null;
}
