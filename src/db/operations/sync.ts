import * as Crypto from 'expo-crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/src/db/client';
import { words, tags, wordTags, cacheRecords, sessions, sessionResults } from '@/src/db/schema';
import { api, type Snapshot } from '@/src/api/centralClient';
import { flushPendingReviews } from './central';
import { flushPendingLibraryMutations } from '@/src/api/wordServerClient';

let ongoing: Promise<void> | null = null;
export function syncFromServer(): Promise<void> {
  if (ongoing) return ongoing;
  ongoing = sync().finally(() => { ongoing = null; });
  return ongoing;
}
async function sync() {
  const legacy = await db.transaction(async tx => {
    const stored = await tx.select().from(cacheRecords).where(eq(cacheRecords.key, 'legacy_archive'));
    if (stored[0]) return JSON.parse(stored[0].payload);
    const data = { sessions: await tx.select().from(sessions), results: await tx.select().from(sessionResults), words: await tx.select().from(words) };
    const archive = { id: Crypto.randomUUID(), data, acknowledged: data.sessions.length === 0 && data.results.length === 0 && data.words.length === 0 };
    await tx.insert(cacheRecords).values({ key: 'legacy_archive', payload: JSON.stringify(archive) });
    return archive;
  });
  if (!legacy.acknowledged) {
    await api('/sync/legacy-archive', { id: legacy.id, data: legacy.data });
    await db.update(cacheRecords).set({ payload: JSON.stringify({ ...legacy, acknowledged: true }) }).where(eq(cacheRecords.key, 'legacy_archive'));
  }
  // An unknown acknowledgement is replayed with its original operation ID.
  await flushPendingReviews();
  await flushPendingLibraryMutations();
  const snapshot = await api<Snapshot>('/sync/snapshot');
  await db.transaction(async tx => {
    const previous = await tx.select().from(cacheRecords).where(eq(cacheRecords.key, 'snapshot'));
    const cached = previous[0] ? JSON.parse(previous[0].payload) as Snapshot : null;
    if (cached && cached.version > snapshot.version) return;
    // A snapshot may have been fetched just before another tab acknowledged a review.
    // Never replace that acknowledged transition with an older same-generation card.
    if (cached?.settings.progress_generation === snapshot.settings.progress_generation) {
      for (const state of cached.memory_states) {
        const incoming = snapshot.memory_states.find(value => value.item_id === state.item_id && value.mode === state.mode);
        if (!incoming || incoming.state_version < state.state_version) {
          snapshot.memory_states = snapshot.memory_states.filter(value => value.item_id !== state.item_id || value.mode !== state.mode);
          snapshot.memory_states.push(state);
        }
      }
      for (const review of cached.reviews) if (!snapshot.reviews.some(value => value.id === review.id)) snapshot.reviews.push(review);
    }
    for (const tag of snapshot.tags) await tx.insert(tags).values({ id: tag.id, name: tag.name }).onConflictDoUpdate({ target: tags.id, set: { name: tag.name } });
    for (const item of snapshot.words) {
      const recall = snapshot.memory_states.find(state => state.item_id === item.id && state.mode === 'recall');
      const flashcard = snapshot.memory_states.find(state => state.item_id === item.id && state.mode === 'flashcard');
      const fields = {
        word: item.word, definition: item.definition, example_sentence: item.example_sentence, mnemonic: item.mnemonic ?? null,
        content_revision: item.content_revision ?? 1, sense_id: item.sense_id ?? null, etymology: item.etymology ?? null,
        created_at: new Date(item.created_at), updated_at: new Date(item.updated_at), deleted_at: item.deleted_at == null ? null : new Date(item.deleted_at),
        srs_next_review_at: recall ? new Date(recall.due) : null, fc_next_review_at: flashcard ? new Date(flashcard.due) : null,
      };
      // A server refresh does not replace device-local source links or unsent operations.
      await tx.insert(words).values({ id: item.id, ...fields }).onConflictDoUpdate({ target: words.id, set: fields });
      await tx.delete(wordTags).where(eq(wordTags.word_id, item.id));
      for (const tag of item.tags ?? []) await tx.insert(wordTags).values({ word_id: item.id, tag_id: tag.id }).onConflictDoNothing();
    }
    // Complete snapshots carry all word tombstones. Tags have no history; remove absent tags explicitly.
    const localTags = await tx.select().from(tags);
    for (const tag of localTags) if (!snapshot.tags.some(remote => remote.id === tag.id)) {
      await tx.delete(wordTags).where(eq(wordTags.tag_id, tag.id));
      await tx.delete(tags).where(eq(tags.id, tag.id));
    }
    await tx.insert(cacheRecords).values({ key: 'snapshot', payload: JSON.stringify(snapshot) }).onConflictDoUpdate({ target: cacheRecords.key, set: { payload: JSON.stringify(snapshot) } });
  });
}
