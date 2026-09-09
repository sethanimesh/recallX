const mockRecords = new Map<string, unknown>();
const mockUpload = jest.fn();
const mockText = jest.fn();
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'stable-import-id' }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/', EncodingType: { Base64: 'base64' },
  getInfoAsync: async () => ({ exists: true, size: 16 }),
  readAsStringAsync: async () => 'JVBERi1wcmVzZXJ2ZWQ=',
  writeAsStringAsync: (...args: unknown[]) => mockWriteFile(...args), deleteAsync: async () => {},
}));
jest.mock('@/src/config/settings', () => ({ getBackendUrl: () => 'http://paired-mac' }));
jest.mock('@/src/api/ingestionClient', () => ({ uploadDocument: (...args: unknown[]) => mockUpload(...args), uploadText: (...args: unknown[]) => mockText(...args) }));
jest.mock('../central', () => ({
  readCache: async (key: string) => mockRecords.get(key) ?? null,
  writeCache: async (key: string, value: unknown) => { mockRecords.set(key, JSON.parse(JSON.stringify(value))); },
}));
jest.mock('@/src/db/client', () => ({ db: { select: () => ({ from: () => ({ where: async () => [...mockRecords.values()].map(value => ({ payload: JSON.stringify(value) })) }) }) } }));
jest.mock('@/src/db/schema', () => ({ cacheRecords: { key: 'key' } }));
jest.mock('drizzle-orm', () => ({ like: jest.fn() }));

import { queueDocumentImport, queueTextImport, pendingImports, retryPendingImport } from '../pendingImports';

beforeEach(() => { mockRecords.clear(); mockUpload.mockReset(); mockText.mockReset(); mockWriteFile.mockClear(); });

test('lost upload acknowledgement preserves original bytes and UUID for a later retry', async () => {
  const id = await queueDocumentImport({ type: 'pdf', uri: 'file:///picker-cache/temporary.pdf', name: 'lesson.pdf', mimeType: 'application/pdf' });
  expect(mockUpload).not.toHaveBeenCalled();
  mockUpload.mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce({ id: 'server-job', status: 'queued' });
  await expect(retryPendingImport(id)).rejects.toThrow('Lost response');
  expect(await pendingImports()).toEqual([expect.objectContaining({ id, status: 'pending', error: 'Lost response', document: expect.objectContaining({ base64: 'JVBERi1wcmVzZXJ2ZWQ=' }) })]);
  await expect(retryPendingImport((await pendingImports())[0].id)).resolves.toMatchObject({ id: 'server-job' });
  expect(mockUpload.mock.calls[0]).toEqual(mockUpload.mock.calls[1]);
  expect(mockUpload.mock.calls[1][1]).toBe(id);
  expect(mockWriteFile).toHaveBeenNthCalledWith(2, `file:///documents/recallx-upload-${id}`, 'JVBERi1wcmVzZXJ2ZWQ=', { encoding: 'base64' });
  expect(await pendingImports()).toEqual([]);
  expect(mockRecords.get(`pending-import:${id}`)).toMatchObject({ status: 'acknowledged', job: { id: 'server-job' } });
});

test('text retry uses the durable payload even after the editor is gone', async () => {
  const id = await queueTextImport('Saved passage', 'Only vocabulary', 'vocabulary_mcq');
  mockText.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ id: 'text-job' });
  await expect(retryPendingImport(id)).rejects.toThrow('Offline');
  await retryPendingImport(id);
  expect(mockText.mock.calls).toEqual([['Saved passage', 'Only vocabulary', 'vocabulary_mcq', id], ['Saved passage', 'Only vocabulary', 'vocabulary_mcq', id]]);
  await retryPendingImport(id);
  expect(mockText).toHaveBeenCalledTimes(2);
});
