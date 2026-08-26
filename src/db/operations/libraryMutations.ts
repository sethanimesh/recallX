import * as Crypto from 'expo-crypto';
import { eq, like } from 'drizzle-orm';
import { db } from '@/src/db/client';
import { cacheRecords } from '@/src/db/schema';

export type LibraryMutation = { id: string; method: string; url: string; body?: string; intentKey: string; created_at: number; status: 'pending' | 'acknowledged' | 'failed'; error?: string; response?: unknown };
const prefix = 'library-operation:';
export async function prepareLibraryMutation(method: string, url: string, body?: string): Promise<LibraryMutation> {
  let intent = body;
  // A create retry must reuse the original item identity and timestamps too.
  if (method === 'POST' && /\/(?:words|tags)$/.test(url) && body) {
    const { id: _id, created_at: _created, updated_at: _updated, ...content } = JSON.parse(body);
    intent = JSON.stringify(content);
  }
  const intentKey = `library-intent:${method}:${url}:${intent ?? ''}`;
  return db.transaction(async tx => {
    const previous = await tx.select().from(cacheRecords).where(eq(cacheRecords.key, intentKey));
    if (previous[0]) {
      const records = await tx.select().from(cacheRecords).where(eq(cacheRecords.key, prefix + JSON.parse(previous[0].payload)));
      if (records[0]) return JSON.parse(records[0].payload) as LibraryMutation;
    }
    const operation: LibraryMutation = { id: Crypto.randomUUID(), method, url, body, intentKey, created_at: Date.now(), status: 'pending' };
    await tx.insert(cacheRecords).values({ key: prefix + operation.id, payload: JSON.stringify(operation) });
    await tx.insert(cacheRecords).values({ key: intentKey, payload: JSON.stringify(operation.id) }).onConflictDoUpdate({ target: cacheRecords.key, set: { payload: JSON.stringify(operation.id) } });
    return operation;
  });
}
export async function settleLibraryMutation(operation: LibraryMutation, status: LibraryMutation['status'], response?: unknown, error?: string): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(cacheRecords).set({ payload: JSON.stringify({ ...operation, status, response, error }) }).where(eq(cacheRecords.key, prefix + operation.id));
    if (status !== 'pending') {
      const current = await tx.select().from(cacheRecords).where(eq(cacheRecords.key, operation.intentKey));
      if (current[0] && JSON.parse(current[0].payload) === operation.id) await tx.delete(cacheRecords).where(eq(cacheRecords.key, operation.intentKey));
    }
  });
}
export async function allLibraryMutations(): Promise<LibraryMutation[]> {
  return (await db.select().from(cacheRecords).where(like(cacheRecords.key, `${prefix}%`))).map(record => JSON.parse(record.payload)).sort((a, b) => a.created_at - b.created_at);
}
