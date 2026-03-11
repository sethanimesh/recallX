import { db } from '@/src/db/client';
import { words, sessions, sessionResults } from '@/src/db/schema';

const BACKEND_URL_KEY = 'recallx:backendUrl';
const PREFERRED_PROVIDER_KEY = 'recallx:preferredProvider';

export const DEFAULT_BACKEND_URL = 'http://192.168.68.104:8000';

let _backendUrl: string = DEFAULT_BACKEND_URL;
let _preferredProvider: string | null = null;

/** Lazy accessor so Jest mocks are fully initialised before first call. */
function getStorage() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-async-storage/async-storage');
  // Real module has __esModule + default export; jest mocks return a plain object.
  return mod.__esModule ? mod.default : mod;
}

export async function initSettings(): Promise<void> {
  try {
    const storage = getStorage();
    const [url, provider] = await Promise.all([
      storage.getItem(BACKEND_URL_KEY),
      storage.getItem(PREFERRED_PROVIDER_KEY),
    ]);
    _backendUrl = url ?? DEFAULT_BACKEND_URL;
    _preferredProvider = provider ?? null;
  } catch {
    // fall back to defaults — app must boot regardless
    _backendUrl = DEFAULT_BACKEND_URL;
    _preferredProvider = null;
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

export function getCommonHeaders(): Record<string, string> {
  if (_preferredProvider) {
    return { 'X-Preferred-Provider': _preferredProvider };
  }
  return {};
}

export async function resetSRSProgress(): Promise<void> {
  await db.transaction(async (tx) => {
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
