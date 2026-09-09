import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';
import { ExtractionError } from './http';
import type { CandidateDecision, DocumentUpload, IngestionJob, ItemSource } from './types';
import { readCache, writeCache, preparePendingRequest, completePendingRequest } from '@/src/db/operations/central';

export function ingestionUrl(path: string): string {
  return `${getBackendUrl().replace(/\/$/, '')}/ingestion${path}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
  const response = await fetch(ingestionUrl(path), { ...init, signal: controller.signal, headers: { ...getCommonHeaders(), ...init.headers } });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ExtractionError(typeof error.detail === 'string' ? error.detail : `Import request failed (${response.status})`, response.status);
  }
  return await response.json();
  } finally { clearTimeout(timeout); }
}

async function sendOperation<T>(key: string, operation: { id: string; body: unknown }, path: string, method: string): Promise<T> {
  try {
    const result = await request<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(operation.body as object), operation_id: operation.id }) });
    await completePendingRequest(key, operation.id);
    return result;
  } catch (error) {
    if (error instanceof ExtractionError && [400, 404, 409, 413, 422].includes(error.statusCode)) {
      await writeCache(`${key}:failed:${operation.id}`, { ...operation, status: 'failed', error: error.message });
      await completePendingRequest(key, operation.id);
    }
    throw error;
  }
}

export async function uploadDocument(input: DocumentUpload, requestId = Crypto.randomUUID()): Promise<IngestionJob> {
  const data = new FormData();
  if (Platform.OS === 'web') {
    const file = input.file ?? await (await fetch(input.uri)).blob();
    data.append('file', file, input.name);
  } else {
    data.append('file', { uri: input.uri, name: input.name, type: input.mimeType } as unknown as Blob);
  }
  data.append('request_id', requestId);
  data.append('instructions', input.instructions ?? '');
  data.append('extraction_mode', input.extractionMode ?? 'general_document');
  if (input.crop) data.append('crop', JSON.stringify(input.crop));
  // Let fetch create the multipart boundary. PDF bytes are never sent as a text URI.
  return request('/jobs', { method: 'POST', body: data });
}

export const getIngestionJob = (id: string) => request<IngestionJob>(`/jobs/${encodeURIComponent(id)}`);
export const listIngestionJobs = () => request<IngestionJob[]>('/jobs');
export const getItemSources = (itemId: string) => request<{ item_id: string; sources: ItemSource[] }>(`/items/${encodeURIComponent(itemId)}/sources`);
async function controlJob(id: string, action: 'retry' | 'cancel', revision: number): Promise<IngestionJob> {
  const key = `import-control:${getBackendUrl()}:${id}:${action}`;
  const operation = await preparePendingRequest(key, { expected_revision: revision }, action);
  return sendOperation(key, operation, `/jobs/${encodeURIComponent(id)}/${action}`, 'POST');
}
export const retryIngestionJob = (id: string, revision: number) => controlJob(id, 'retry', revision);
export const cancelIngestionJob = (id: string, revision: number) => controlJob(id, 'cancel', revision);
export interface ReviewDraft { request_id?: string; candidates: CandidateDecision[]; updated_at?: number; revision?: number }
export const getIngestionDraft = (id: string) => request<ReviewDraft>(`/jobs/${encodeURIComponent(id)}/draft`);
export async function saveIngestionDraft(id: string, draft: ReviewDraft): Promise<{ saved: boolean; revision: number }> {
  const key = `import-draft-save:${getBackendUrl()}:${id}`;
  let revision = draft.revision ?? 0;
  const { revision: _revision, updated_at: _updated, ...body } = draft;
  const send = async (operation: { id: string; body: unknown }) => {
    return sendOperation<{ saved: boolean; revision: number }>(key, operation, `/jobs/${encodeURIComponent(id)}/draft`, 'PUT');
  };
  const pending = await readCache<{ id: string; body: typeof body & { expected_revision: number } }>(key);
  if (pending) {
    const acknowledged = await send(pending);
    const { expected_revision: _expected, ...previous } = pending.body;
    if (JSON.stringify(previous) === JSON.stringify(body)) return acknowledged;
    revision = acknowledged.revision;
  }
  const operation = await preparePendingRequest(key, { ...body, expected_revision: revision });
  return send(operation);
}
export const approveIngestion = (id: string, requestId: string, candidates: CandidateDecision[], expectedDraftRevision?: number) => request<{ items: { candidate_id: string; item_id: string | null; accepted: boolean; is_new: boolean }[]; remaining: number }>(`/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: requestId, candidates, expected_draft_revision: expectedDraftRevision }) });
export const getIngestionPage = (id: string, number: number) => request<{ width: number; height: number; method: string }>(`/jobs/${encodeURIComponent(id)}/pages/${number}`);
export const uploadText = (text: string, instructions = '', extractionMode = 'general_document', requestId = Crypto.randomUUID()) => request<IngestionJob>('/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, instructions, extraction_mode: extractionMode, request_id: requestId }) });
export async function correctSourceBlock(id: string, blockId: string, text: string, expectedRevision: number): Promise<IngestionJob> {
  const key = `source-correction:${getBackendUrl()}:${id}:${blockId}`;
  const operation = await preparePendingRequest(key, { text, expected_revision: expectedRevision }, { text });
  return sendOperation(key, operation, `/jobs/${encodeURIComponent(id)}/blocks/${encodeURIComponent(blockId)}`, 'PATCH');
}
