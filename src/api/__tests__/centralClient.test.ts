import { api } from '../centralClient';

jest.mock('@/src/config/settings', () => ({ getBackendUrl: () => 'http://localhost:8000', getCommonHeaders: () => ({}) }));

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it.each(['/assessments', '/grade', '/tutor/chat'])('waits beyond the server model timeout for %s', async path => {
  let signal: AbortSignal | undefined;
  let complete!: (response: unknown) => void;
  global.fetch = jest.fn((_url, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise(resolve => { complete = resolve; });
  }) as jest.Mock;
  const pending = api(path, {});
  jest.advanceTimersByTime(200000);
  expect(signal?.aborted).toBe(false);
  complete({ ok: true, json: async () => ({ decision: 'uncertain' }) });
  await expect(pending).resolves.toEqual({ decision: 'uncertain' });
});

it('keeps ordinary sync requests bounded when the server cannot be reached', async () => {
  let signal: AbortSignal | undefined;
  let complete!: (response: unknown) => void;
  global.fetch = jest.fn((_url, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise(resolve => { complete = resolve; });
  }) as jest.Mock;
  const pending = api('/sync/snapshot');
  jest.advanceTimersByTime(15000);
  expect(signal?.aborted).toBe(true);
  complete({ ok: true, json: async () => ({}) });
  await pending;
});
