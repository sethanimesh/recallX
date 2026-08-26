import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const BACKEND_URL_KEY = 'recallx:backendUrl';
const PREFERRED_PROVIDER_KEY = 'recallx:preferredProvider';
const PRONUNCIATION_VOICE_KEY = 'recallx:pronunciationVoice';
const DEFAULT_SORT_ORDER_KEY = 'recallx:defaultSortOrder';

export const DEFAULT_BACKEND_URL = 'http://localhost:8000';

const identityListeners = new Set<() => void>();
export function subscribeIdentity(listener: () => void): () => void { identityListeners.add(listener); return () => { identityListeners.delete(listener); }; }
let _token: string | null = null;
let _deviceId: string | null = null;
let _learnerId: string | null = null;
let _backendUrl: string = DEFAULT_BACKEND_URL;
let _preferredProvider: string | null = null;
let _pronunciationVoice: string | null = null;
let _defaultSortOrder: 'alphabetical' | 'newest' | 'oldest' | 'most_incorrect' = 'alphabetical';

/** Lazy accessor so Jest mocks are fully initialised before first call. */
function getStorage() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-async-storage/async-storage');
  // Real module uses a default export; Jest mock factories return a plain object.
  return mod.default ?? mod;
}

export async function initSettings(): Promise<void> {
  try {
    const storage = getStorage();
    const [url, provider, voice, sortOrder, identity] = await Promise.all([
      storage.getItem(BACKEND_URL_KEY),
      storage.getItem(PREFERRED_PROVIDER_KEY),
      storage.getItem(PRONUNCIATION_VOICE_KEY),
      storage.getItem(DEFAULT_SORT_ORDER_KEY),
      Platform.OS === 'web' ? storage.getItem('recallx:identity') : SecureStore.getItemAsync('recallx.identity'),
    ]);
    _token = null; _deviceId = null; _learnerId = null;
    if (identity) { const saved = JSON.parse(identity); _token = saved.token; _deviceId = saved.device_id; _learnerId = saved.learner_id ?? null; }
    _backendUrl = url ?? DEFAULT_BACKEND_URL;
    _preferredProvider = provider ?? null;
    _pronunciationVoice = voice ?? null;
    _defaultSortOrder = (sortOrder as any) ?? 'alphabetical';
  } catch (err) {
    console.warn('[Settings] initSettings failed, using defaults:', err);
    _token = null; _deviceId = null; _learnerId = null;
    _backendUrl = DEFAULT_BACKEND_URL;
    _preferredProvider = null;
    _pronunciationVoice = null;
    _defaultSortOrder = 'alphabetical';
  }
}

export function getBackendUrl(): string {
  return _backendUrl;
}

export async function setBackendUrl(url: string): Promise<void> {
  _backendUrl = url;
  await getStorage().setItem(BACKEND_URL_KEY, url);
}

export function getPreferredProvider(): string | null {
  return _preferredProvider;
}

export async function setPreferredProvider(provider: string | null): Promise<void> {
  _preferredProvider = provider;
  const storage = getStorage();
  if (provider === null) {
    await storage.removeItem(PREFERRED_PROVIDER_KEY);
  } else {
    await storage.setItem(PREFERRED_PROVIDER_KEY, provider);
  }
}

export function getPronunciationVoice(): string | null {
  return _pronunciationVoice;
}

export async function setPronunciationVoice(voice: string | null): Promise<void> {
  _pronunciationVoice = voice;
  const storage = getStorage();
  if (voice === null) {
    await storage.removeItem(PRONUNCIATION_VOICE_KEY);
  } else {
    await storage.setItem(PRONUNCIATION_VOICE_KEY, voice);
  }
}

export function getDefaultSortOrder(): 'alphabetical' | 'newest' | 'oldest' | 'most_incorrect' {
  return _defaultSortOrder;
}

export async function setDefaultSortOrder(order: 'alphabetical' | 'newest' | 'oldest' | 'most_incorrect'): Promise<void> {
  _defaultSortOrder = order;
  await getStorage().setItem(DEFAULT_SORT_ORDER_KEY, order);
}

export function getToken(): string | null { return _token; }
export function getDeviceId(): string | null { return _deviceId; }
export async function saveIdentity(identity: { token: string; device_id: string; learner_id?: string }): Promise<void> {
  if (Platform.OS === 'web') await getStorage().setItem('recallx:identity', JSON.stringify(identity));
  else await SecureStore.setItemAsync('recallx.identity', JSON.stringify(identity));
  _token = identity.token; _deviceId = identity.device_id; _learnerId = identity.learner_id ?? null;
  identityListeners.forEach(listener => listener());
}
export function getCommonHeaders(): Record<string, string> {
  return { ...(_preferredProvider ? { 'X-Preferred-Provider': _preferredProvider } : {}), ...(_token ? { Authorization: `Bearer ${_token}` } : {}) };
}
export async function resetSRSProgress(): Promise<void> {
  // Load lazily to avoid the settings/database initialisation cycle.
  const { api } = require('@/src/api/centralClient') as typeof import('@/src/api/centralClient');
  const { getSnapshot, readCache, writeCache } = require('@/src/db/operations/central') as typeof import('@/src/db/operations/central');
  const { syncFromServer } = require('@/src/db/operations/sync') as typeof import('@/src/db/operations/sync');
  const snapshot = await getSnapshot();
  if (!snapshot) throw new Error('Sync this device before resetting progress.');
  // Persist the reset identity too: a timeout may follow a successful server commit.
  let operation = await readCache<{ id: string; expected_generation: number }>('pending_reset');
  if (!operation) {
    operation = { id: Crypto.randomUUID(), expected_generation: snapshot.settings.progress_generation };
    await writeCache('pending_reset', operation);
  }
  await api('/progress/reset', operation);
  await writeCache('pending_reset', null);
  await syncFromServer();
}
