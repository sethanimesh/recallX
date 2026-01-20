/**
 * NOTE: As of Task Group 1, `app/ingest.tsx` no longer calls `insertExtraction` directly.
 * Persistence is now gated behind the review screen: ingest stores extracted words in the
 * module-level pending store (`src/store/pendingWords.ts`) and navigates to `/review`.
 * The review screen is responsible for calling `insertExtraction` for each accepted word.
 *
 * The tests below verify the `insertExtraction` function itself.
 * Duplicate detection is now server-first: a 409 from `postWord` means duplicate.
 */
import { insertExtraction } from '../operations/insertExtraction';
import { db } from '@/src/db/client';
import { postWord, WordServerError } from '@/src/api/wordServerClient';

jest.mock('@/src/db/client', () => ({
  db: {
    transaction: jest.fn(),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid'),
}));

jest.mock('@/src/api/wordServerClient', () => ({
  postWord: jest.fn(),
  WordServerError: class WordServerError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'WordServerError';
      this.statusCode = statusCode;
    }
  },
}));

const mockValues = jest.fn();
const mockInsert = jest.fn(() => ({ values: mockValues }));
const mockTx = { insert: mockInsert };

beforeEach(() => {
  jest.clearAllMocks();
  mockValues.mockResolvedValue(undefined);
  mockInsert.mockReturnValue({ values: mockValues });
  (db.transaction as jest.Mock).mockImplementation(
    async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx),
  );
  (postWord as jest.Mock).mockResolvedValue(undefined);
});

const sampleWords = [
  { word: 'ephemeral', definition: 'Lasting briefly.', example_sentence: 'The joy was ephemeral.' },
  { word: 'lucid', definition: 'Clearly expressed.', example_sentence: 'A lucid explanation.' },
];

describe('insertExtraction', () => {
  it('runs a transaction when words are provided', async () => {
    await insertExtraction('file://photo.jpg', 'image', sampleWords);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('inserts one source row and N word rows inside the transaction', async () => {
    await insertExtraction('file://photo.jpg', 'image', sampleWords);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    const wordRows = mockValues.mock.calls[1][0] as unknown[];
    expect(wordRows).toHaveLength(2);
  });

  it('propagates DB errors so the transaction rolls back', async () => {
    (db.transaction as jest.Mock).mockRejectedValueOnce(new Error('SQLITE_FULL'));
    await expect(insertExtraction('file://photo.jpg', 'image', sampleWords)).rejects.toThrow('SQLITE_FULL');
  });

  it('skips the transaction when word list is empty', async () => {
    const result = await insertExtraction('file://photo.jpg', 'image', []);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(result).toEqual({ insertedIds: [], duplicates: [] });
  });

  it('inserts exactly 1 word row for a single-word result', async () => {
    await insertExtraction('file://photo.jpg', 'image', [sampleWords[0]]);
    const wordRows = mockValues.mock.calls[1][0] as unknown[];
    expect(wordRows).toHaveLength(1);
  });

  it('returns insertedIds and empty duplicates when no duplicates exist', async () => {
    const result = await insertExtraction('file://photo.jpg', 'image', sampleWords);
    expect(result.insertedIds).toHaveLength(2);
    expect(result.duplicates).toEqual([]);
  });

  it('skips a duplicate word (409) and returns it in duplicates[]', async () => {
    const { WordServerError: WSE } = jest.requireMock('@/src/api/wordServerClient');
    (postWord as jest.Mock)
      .mockRejectedValueOnce(new WSE('Conflict', 409)) // ephemeral is duplicate
      .mockResolvedValueOnce(undefined);               // lucid is not

    const result = await insertExtraction('file://photo.jpg', 'image', sampleWords);
    expect(result.duplicates).toEqual(['ephemeral']);
    expect(result.insertedIds).toHaveLength(1);
  });

  it('only inserts non-duplicate words into the words table', async () => {
    const { WordServerError: WSE } = jest.requireMock('@/src/api/wordServerClient');
    (postWord as jest.Mock)
      .mockRejectedValueOnce(new WSE('Conflict', 409)) // ephemeral is duplicate
      .mockResolvedValueOnce(undefined);               // lucid is not

    await insertExtraction('file://photo.jpg', 'image', sampleWords);
    const wordRows = mockValues.mock.calls[1][0] as Array<{ word: string }>;
    expect(wordRows).toHaveLength(1);
    expect(wordRows[0].word).toBe('lucid');
  });

  it('skips the transaction when all words are duplicates', async () => {
    const { WordServerError: WSE } = jest.requireMock('@/src/api/wordServerClient');
    (postWord as jest.Mock).mockRejectedValue(new WSE('Conflict', 409));

    const result = await insertExtraction('file://photo.jpg', 'image', sampleWords);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(result.insertedIds).toEqual([]);
    expect(result.duplicates).toEqual(['ephemeral', 'lucid']);
  });

  it('re-throws non-409 server errors', async () => {
    const { WordServerError: WSE } = jest.requireMock('@/src/api/wordServerClient');
    (postWord as jest.Mock).mockRejectedValueOnce(new WSE('Internal Server Error', 500));

    await expect(insertExtraction('file://photo.jpg', 'image', sampleWords)).rejects.toThrow('Internal Server Error');
  });

  it('re-throws network errors (non-WordServerError)', async () => {
    (postWord as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));

    await expect(insertExtraction('file://photo.jpg', 'image', sampleWords)).rejects.toThrow('Network failure');
  });
});
