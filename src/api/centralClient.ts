import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', headers?: Record<string, string>): Promise<T> {
  const controller = new AbortController();
  // Allow the model worker's 180-second timeout to return a useful server error.
  const modelRequest = /^\/(?:assessments|grade|tutor)(?:[/?]|$)/.test(path);
  const timeout = setTimeout(() => controller.abort(), modelRequest ? 240000 : 15000);
  try {
    const response = await fetch(`${getBackendUrl().replace(/\/$/, '')}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...getCommonHeaders(), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) {
      const content = await response.json().catch(() => null);
      throw new ApiError(typeof content?.detail === 'string' ? content.detail : JSON.stringify(content?.detail ?? `Request failed (${response.status})`), response.status);
    }
    return response.status === 204 ? undefined as T : await response.json();
  } finally { clearTimeout(timeout); }
}
export type { MemoryState, ReviewSubmission as ReviewRequest, ReviewResult as ReviewReceipt, Settings as LearnerSettings, Snapshot } from './generated';
