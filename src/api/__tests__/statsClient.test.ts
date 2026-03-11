import { fetchLlmStats, StatsError, LlmStatsResponse } from '../statsClient';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchLlmStats', () => {
  it('successfully fetches and returns parsed JSON as LlmStatsResponse', async () => {
    const mockStats: LlmStatsResponse = {
      period: 'today',
      total_calls: 5,
      by_provider: [
        { provider: 'openai', model: 'gpt-4', count: 3 },
        { provider: 'anthropic', model: 'claude-3', count: 2 },
      ],
      calls: [
        { provider: 'openai', model: 'gpt-4', task: 'grade', called_at: 1609459200000 },
        { provider: 'anthropic', model: 'claude-3', task: 'summarize', called_at: 1609459201000 },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStats,
    });

    const result = await fetchLlmStats('today', 'http://localhost:8000');

    expect(result).toEqual(mockStats);
  });

  it('throws StatsError with statusCode 0 on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failed'));

    let caught: unknown;
    try {
      await fetchLlmStats('today', 'http://localhost:8000');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(StatsError);
    expect((caught as StatsError).statusCode).toBe(0);
    expect((caught as StatsError).message).toBe('Network error');
  });

  it('throws StatsError with statusCode 503 on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Service unavailable' }),
    });

    let caught: unknown;
    try {
      await fetchLlmStats('today', 'http://localhost:8000');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(StatsError);
    expect((caught as StatsError).statusCode).toBe(503);
  });

  it('strips trailing slash from baseUrl', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        period: 'today',
        total_calls: 0,
        by_provider: [],
        calls: [],
      }),
    });

    await fetchLlmStats('today', 'http://localhost:8000/');

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/stats/llm?period=today');
  });
});
