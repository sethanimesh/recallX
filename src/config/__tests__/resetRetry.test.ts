const mockCache = new Map<string, unknown>();
const mockApi = jest.fn();
const mockSnapshot = { settings: { progress_generation: 0 } };
jest.mock('expo-crypto', () => ({ randomUUID: () => 'first-reset-id' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('@/src/api/centralClient', () => ({ api: (...args: unknown[]) => mockApi(...args) }));
jest.mock('@/src/db/operations/central', () => ({
  getSnapshot: async () => mockSnapshot,
  readCache: async (key: string) => mockCache.get(key),
  writeCache: async (key: string, value: unknown) => { mockCache.set(key, value); },
}));
jest.mock('@/src/db/operations/sync', () => ({ syncFromServer: async () => {} }));
import { resetSRSProgress } from '../settings';

test('a refreshed generation after a lost reset response does not allocate another reset', async () => {
  mockApi.mockRejectedValueOnce(new Error('Lost acknowledgment')).mockResolvedValueOnce({ progress_generation: 1 });
  await expect(resetSRSProgress()).rejects.toThrow('Lost acknowledgment');
  mockSnapshot.settings.progress_generation = 1;
  await resetSRSProgress();
  expect(mockApi.mock.calls).toEqual([
    ['/progress/reset', { id: 'first-reset-id', expected_generation: 0 }],
    ['/progress/reset', { id: 'first-reset-id', expected_generation: 0 }],
  ]);
  expect(mockCache.get('pending_reset')).toBeNull();
});
