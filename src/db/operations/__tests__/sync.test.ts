import { syncFromServer } from '../sync';
import { fetchWordsFromServer, fetchTagsFromServer } from '@/src/api/syncClient';
import { db } from '@/src/db/client';

jest.mock('@/src/api/syncClient');
jest.mock('@/src/db/client', () => ({
  db: {
    delete: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn((fn) => fn({
      delete: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

const mockFetchWords = fetchWordsFromServer as jest.Mock;
const mockFetchTags = fetchTagsFromServer as jest.Mock;

describe('syncFromServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches words and tags from server', async () => {
    mockFetchWords.mockResolvedValue([]);
    mockFetchTags.mockResolvedValue([]);
    await syncFromServer();
    expect(mockFetchWords).toHaveBeenCalledTimes(1);
    expect(mockFetchTags).toHaveBeenCalledTimes(1);
  });

  it('resolves successfully with empty server data', async () => {
    mockFetchWords.mockResolvedValue([]);
    mockFetchTags.mockResolvedValue([]);
    await expect(syncFromServer()).resolves.not.toThrow();
  });

  it('throws if fetchWordsFromServer rejects', async () => {
    mockFetchWords.mockRejectedValue(new Error('network error'));
    mockFetchTags.mockResolvedValue([]);
    await expect(syncFromServer()).rejects.toThrow('network error');
  });
});
