import { StubExtractionClient } from '../stub';
import { activeExtractionClient, StubExtractionClient as StubFromIndex, HttpExtractionClient } from '../index';

describe('StubExtractionClient', () => {
  const client = new StubExtractionClient();

  it('resolves to exactly 5 words', async () => {
    const result = await client.extractWords({ type: 'text', content: 'test' });
    expect(result).toHaveLength(5);
  });

  it('each word has non-empty word, definition, and example_sentence', async () => {
    const result = await client.extractWords({ type: 'text', content: 'test' });
    for (const word of result) {
      expect(word.word).toBeTruthy();
      expect(word.definition).toBeTruthy();
      expect(word.example_sentence).toBeTruthy();
    }
  });

  it('accepts an ImageInput without error', async () => {
    const result = await client.extractWords({
      type: 'image',
      base64: 'abc123',
      mimeType: 'image/jpeg',
    });
    expect(result).toHaveLength(5);
  });
});

describe('activeExtractionClient', () => {
  it('is an instance of StubExtractionClient', () => {
    expect(activeExtractionClient).toBeInstanceOf(StubFromIndex);
  });
});

describe('HttpExtractionClient', () => {
  it('throws "not implemented"', async () => {
    const client = new HttpExtractionClient('http://localhost:8000');
    await expect(client.extractWords({ type: 'text', content: 'x' })).rejects.toThrow('not implemented');
  });
});
