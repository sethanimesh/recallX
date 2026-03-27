import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TutorChatRequest {
  word: string;
  stored_definition: string;
  stored_example: string;
  user_answer: string;
  history: ChatMessage[];
  is_retry?: boolean;
}

export interface TutorChatResponse {
  response: string;
  evaluation: 'correct' | 'close' | 'incorrect';
  hint_provided: boolean;
}

export class TutorError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'TutorError';
  }
}

export async function tutorChat(
  payload: TutorChatRequest,
  baseUrl?: string,
): Promise<TutorChatResponse> {
  const url = `${(baseUrl ?? getBackendUrl()).replace(/\/$/, '')}/tutor/chat`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
    body: JSON.stringify({
      word: payload.word,
      stored_definition: payload.stored_definition,
      stored_example: payload.stored_example,
      user_answer: payload.user_answer,
      history: payload.history,
      is_retry: payload.is_retry ?? false,
    }),
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? detail;
    } catch {}
    throw new TutorError(`Tutor failed: ${detail}`, response.status);
  }
  return (await response.json()) as TutorChatResponse;
}
