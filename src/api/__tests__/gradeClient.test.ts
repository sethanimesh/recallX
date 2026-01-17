import { gradeAnswer, GradeError } from '../gradeClient';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('gradeAnswer', () => {
  it('calls the correct endpoint with correct body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ correct: true, feedback: 'Good.' }),
    });

    await gradeAnswer('test', 'a meaning', 'the definition', 'http://localhost:8000');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/grade',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ word: 'test', user_answer: 'a meaning', stored_definition: 'the definition' }),
      }),
    );
  });

  it('returns the GradeResult', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ correct: true, feedback: 'Good.' }),
    });

    const result = await gradeAnswer('test', 'a meaning', 'the definition', 'http://localhost:8000');

    expect(result).toEqual({ correct: true, feedback: 'Good.' });
  });

  it('throws GradeError on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Upstream failed' }),
    });

    let caught: unknown;
    try {
      await gradeAnswer('test', 'a meaning', 'the definition', 'http://localhost:8000');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(GradeError);
    expect((caught as GradeError).statusCode).toBe(503);
  });
});
