import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';

export interface StoryWordItem {
  word: string;
  definition: string;
}

export interface GenerateStoryRequest {
  words: StoryWordItem[];
  custom_prompt?: string;
}

export interface GenerateStoryResponse {
  title: string;
  content: string;
}

export async function generateStory(payload: GenerateStoryRequest): Promise<GenerateStoryResponse> {
  const url = `${getBackendUrl().replace(/\/$/, '')}/story/generate`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
    body: JSON.stringify({
      words: payload.words,
      custom_prompt: payload.custom_prompt || "",
    }),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? detail;
    } catch {}
    throw new Error(`Story generation failed: ${detail}`);
  }
  return (await response.json()) as GenerateStoryResponse;
}
