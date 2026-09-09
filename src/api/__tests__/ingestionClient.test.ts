jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'stable-upload' }));
jest.mock('@/src/config/settings', () => ({ getBackendUrl: () => 'http://localhost:8000', getCommonHeaders: () => ({ Authorization: 'Bearer paired' }) }));
const mockPending = new Map<string, unknown>();
jest.mock('@/src/db/operations/central', () => ({
  readCache: async (key: string) => mockPending.get(key) ?? null,
  writeCache: async (key: string, value: unknown) => { mockPending.set(key, value); },
  preparePendingRequest: async (key: string, body: unknown) => {
    const operation = mockPending.get(key) ?? { id: 'durable-operation', body };
    mockPending.set(key, operation); return operation;
  },
  completePendingRequest: async (key: string) => { mockPending.delete(key); },
}));

import { Platform } from 'react-native';
import { uploadDocument, uploadText, approveIngestion, saveIngestionDraft, cancelIngestionJob, correctSourceBlock } from '../ingestionClient';

const originalFetch = global.fetch;
const originalFormData = global.FormData;
class CapturedForm {
  fields: Record<string, unknown> = {};
  append(key: string, value: unknown) { this.fields[key] = value; }
}

beforeEach(() => {
  mockPending.clear();
  global.FormData = CapturedForm as unknown as typeof FormData;
  global.fetch = jest.fn();
});
afterEach(() => { global.fetch = originalFetch; global.FormData = originalFormData; });

test('browser PDF transport contains selected file bytes and lets fetch set its boundary', async () => {
  const pdfBlob = new Blob(['%PDF-1.4 actual file bytes'], { type: 'application/pdf' });
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ id: 'job' }) });
  await uploadDocument({ type: 'pdf', uri: 'blob:file', name: 'lesson.pdf', mimeType: 'application/pdf', file: pdfBlob });
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe('http://localhost:8000/ingestion/jobs');
  expect(init.body.fields.file).toBe(pdfBlob);
  expect(init.body.fields.request_id).toBe('stable-upload');
  expect(init.headers).toEqual({ Authorization: 'Bearer paired' });
});

test('native PDF uses a multipart file part and never a text content URI', async () => {
  (Platform as { OS: string }).OS = 'ios';
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ id: 'job' }) });
  await uploadDocument({ type: 'pdf', uri: 'file:///cached/lesson.pdf', name: 'lesson.pdf', mimeType: 'application/pdf' }, 'retry-id');
  const init = (global.fetch as jest.Mock).mock.calls[0][1];
  expect(init.body.fields.file).toEqual({ uri: 'file:///cached/lesson.pdf', name: 'lesson.pdf', type: 'application/pdf' });
  expect(init.body.fields.content).toBeUndefined();
  expect(init.body.fields.request_id).toBe('retry-id');
  (Platform as { OS: string }).OS = 'web';
});

test('text and approvals have explicit contracts and stable operation IDs', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ id: 'job' }) });
  await uploadText('A real passage', '', 'vocabulary_mcq', 'text-id');
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toMatchObject({ text: 'A real passage', extraction_mode: 'vocabulary_mcq', request_id: 'text-id' });
  await approveIngestion('job', 'approval-id', []);
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body).request_id).toBe('approval-id');
});

test('server failures remain visible', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 413, json: async () => ({ detail: 'Upload exceeds 20 MB' }) });
  await expect(uploadText('text')).rejects.toThrow('Upload exceeds 20 MB');
});

test('lost draft acknowledgment is resolved before submitting newer edits', async () => {
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Response lost'))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ saved: true, revision: 1 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ saved: true, revision: 2 }) });
  await expect(saveIngestionDraft('job', { revision: 0, candidates: [], request_id: 'approval-1' })).rejects.toThrow('Response lost');
  await saveIngestionDraft('job', { revision: 0, candidates: [], request_id: 'approval-2' });
  const bodies = (global.fetch as jest.Mock).mock.calls.map(call => JSON.parse(call[1].body));
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[2]).toMatchObject({ request_id: 'approval-2', expected_revision: 1 });
});

test('job controls and corrections send durable identities and observed revisions', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ id: 'job' }) });
  await cancelIngestionJob('job', 3);
  await correctSourceBlock('job', 'block', 'Corrected text', 2);
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ operation_id: 'durable-operation', expected_revision: 3 });
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toEqual({ operation_id: 'durable-operation', expected_revision: 2, text: 'Corrected text' });
});
