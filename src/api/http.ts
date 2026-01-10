import type { ExtractedWord, ExtractionClient, ImageInput, TextInput } from './types';

const DEFAULT_BASE_URL = 'http://192.168.68.104:8000'; // Phase 8: make configurable in Settings

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
  private readonly baseUrl: string;

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // strip trailing slash
  }

  async extractWords(input: ImageInput | TextInput): Promise<ExtractedWord[]> {
    const body =
      input.type === 'image'
        ? { input_type: 'image' as const, content: input.base64, mime_type: input.mimeType }
        : { input_type: 'text' as const, content: input.content, mime_type: null };

    const url = `${this.baseUrl}/extract`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
