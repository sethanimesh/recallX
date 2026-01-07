import { activeExtractionClient, StubExtractionClient } from '../index';

describe('activeExtractionClient.extractWords', () => {
  it('resolves with an array of length 5 when mock returns 5 words', async () => {
    const mockWords = [
      { word: 'a', definition: 'def a', example_sentence: 'ex a' },
      { word: 'b', definition: 'def b', example_sentence: 'ex b' },
      { word: 'c', definition: 'def c', example_sentence: 'ex c' },
      { word: 'd', definition: 'def d', example_sentence: 'ex d' },
      { word: 'e', definition: 'def e', example_sentence: 'ex e' },
    ];
    const spy = jest
      .spyOn(activeExtractionClient, 'extractWords')
      .mockResolvedValueOnce(mockWords);

    const result = await activeExtractionClient.extractWords({ type: 'text', content: 'hello' });
    expect(result).toHaveLength(5);

    spy.mockRestore();
  });

  it('throws when mock rejects with an error', async () => {
    const spy = jest
      .spyOn(activeExtractionClient, 'extractWords')
      .mockRejectedValueOnce(new Error('LLM failed'));

    await expect(
      activeExtractionClient.extractWords({ type: 'text', content: 'hello' })
    ).rejects.toThrow('LLM failed');

    spy.mockRestore();
  });
});

describe('StubExtractionClient shape + fake timers', () => {
  it('returns 5 words with the correct ExtractedWord shape after 400ms (fake timers)', async () => {
    jest.useFakeTimers();

    const client = new StubExtractionClient();
    const promise = client.extractWords({ type: 'text', content: 'test' });
    jest.advanceTimersByTime(400);
    const result = await promise;

    expect(result).toHaveLength(5);
    for (const word of result) {
      expect(typeof word.word).toBe('string');
      expect(word.word.length).toBeGreaterThan(0);
      expect(typeof word.definition).toBe('string');
      expect(word.definition.length).toBeGreaterThan(0);
      expect(typeof word.example_sentence).toBe('string');
      expect(word.example_sentence.length).toBeGreaterThan(0);
    }

    jest.useRealTimers();
  });
});
