import type { ExtractedWord, ExtractionClient, ImageInput, TextInput } from './types';
import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';

export { DEFAULT_BACKEND_URL } from '@/src/config/settings';

export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export class HttpExtractionClient implements ExtractionClient {
  private readonly baseUrl?: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl;
  }

  async extractWords(input: ImageInput | TextInput): Promise<ExtractedWord[]> {
    if (input.type === 'text' && /^(file|content|blob):\/\//i.test(input.content.trim())) {
      throw new ExtractionError('Upload the document bytes through document import; a file URI is not text.', 422);
    }
    const base = (this.baseUrl ?? getBackendUrl()).replace(/\/$/, '');
    const body =
      input.type === 'image'
        ? { input_type: 'image' as const, content: input.base64, mime_type: input.mimeType, instructions: input.instructions }
        : { input_type: 'text' as const, content: input.content, mime_type: null, instructions: input.instructions };

    const url = `${base}/extract`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        detail = err?.detail ?? detail;
      } catch {}
      throw new ExtractionError(`Extraction failed: ${detail}`, response.status);
    }

    const data = await response.json();
    return data as ExtractedWord[];
  }
}

export async function lookupWord(word: string, baseUrl?: string): Promise<ExtractedWord> {
  const base = (baseUrl ?? getBackendUrl()).replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getCommonHeaders() },
      body: JSON.stringify({ input_type: 'word', content: word }),
    });
  } catch {
    throw new ExtractionError('Network error', 0);
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? detail;
    } catch {}
    throw new ExtractionError(`Lookup failed: ${detail}`, response.status);
  }
  const data = await response.json() as ExtractedWord[];
  if (!data || data.length === 0) {
    throw new ExtractionError('No result returned for word lookup', 0);
  }
  return data[0];
}
