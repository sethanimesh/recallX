import { gradeAnswer } from '../gradeClient';
import { ApiError } from '../centralClient';
jest.mock('@/src/config/settings', () => ({ getBackendUrl: () => 'http://localhost:8000', getCommonHeaders: () => ({ Authorization: 'Bearer test-device' }) }));
const mockFetch = jest.fn(); global.fetch = mockFetch;
const request = { item_id: 'word-id', answer: 'a meaning', attempt_id: '3ba7df11-1e76-4753-9ed1-50e5b5fa5e92', content_revision: 2 };
beforeEach(() => mockFetch.mockReset());
it('sends canonical identity and version without a client-authored reference', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ assessment_id: 'assessment', decision: 'uncertain', feedback: 'Clarify.' }) });
  const result = await gradeAnswer(request);
  expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/grade', expect.objectContaining({ body: JSON.stringify({ ...request, language: 'en', assisted: false }), headers: expect.objectContaining({ Authorization: 'Bearer test-device' }) }));
  expect(result.decision).toBe('uncertain');
});
it('keeps a model outage as an error, never an incorrect recall', async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: 'Model unavailable' }) });
  await expect(gradeAnswer(request)).rejects.toEqual(new ApiError('Model unavailable', 503));
});
