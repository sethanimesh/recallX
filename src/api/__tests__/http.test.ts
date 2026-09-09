jest.mock('@/src/db/client', () => ({ db: { transaction: jest.fn() } }));
jest.mock('@/src/db/schema', () => ({ words: 'words', sessions: 'sessions', sessionResults: 'sessionResults' }));

import { HttpExtractionClient, ExtractionError, lookupWord } from '../http';
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
    // baseUrl is undefined; getBackendUrl() is called at request time
    expect((defaultClient as any).baseUrl).toBeUndefined();
  });

  it('stores base URL as-is (trailing slash stripped at request time)', () => {
    const c = new HttpExtractionClient('http://localhost:8000/');
    expect((c as any).baseUrl).toBe('http://localhost:8000/');
  });
});

describe('lookupWord', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('POSTs to /extract with input_type word', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ word: 'pellucid', definition: 'Translucently clear.', example_sentence: 'A pellucid stream.' }],
    });

    const result = await lookupWord('pellucid', 'http://localhost:8000');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/extract',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ input_type: 'word', content: 'pellucid' }),
      }),
    );
    expect(result.word).toBe('pellucid');
    expect(result.definition).toBe('Translucently clear.');
    expect(result.example_sentence).toBe('A pellucid stream.');
  });

  it('throws ExtractionError on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'All providers failed' }),
    });

    await expect(lookupWord('test', 'http://localhost:8000')).rejects.toThrow(ExtractionError);
  });

  it('throws ExtractionError when result array is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await expect(lookupWord('test', 'http://localhost:8000')).rejects.toThrow(ExtractionError);
  });

  it('throws ExtractionError on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(lookupWord('test', 'http://localhost:8000')).rejects.toThrow(ExtractionError);
  });
});
