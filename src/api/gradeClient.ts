const DEFAULT_BASE_URL = 'http://192.168.68.104:8000'; // same as http.ts

export interface GradeResult {
  correct: boolean;
  feedback: string;
}

export async function gradeAnswer(
  word: string,
  userAnswer: string,
  storedDefinition: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<GradeResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/grade`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, user_answer: userAnswer, stored_definition: storedDefinition }),
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? detail;
    } catch {}
    throw new Error(`Grade failed: ${detail}`);
  }
  return response.json() as Promise<GradeResult>;
}
