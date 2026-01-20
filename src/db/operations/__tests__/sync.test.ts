import { syncFromServer } from '../sync';
import { fetchWordsFromServer, fetchTagsFromServer } from '@/src/api/syncClient';

jest.mock('@/src/api/syncClient');

const mockFetchWords = fetchWordsFromServer as jest.Mock;
const mockFetchTags = fetchTagsFromServer as jest.Mock;

// Per-call tx spies for verifying transaction body
function makeTx() {
  const deleteBuilder = { execute: jest.fn().mockResolvedValue(undefined) };
  const valuesBuilder = { execute: jest.fn().mockResolvedValue(undefined) };
  const insertBuilder = { values: jest.fn().mockReturnValue(valuesBuilder) };

  const txDelete = jest.fn().mockReturnValue(deleteBuilder);
  const txInsert = jest.fn().mockReturnValue(insertBuilder);

  const tx = { delete: txDelete, insert: txInsert };
  return { tx, deleteBuilder, insertBuilder, valuesBuilder };
}

jest.mock('@/src/db/client', () => ({ db: { transaction: jest.fn() } }));
import { db } from '@/src/db/client';
import { words, tags, wordTags } from '@/src/db/schema';

const mockTransaction = db.transaction as jest.Mock;

describe('syncFromServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches words and tags from server', async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation((fn: Function) => fn(tx));
    mockFetchWords.mockResolvedValue([]);
    mockFetchTags.mockResolvedValue([]);
    await syncFromServer();
    expect(mockFetchWords).toHaveBeenCalledTimes(1);
    expect(mockFetchTags).toHaveBeenCalledTimes(1);
  });

  it('deletes wordTags, words, tags in that order', async () => {
    const { tx } = makeTx();
    const deleteOrder: unknown[] = [];
    tx.delete.mockImplementation((table: unknown) => {
      deleteOrder.push(table);
      return { execute: jest.fn().mockResolvedValue(undefined) };
    });
    mockTransaction.mockImplementation((fn: Function) => fn(tx));
    mockFetchWords.mockResolvedValue([]);
    mockFetchTags.mockResolvedValue([]);
    await syncFromServer();
    expect(deleteOrder).toEqual([wordTags, words, tags]);
  });

  it('inserts server tags into local db', async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation((fn: Function) => fn(tx));
    mockFetchWords.mockResolvedValue([]);
    mockFetchTags.mockResolvedValue([{ id: 't1', name: 'GRE' }]);
    await syncFromServer();
    expect(tx.insert).toHaveBeenCalledWith(tags);
    const insertCall = (tx.insert as jest.Mock).mock.results.find(
      (r: jest.MockResult<unknown>) => r.type === 'return',
    );
    expect((insertCall?.value as { values: jest.Mock }).values).toHaveBeenCalledWith([{ id: 't1', name: 'GRE' }]);
  });

  it('inserts active words with Date conversion', async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation((fn: Function) => fn(tx));
    const serverWord = {
      id: 'w1', word: 'ephemeral', definition: 'def', example_sentence: 'ex',
      source_type: null, created_at: 1000, updated_at: 2000, deleted_at: null, tags: [],
    };
    mockFetchWords.mockResolvedValue([serverWord]);
    mockFetchTags.mockResolvedValue([]);
    await syncFromServer();
    expect(tx.insert).toHaveBeenCalledWith(words);
    const wordsInsertBuilder = (tx.insert as jest.Mock).mock.results.find(
      (_: jest.MockResult<unknown>, i: number) =>
        (tx.insert as jest.Mock).mock.calls[i][0] === words,
    );
    expect(wordsInsertBuilder?.value.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'w1',
          created_at: new Date(1000),
          updated_at: new Date(2000),
        }),
      ]),
    );
  });

  it('excludes soft-deleted words', async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation((fn: Function) => fn(tx));
    mockFetchWords.mockResolvedValue([
      { id: 'w1', word: 'a', definition: 'd', example_sentence: 'e',
        source_type: null, created_at: 1000, updated_at: 1000, deleted_at: 999, tags: [] },
    ]);
    mockFetchTags.mockResolvedValue([]);
    await syncFromServer();
    // words.insert should NOT be called (no active words)
    const wordInsertCalls = (tx.insert as jest.Mock).mock.calls.filter(
      (call: unknown[]) => call[0] === words,
    );
    expect(wordInsertCalls).toHaveLength(0);
  });

  it('inserts word-tag pairs from words tags array', async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation((fn: Function) => fn(tx));
    mockFetchWords.mockResolvedValue([
      { id: 'w1', word: 'a', definition: 'd', example_sentence: 'e',
        source_type: null, created_at: 1000, updated_at: 1000, deleted_at: null,
        tags: [{ id: 't1', name: 'GRE' }] },
    ]);
    mockFetchTags.mockResolvedValue([]);
    await syncFromServer();
    expect(tx.insert).toHaveBeenCalledWith(wordTags);
  });

  it('throws if fetchWordsFromServer rejects', async () => {
    mockFetchWords.mockRejectedValue(new Error('network error'));
    mockFetchTags.mockResolvedValue([]);
    await expect(syncFromServer()).rejects.toThrow('network error');
  });
});
