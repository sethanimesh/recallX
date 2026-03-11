import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';

export type Period = 'today' | 'week' | 'month' | 'all';

export interface ProviderCount {
  provider: string;
  model: string;
  count: number;
}

export interface LlmCall {
  provider: string;
  model: string;
  task: string;
  called_at: number;
}

export interface LlmStatsResponse {
  period: Period;
  total_calls: number;
  by_provider: ProviderCount[];
  calls: LlmCall[];
}

export class StatsError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'StatsError';
  }
}

export async function fetchLlmStats(
  period: Period,
  baseUrl?: string,
): Promise<LlmStatsResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${(baseUrl ?? getBackendUrl()).replace(/\/$/, '')}/stats/llm?period=${period}`,
      { headers: getCommonHeaders() },
    );
  } catch {
    throw new StatsError('Network error', 0);
  }
  if (!response.ok) {
    throw new StatsError(`Failed to fetch LLM stats: HTTP ${response.status}`, response.status);
  }
  return response.json() as Promise<LlmStatsResponse>;
}
