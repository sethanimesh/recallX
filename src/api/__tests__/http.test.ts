import { HttpExtractionClient, ExtractionError } from '../http';
import type { ImageInput, TextInput } from '../types';

const makeWord = () => ({
  word: 'test',
  definition: 'A test word.',
  example_sentence: 'This is a test.',
});

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('HttpExtractionClient', () => {
  const client = new HttpExtractionClient('http://localhost:8000');

  it('sends text input with correct body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [makeWord()],
    });

    const input: TextInput = { type: 'text', content: 'some text' };
    const result = await client.extractWords(input);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/extract',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ input_type: 'text', content: 'some text', mime_type: null }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe('test');
  });

  it('sends image input with base64 and mime_type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [makeWord()],
    });

    const input: ImageInput = {
      type: 'image',
      uri: 'file://photo.jpg',
      base64: 'abc123',
      mimeType: 'image/jpeg',
    };
    await client.extractWords(input);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/extract',
      expect.objectContaining({
        body: JSON.stringify({ input_type: 'image', content: 'abc123', mime_type: 'image/jpeg' }),
      }),
    );
  });

  it('throws ExtractionError on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: { error: 'All providers failed', failures: ['groq: RateLimitError'] } }),
    });

    const input: TextInput = { type: 'text', content: 'text' };
    await expect(client.extractWords(input)).rejects.toThrow(ExtractionError);
  });

  it('uses default base URL when none provided', () => {
    const defaultClient = new HttpExtractionClient();
    expect((defaultClient as any).baseUrl).toBe('http://localhost:8000');
  });

  it('strips trailing slash from base URL', () => {
    const c = new HttpExtractionClient('http://localhost:8000/');
    expect((c as any).baseUrl).toBe('http://localhost:8000');
  });
});
