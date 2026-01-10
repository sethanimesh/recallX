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
      uri: 'file://test.jpg',
      base64: 'abc123',
      mimeType: 'image/jpeg',
    });
    expect(result).toHaveLength(5);
  });
});

describe('activeExtractionClient', () => {
  it('is an instance of HttpExtractionClient', () => {
    expect(activeExtractionClient).toBeInstanceOf(HttpExtractionClient);
  });
});

describe('StubExtractionClient (still exported from index)', () => {
  it('StubExtractionClient is still exported from index', () => {
    expect(StubFromIndex).toBeDefined();
    expect(new StubFromIndex()).toBeInstanceOf(StubFromIndex);
  });
});
