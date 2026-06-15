import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';

export interface ServerTagRecord {
  id: string;
  name: string;
  word_count?: number;
}

export interface ServerWordRecord {
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

async function request<T>(url: string, options: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

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
    return undefined as T;
  }
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
  updates: { word?: string; definition?: string; example_sentence?: string; mnemonic?: string },
  baseUrl?: string,
) {
  return request<ServerWordRecord>(`${baseFor(baseUrl)}/words/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export function deleteWord(id: string, baseUrl?: string) {
  return request<ServerWordRecord>(`${baseFor(baseUrl)}/words/${id}`, { method: 'DELETE' });
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
