import { getBackendUrl, getCommonHeaders } from '../config/settings';

export interface PromptRecord {
  id: string;
  prompt_text: string;
  default_text: string;
}

export async function fetchPrompts(): Promise<PromptRecord[]> {
  const url = `${getBackendUrl()}/prompts`;
  const res = await fetch(url, { headers: getCommonHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to fetch prompts: ${res.status}`);
  }
  return res.json();
}

export async function updatePrompt(promptId: string, promptText: string): Promise<PromptRecord> {
  const url = `${getBackendUrl()}/prompts/${promptId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
    body: JSON.stringify({ prompt_text: promptText }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update prompt: ${res.status}`);
  }
  return res.json();
}

export async function resetPrompt(promptId: string): Promise<PromptRecord> {
  const url = `${getBackendUrl()}/prompts/${promptId}/reset`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getCommonHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to reset prompt: ${res.status}`);
  }
  return res.json();
}
