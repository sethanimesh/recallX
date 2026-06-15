import { sessionResults, sessions, words } from '@/src/db/schema';

const BACKEND_URL_KEY = 'recallx:backendUrl';
const PREFERRED_PROVIDER_KEY = 'recallx:preferredProvider';
const PRONUNCIATION_VOICE_KEY = 'recallx:pronunciationVoice';
const DEFAULT_SORT_ORDER_KEY = 'recallx:defaultSortOrder';

export const DEFAULT_BACKEND_URL = 'http://192.168.1.15:8000';

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
    const [url, provider, voice, sortOrder] = await Promise.all([
      storage.getItem(BACKEND_URL_KEY),
      storage.getItem(PREFERRED_PROVIDER_KEY),
      storage.getItem(PRONUNCIATION_VOICE_KEY),
      storage.getItem(DEFAULT_SORT_ORDER_KEY),
    ]);
    _backendUrl = url ?? DEFAULT_BACKEND_URL;
    _preferredProvider = provider ?? null;
    _pronunciationVoice = voice ?? null;
    _defaultSortOrder = (sortOrder as any) ?? 'alphabetical';
  } catch (err) {
    console.warn('[Settings] initSettings failed, using defaults:', err);
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

export function getCommonHeaders(): Record<string, string> {
  if (_preferredProvider) {
    return { 'X-Preferred-Provider': _preferredProvider };
  }
  return {};
}

export async function resetSRSProgress(): Promise<void> {
  const { db } = require('@/src/db/client');
  await db.transaction(async (tx: any) => {
    await tx.delete(sessionResults);
    await tx.delete(sessions);
    await tx.update(words).set({
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
}
