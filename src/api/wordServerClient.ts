const DEFAULT_BASE_URL = 'http://192.168.68.104:8000'; // matches http.ts

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
  source_type: 'image' | 'pdf' | null;
  created_at: number;
  updated_at: number;
}

export class WordServerError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'WordServerError';
  }
}

async function request<T>(url: string, options: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
  } catch {
    throw new WordServerError('Network error', 0);
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? detail;
    } catch {}
    throw new WordServerError(`Request failed: ${detail}`, response.status);
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    return undefined as T;
  }
}

export function postWord(payload: CreateWordPayload, baseUrl = DEFAULT_BASE_URL) {
  return request<ServerWordRecord>(`${baseUrl}/words`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getWords(baseUrl = DEFAULT_BASE_URL) {
  return request<ServerWordRecord[]>(`${baseUrl}/words`, { method: 'GET' });
}

export function patchWord(
  id: string,
  updates: { definition?: string; example_sentence?: string },
  baseUrl = DEFAULT_BASE_URL,
) {
  return request<ServerWordRecord>(`${baseUrl}/words/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export function deleteWord(id: string, baseUrl = DEFAULT_BASE_URL) {
  return request<void>(`${baseUrl}/words/${id}`, { method: 'DELETE' });
}

export function postTag(payload: { id: string; name: string }, baseUrl = DEFAULT_BASE_URL) {
  return request<ServerTagRecord>(`${baseUrl}/tags`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getTags(baseUrl = DEFAULT_BASE_URL) {
  return request<ServerTagRecord[]>(`${baseUrl}/tags`, { method: 'GET' });
}

export function patchTag(id: string, payload: { name: string }, baseUrl = DEFAULT_BASE_URL) {
  return request<ServerTagRecord>(`${baseUrl}/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteTag(id: string, baseUrl = DEFAULT_BASE_URL) {
  return request<void>(`${baseUrl}/tags/${id}`, { method: 'DELETE' });
}

export function addTagToWord(wordId: string, tagId: string, baseUrl = DEFAULT_BASE_URL) {
  return request<void>(`${baseUrl}/words/${wordId}/tags/${tagId}`, { method: 'POST' });
}

export function removeTagFromWord(wordId: string, tagId: string, baseUrl = DEFAULT_BASE_URL) {
  return request<void>(`${baseUrl}/words/${wordId}/tags/${tagId}`, { method: 'DELETE' });
}
