import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';

export interface GradeResult {
  correct: boolean;
  feedback: string;
}

export class GradeError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'GradeError';
  }
}

export async function gradeAnswer(
  word: string,
  userAnswer: string,
  storedDefinition: string,
  baseUrl?: string,
): Promise<GradeResult> {
  const url = `${(baseUrl ?? getBackendUrl()).replace(/\/$/, '')}/grade`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
    body: JSON.stringify({ word, user_answer: userAnswer, stored_definition: storedDefinition }),
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? detail;
    } catch {}
    throw new GradeError(`Grade failed: ${detail}`, response.status);
  }
  return (await response.json()) as GradeResult;
}
