import * as SecureStore from 'expo-secure-store';
import { preparePairingAttempt, readPairingAttempt, savePairingAttempt } from '../pairing';
jest.mock('expo-crypto', () => ({ randomUUID: () => 'stable-pairing-uuid' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
let value: string | null;
beforeEach(() => {
  value = null; jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async () => value);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (_key, saved) => { value = saved; });
});
it('persists a pairing UUID before transmission and recovers its exact identity', async () => {
  const first = await preparePairingAttempt('bootstrap', 'Phone', 'http://localhost:8000');
  expect(SecureStore.setItemAsync).toHaveBeenCalled();
  expect(await preparePairingAttempt('bootstrap', 'Phone', 'http://localhost:8000')).toEqual(first);
  expect(JSON.parse(value!)).not.toHaveProperty('bootstrap_secret');
  await expect(preparePairingAttempt('start', 'TV', 'http://localhost:8000')).rejects.toThrow('already pending');
});
it('retains the issued pairing code and poll token securely across a restart', async () => {
  const pending = await preparePairingAttempt('start', 'TV', 'http://localhost:8000');
  await savePairingAttempt({ ...pending, result: { id: 'session', code: '123456', poll_token: 'credential', expires_at: '2026-10-01T00:00:00Z' } });
  expect((await readPairingAttempt())?.result?.poll_token).toBe('credential');
});
