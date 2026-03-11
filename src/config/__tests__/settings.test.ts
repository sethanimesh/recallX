// Mocks must be declared before imports

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRemoveItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: mockGetItem,
  setItem: mockSetItem,
  removeItem: mockRemoveItem,
}));

const mockSet = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockReturnValue({ set: mockSet });
const mockDelete = jest.fn().mockResolvedValue(undefined);
const mockTx = { delete: mockDelete, update: mockUpdate };

jest.mock('@/src/db/client', () => ({
  db: {
    transaction: jest.fn((fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
  },
}));

jest.mock('@/src/db/schema', () => ({
  words: 'words-table',
  sessions: 'sessions-table',
  sessionResults: 'session-results-table',
}));

import {
  initSettings,
  getBackendUrl,
  setBackendUrl,
  getPreferredProvider,
  setPreferredProvider,
  getCommonHeaders,
  resetSRSProgress,
  DEFAULT_BACKEND_URL,
} from '../settings';

beforeEach(() => {
  mockGetItem.mockReset();
  mockSetItem.mockReset();
  mockRemoveItem.mockReset();
  mockDelete.mockReset().mockResolvedValue(undefined);
  mockUpdate.mockReset().mockReturnValue({ set: mockSet });
  mockSet.mockReset().mockResolvedValue(undefined);
});

describe('initSettings', () => {
  it('loads backendUrl and preferredProvider from AsyncStorage', async () => {
    mockGetItem
      .mockResolvedValueOnce('http://192.168.1.50:8000')
      .mockResolvedValueOnce('gemini');
    await initSettings();
    expect(getBackendUrl()).toBe('http://192.168.1.50:8000');
    expect(getPreferredProvider()).toBe('gemini');
  });

  it('falls back to defaults when AsyncStorage returns null', async () => {
    mockGetItem.mockResolvedValue(null);
    await initSettings();
    expect(getBackendUrl()).toBe(DEFAULT_BACKEND_URL);
    expect(getPreferredProvider()).toBeNull();
  });

  it('falls back to defaults when AsyncStorage throws', async () => {
    mockGetItem.mockRejectedValue(new Error('Storage unavailable'));
    await initSettings();
    expect(getBackendUrl()).toBe(DEFAULT_BACKEND_URL);
    expect(getPreferredProvider()).toBeNull();
  });
});

describe('setBackendUrl / getBackendUrl', () => {
  it('updates the in-memory URL and persists to AsyncStorage', async () => {
    await setBackendUrl('http://10.0.0.1:8000');
    expect(getBackendUrl()).toBe('http://10.0.0.1:8000');
    expect(mockSetItem).toHaveBeenCalledWith('recallx:backendUrl', 'http://10.0.0.1:8000');
  });
});

describe('setPreferredProvider / getPreferredProvider', () => {
  it('stores a provider name and persists it', async () => {
    await setPreferredProvider('groq');
    expect(getPreferredProvider()).toBe('groq');
    expect(mockSetItem).toHaveBeenCalledWith('recallx:preferredProvider', 'groq');
  });

  it('clears the provider when set to null and removes from AsyncStorage', async () => {
    await setPreferredProvider('groq');
    await setPreferredProvider(null);
    expect(getPreferredProvider()).toBeNull();
    expect(mockRemoveItem).toHaveBeenCalledWith('recallx:preferredProvider');
  });
});

describe('getCommonHeaders', () => {
  it('returns empty object when no provider is set', async () => {
    await setPreferredProvider(null);
    expect(getCommonHeaders()).toEqual({});
  });

  it('returns X-Preferred-Provider header when a provider is set', async () => {
    await setPreferredProvider('gemini');
    expect(getCommonHeaders()).toEqual({ 'X-Preferred-Provider': 'gemini' });
  });
});

describe('resetSRSProgress', () => {
  it('deletes session_results and sessions, then resets all SRS fields on words', async () => {
    await resetSRSProgress();
    expect(mockDelete).toHaveBeenCalledWith('session-results-table');
    expect(mockDelete).toHaveBeenCalledWith('sessions-table');
    expect(mockUpdate).toHaveBeenCalledWith('words-table');
    expect(mockSet).toHaveBeenCalledWith({
      srs_interval: 0,
      srs_ease_factor: 2.5,
      srs_wrong_count: 0,
      srs_consecutive_correct: 0,
      srs_next_review_at: null,
      fc_interval: 0,
      fc_ease_factor: 2.5,
      fc_wrong_count: 0,
      fc_consecutive_correct: 0,
      fc_next_review_at: null,
    });
  });
});
