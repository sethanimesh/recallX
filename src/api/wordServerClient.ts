import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';
import { allLibraryMutations, prepareLibraryMutation, settleLibraryMutation, type LibraryMutation } from '@/src/db/operations/libraryMutations';

export interface ServerTagRecord {
  id: string;
  name: string;
  word_count?: number;
}

export interface ServerWordRecord {
  content_revision?: number;
  id: string;
  word: string;
  definition: string;
  example_sentence: string;
  mnemonic: string | null;
  source_type: 'image' | 'pdf' | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  tags: ServerTagRecord[];
}

export interface CreateWordPayload {
  id: string;
  word: string;
  definition: string;
  example_sentence: string;
  mnemonic: string | null;
  source_type: 'image' | 'pdf' | null;
  created_at: number;
  updated_at: number;
}

export class WordServerError extends Error {
  constructor(message: string, public readonly statusCode: number, public readonly data?: any) {
    super(message);
    this.name = 'WordServerError';
  }
}

function baseFor(override?: string): string {
  return (override ?? getBackendUrl()).replace(/\/$/, '');
}

async function performRequest<T>(url: string, options: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), url.includes('generate-mnemonic') ? 120000 : 15000);

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...getCommonHeaders(), ...(options.headers ?? {}) },
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new WordServerError('Connection timed out', 0);
    }
    throw new WordServerError('Network error', 0);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    let rawDetail: any;
    try {
      const err = await response.json();
      rawDetail = err?.detail;
      if (typeof rawDetail === 'string') {
        detail = rawDetail;
      } else if (rawDetail && typeof rawDetail === 'object' && rawDetail.message) {
        detail = rawDetail.message;
      } else if (rawDetail) {
        detail = JSON.stringify(rawDetail);
      }
    } catch {}
    throw new WordServerError(`Request failed: ${detail}`, response.status, rawDetail);
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new WordServerError('The response was interrupted. The saved request will retry with the same identity.', 0);
  }
}

const sending = new Map<string, Promise<unknown>>();
const mutationListeners = new Set<() => void>();
export function subscribeLibraryMutations(listener: () => void): () => void { mutationListeners.add(listener); return () => { mutationListeners.delete(listener); }; }
function sendMutation<T>(operation: LibraryMutation): Promise<T> {
  const underway = sending.get(operation.id); if (underway) return underway as Promise<T>;
  const task = (async () => {
    try {
      const response = await performRequest<T>(operation.url, { method: operation.method, body: operation.body, headers: { 'X-Operation-ID': operation.id } });
      await settleLibraryMutation(operation, 'acknowledged', response); mutationListeners.forEach(listener => listener()); return response;
    } catch (error) {
      const permanent = error instanceof WordServerError && [400, 404, 409, 410, 422].includes(error.statusCode);
      await settleLibraryMutation(operation, permanent ? 'failed' : 'pending', undefined, error instanceof Error ? error.message : String(error));
      throw error;
    }
  })().finally(() => sending.delete(operation.id));
  sending.set(operation.id, task); return task;
}
async function request<T>(url: string, options: RequestInit): Promise<T> {
  if (!options.method || options.method === 'GET') return performRequest<T>(url, options);
  const operation = await prepareLibraryMutation(options.method, url, typeof options.body === 'string' ? options.body : undefined);
  return sendMutation<T>(operation);
}
let flushing: Promise<void> | null = null;
export function flushPendingLibraryMutations(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const operation of await allLibraryMutations()) {
      if (operation.status !== 'pending' || !operation.url.startsWith(`${baseFor()}/`)) continue;
      try { await sendMutation(operation); }
      catch (error) { if (!(error instanceof WordServerError) || ![400, 404, 409, 410, 422].includes(error.statusCode)) throw error; }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

export function postWord(payload: CreateWordPayload, baseUrl?: string) {
  return request<ServerWordRecord>(`${baseFor(baseUrl)}/words`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getWords(baseUrl?: string) {
  return request<ServerWordRecord[]>(`${baseFor(baseUrl)}/words`, { method: 'GET' });
}

export function patchWord(
  id: string,
  updates: { expected_content_revision?: number; word?: string; definition?: string; example_sentence?: string; mnemonic?: string },
  baseUrl?: string,
) {
  return request<ServerWordRecord>(`${baseFor(baseUrl)}/words/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export function deleteWord(id: string, baseUrl?: string, expectedRevision?: number) {
  return request<ServerWordRecord>(`${baseFor(baseUrl)}/words/${id}${expectedRevision === undefined ? '' : `?expected_content_revision=${expectedRevision}`}`, { method: 'DELETE' });
}

export function generateMnemonic(id: string, baseUrl?: string) {
  return request<ServerWordRecord>(`${baseFor(baseUrl)}/words/${id}/generate-mnemonic`, { method: 'POST' });
}

export function postTag(payload: { id: string; name: string }, baseUrl?: string) {
  return request<ServerTagRecord>(`${baseFor(baseUrl)}/tags`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getTags(baseUrl?: string) {
  return request<ServerTagRecord[]>(`${baseFor(baseUrl)}/tags`, { method: 'GET' });
}

export function patchTag(id: string, payload: { name: string }, baseUrl?: string) {
  return request<ServerTagRecord>(`${baseFor(baseUrl)}/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteTag(id: string, baseUrl?: string) {
  return request<void>(`${baseFor(baseUrl)}/tags/${id}`, { method: 'DELETE' });
}

export function mergeTag(sourceTagId: string, targetTagId: string, baseUrl?: string) {
  return request<ServerTagRecord>(`${baseFor(baseUrl)}/tags/${sourceTagId}/merge`, {
    method: 'POST',
    body: JSON.stringify({ target_tag_id: targetTagId }),
  });
}

export function addTagToWord(wordId: string, tagId: string, baseUrl?: string) {
  return request<void>(`${baseFor(baseUrl)}/words/${wordId}/tags/${tagId}`, { method: 'POST' });
}

export function removeTagFromWord(wordId: string, tagId: string, baseUrl?: string) {
  return request<void>(`${baseFor(baseUrl)}/words/${wordId}/tags/${tagId}`, { method: 'DELETE' });
}
