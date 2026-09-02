import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PairingSession = { id: string; code: string; poll_token: string; expires_at: string };
export type PairingAttempt = { operation_id: string; kind: 'bootstrap' | 'start'; device_name: string; server_url: string; result?: PairingSession };
const key = 'recallx.pending-pairing';
export async function readPairingAttempt(): Promise<PairingAttempt | null> {
  const saved = Platform.OS === 'web' ? await AsyncStorage.getItem(key) : await SecureStore.getItemAsync(key);
  return saved ? JSON.parse(saved) : null;
}
export async function savePairingAttempt(attempt: PairingAttempt): Promise<void> {
  const value = JSON.stringify(attempt);
  if (Platform.OS === 'web') await AsyncStorage.setItem(key, value); else await SecureStore.setItemAsync(key, value);
}
export async function clearPairingAttempt(): Promise<void> {
  if (Platform.OS === 'web') await AsyncStorage.removeItem(key); else await SecureStore.deleteItemAsync(key);
}
export async function preparePairingAttempt(kind: PairingAttempt['kind'], deviceName: string, serverUrl: string): Promise<PairingAttempt> {
  const pending = await readPairingAttempt();
  if (pending) {
    if (pending.kind !== kind || pending.device_name !== deviceName || pending.server_url !== serverUrl) throw new Error('A pairing request is already pending. Recover it or discard it before starting a different request.');
    return pending;
  }
  const attempt: PairingAttempt = { operation_id: Crypto.randomUUID(), kind, device_name: deviceName, server_url: serverUrl };
  await savePairingAttempt(attempt); return attempt;
}
