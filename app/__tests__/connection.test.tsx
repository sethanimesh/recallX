import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import ConnectionScreen from '../connection';
import { api } from '@/src/api/centralClient';
import { getToken } from '@/src/config/settings';
import { readPairingAttempt, preparePairingAttempt } from '@/src/config/pairing';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/src/config/settings', () => ({ getBackendUrl: () => 'http://localhost:8000', getDeviceId: () => 'current', getToken: jest.fn().mockReturnValue(null), setBackendUrl: jest.fn().mockResolvedValue(undefined), saveIdentity: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/src/api/centralClient', () => ({ ...jest.requireActual('@/src/api/centralClient'), api: jest.fn() }));
jest.mock('@/src/db/operations/central', () => ({ allOperations: jest.fn().mockResolvedValue([]), getSnapshot: jest.fn().mockResolvedValue(null), readCache: jest.fn().mockResolvedValue(null), preparePendingRequest: jest.fn(async (_key, body) => ({ id: 'operation-id', body })), completePendingRequest: jest.fn().mockResolvedValue(undefined), failPendingRequest: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/src/config/pairing', () => ({ readPairingAttempt: jest.fn().mockResolvedValue(null), preparePairingAttempt: jest.fn(async (kind, device_name, server_url) => ({ operation_id: 'pair-operation', kind, device_name, server_url })), savePairingAttempt: jest.fn().mockResolvedValue(undefined), clearPairingAttempt: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/src/db/operations/libraryMutations', () => ({ allLibraryMutations: jest.fn().mockResolvedValue([]) }));
jest.mock('@/src/db/operations/sync', () => ({ syncFromServer: jest.fn().mockResolvedValue(undefined) }));

beforeEach(() => { jest.clearAllMocks(); (getToken as jest.Mock).mockReturnValue(null); (readPairingAttempt as jest.Mock).mockResolvedValue(null); });
afterEach(() => jest.useRealTimers());

it('waits for the previous pairing poll before scheduling another request', async () => {
  jest.useFakeTimers();
  let finishPoll!: (result: unknown) => void;
  (api as jest.Mock).mockImplementation(path => path === '/pairing/start'
    ? Promise.resolve({ id: 'pair', code: '123456', poll_token: 'token', expires_at: '2026-10-01T00:00:00Z' })
    : new Promise(resolve => { finishPoll = resolve; }));
  const ui = render(<ConnectionScreen />);
  await act(async () => { fireEvent.press(ui.getByText('Show pairing code')); });
  expect(api).toHaveBeenCalledTimes(2);
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(api).toHaveBeenCalledTimes(2);
  await act(async () => { finishPoll({ status: 'pending' }); });
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(api).toHaveBeenCalledTimes(3);
  ui.unmount();
  await act(async () => { finishPoll({ status: 'pending' }); jest.advanceTimersByTime(6000); });
  expect(api).toHaveBeenCalledTimes(3);
});

it('revokes the selected other device after confirming its identity', async () => {
  (getToken as jest.Mock).mockReturnValue('paired-token');
  let revoked = false;
  (api as jest.Mock).mockImplementation(async (_path, _body, method) => {
    if (method === 'DELETE') { revoked = true; return { status: 'revoked' }; }
    return [{ id: 'current', name: 'Phone', revoked_at: null }, ...(!revoked ? [{ id: 'tv-device', name: 'Living room TV', revoked_at: null }] : [])];
  });
  const ui = render(<ConnectionScreen />); await ui.findByText('Revoke Living room TV');
  expect(ui.queryByText('Revoke Phone')).toBeNull();
  await act(async () => { fireEvent.press(ui.getByText('Revoke Living room TV')); });
  expect(revoked).toBe(false);
  await act(async () => { fireEvent.press(ui.getByText('Confirm revoke Living room TV')); });
  await ui.findByText('Living room TV can no longer access your library.');
  expect(api).toHaveBeenCalledWith('/pairing/devices/tv-device', undefined, 'DELETE', { 'X-Operation-ID': 'operation-id' });
});
it('resumes the stored pairing code and poll credentials after reopening', async () => {
  (readPairingAttempt as jest.Mock).mockResolvedValue({ operation_id: 'saved-attempt', kind: 'start', device_name: 'TV', server_url: 'http://localhost:8000', result: { id: 'saved-session', code: '654321', poll_token: 'saved-poll', expires_at: '2026-10-01T00:00:00Z' } });
  (api as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const ui = render(<ConnectionScreen />); await ui.findByText('654321');
  expect(api).toHaveBeenCalledWith('/pairing/saved-session?poll_token=saved-poll');
  expect(preparePairingAttempt).not.toHaveBeenCalled(); ui.unmount();
});
