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

export interface SavedStory {
  id: string;
  tag_id: string | null;
  prompt: string | null;
  title: string;
  content: string;
  created_at: number;
}

export async function fetchBackendStories(tagId: string | null): Promise<SavedStory[]> {
  const baseUrl = getBackendUrl().replace(/\/$/, '');
  const url = tagId ? `${baseUrl}/story?tag_id=${encodeURIComponent(tagId)}` : `${baseUrl}/story`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch stories: HTTP ${response.status}`);
  }
  return (await response.json()) as SavedStory[];
}

export async function getBackendStory(storyId: string): Promise<SavedStory> {
  const url = `${getBackendUrl().replace(/\/$/, '')}/story/${encodeURIComponent(storyId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch story: HTTP ${response.status}`);
  }
  return (await response.json()) as SavedStory;
}

export async function saveBackendStory(story: SavedStory): Promise<SavedStory> {
  const url = `${getBackendUrl().replace(/\/$/, '')}/story`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
    body: JSON.stringify(story),
  });

  if (!response.ok) {
    throw new Error(`Failed to save story: HTTP ${response.status}`);
  }
  return (await response.json()) as SavedStory;
}

export async function deleteBackendStory(storyId: string): Promise<void> {
  const url = `${getBackendUrl().replace(/\/$/, '')}/story/${encodeURIComponent(storyId)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete story: HTTP ${response.status}`);
  }
}
