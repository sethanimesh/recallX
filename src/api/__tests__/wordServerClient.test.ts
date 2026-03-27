jest.mock('@/src/db/client', () => ({ db: { transaction: jest.fn() } }));
jest.mock('@/src/db/schema', () => ({ words: 'words', sessions: 'sessions', sessionResults: 'sessionResults' }));

import {
  postWord,
  patchWord,
  deleteWord,
  postTag,
  patchTag,
  deleteTag,
  mergeTag,
  addTagToWord,
  removeTagFromWord,
  getWords,
  getTags,
  WordServerError,
} from '../wordServerClient';

const BASE = 'http://localhost:8000';

beforeEach(() => {
  global.fetch = jest.fn();
});

function mockResponse(status: number, body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('postWord', () => {
  it('calls POST /words with correct body', async () => {
    const record = { id: 'w1', word: 'ephemeral', definition: 'def',
      example_sentence: 'ex', source_type: null, created_at: 1000,
      updated_at: 1000, deleted_at: null, tags: [] };
    mockResponse(201, record);
    const result = await postWord(
      { id: 'w1', word: 'ephemeral', definition: 'def',
        example_sentence: 'ex', source_type: null, created_at: 1000, updated_at: 1000 },
      BASE,
    );
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words`, expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"word":"ephemeral"'),
    }));
    expect(result).toEqual(record);
  });

  it('throws WordServerError with status 409 on duplicate', async () => {
    mockResponse(409, { detail: 'Word already exists' });
    await expect(
      postWord({ id: 'w1', word: 'x', definition: 'd', example_sentence: 'e',
        source_type: null, created_at: 1000, updated_at: 1000 }, BASE),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('patchWord', () => {
  it('calls PATCH /words/{id}', async () => {
    mockResponse(200, { id: 'w1', word: 'ephemeral', definition: 'new def',
      example_sentence: 'ex', source_type: null, created_at: 1000,
      updated_at: 2000, deleted_at: null, tags: [] });
    const result = await patchWord('w1', { definition: 'new def' }, BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words/w1`, expect.objectContaining({
      method: 'PATCH',
    }));
    expect(result.definition).toBe('new def');
  });
});

describe('deleteWord', () => {
  it('calls DELETE /words/{id}', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204, json: async () => null });
    await deleteWord('w1', BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words/w1`, expect.objectContaining({
      method: 'DELETE',
    }));
  });
});

describe('postTag', () => {
  it('calls POST /tags', async () => {
    mockResponse(201, { id: 't1', name: 'GRE', word_count: 0 });
    const result = await postTag({ id: 't1', name: 'GRE' }, BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/tags`, expect.objectContaining({
      method: 'POST',
    }));
    expect(result.id).toBe('t1');
  });
});

describe('addTagToWord', () => {
  it('calls POST /words/{id}/tags/{tag_id}', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204, json: async () => null });
    await addTagToWord('w1', 't1', BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words/w1/tags/t1`, expect.objectContaining({
      method: 'POST',
    }));
  });
});

describe('removeTagFromWord', () => {
  it('calls DELETE /words/{id}/tags/{tag_id}', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204, json: async () => null });
    await removeTagFromWord('w1', 't1', BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words/w1/tags/t1`, expect.objectContaining({
      method: 'DELETE',
    }));
  });
});

describe('mergeTag', () => {
  it('calls POST /tags/{source_tag_id}/merge', async () => {
    mockResponse(200, { id: 'target', name: 'GRE', word_count: 2 });
    const result = await mergeTag('source', 'target', BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/tags/source/merge`, expect.objectContaining({
      method: 'POST',
      body: '{"target_tag_id":"target"}',
    }));
    expect(result.id).toBe('target');
  });
});

describe('getWords', () => {
  it('calls GET /words', async () => {
    mockResponse(200, []);
    const result = await getWords(BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/words`, expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual([]);
  });
});

describe('getTags', () => {
  it('calls GET /tags', async () => {
    mockResponse(200, []);
    const result = await getTags(BASE);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/tags`, expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual([]);
  });
});

describe('network error', () => {
  it('throws WordServerError with statusCode 0 when fetch rejects', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(getWords(BASE)).rejects.toMatchObject({ statusCode: 0 });
  });
});

describe('WordServerError', () => {
  it('throws on non-2xx', async () => {
    mockResponse(503, { detail: 'unavailable' });
    await expect(postTag({ id: 't1', name: 'x' }, BASE)).rejects.toBeInstanceOf(WordServerError);
  });
});
