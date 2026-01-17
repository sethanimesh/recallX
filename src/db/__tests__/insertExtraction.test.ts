/**
 * NOTE: As of Task Group 1, `app/ingest.tsx` no longer calls `insertExtraction` directly.
 * Persistence is now gated behind the review screen: ingest stores extracted words in the
 * module-level pending store (`src/store/pendingWords.ts`) and navigates to `/review`.
 * The review screen is responsible for calling `insertExtraction` for each accepted word.
 *
 * The tests below verify the `insertExtraction` function itself, which remains intact.
 */
import { insertExtraction, isDuplicateWord } from '../operations/insertExtraction';
import { db } from '@/src/db/client';

// Mock the select chain for isDuplicateWord
const mockLimit = jest.fn();
const mockWhere = jest.fn(() => ({ limit: mockLimit }));
const mockFrom = jest.fn(() => ({ where: mockWhere }));
const mockSelect = jest.fn(() => ({ from: mockFrom }));

jest.mock('@/src/db/client', () => ({
  db: {
    transaction: jest.fn(),
    select: jest.fn(),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid'),
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
  // Default: no duplicates found
  mockLimit.mockResolvedValue([]);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  (db.select as jest.Mock).mockImplementation(mockSelect);
});

const sampleWords = [
  { word: 'ephemeral', definition: 'Lasting briefly.', example_sentence: 'The joy was ephemeral.' },
  { word: 'lucid', definition: 'Clearly expressed.', example_sentence: 'A lucid explanation.' },
];

describe('isDuplicateWord', () => {
  it('returns true when the word already exists in the DB (case-insensitive)', async () => {
    mockLimit.mockResolvedValueOnce([{ id: 'existing-id' }]);
    const result = await isDuplicateWord('ephemeral');
    expect(result).toBe(true);
  });

  it('returns true for a different case of the same word', async () => {
    mockLimit.mockResolvedValueOnce([{ id: 'existing-id' }]);
    const result = await isDuplicateWord('Ephemeral');
    expect(result).toBe(true);
  });

  it('returns false when the word does not exist in the DB', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await isDuplicateWord('serendipity');
    expect(result).toBe(false);
  });
});

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

  it('skips a duplicate word and returns it in duplicates[]', async () => {
    // First word is a duplicate, second is not
    mockLimit
      .mockResolvedValueOnce([{ id: 'existing-id' }]) // ephemeral is a duplicate
      .mockResolvedValueOnce([]);                       // lucid is not

    const result = await insertExtraction('file://photo.jpg', 'image', sampleWords);
    expect(result.duplicates).toEqual(['ephemeral']);
    expect(result.insertedIds).toHaveLength(1);
  });

  it('only inserts non-duplicate words into the words table', async () => {
    // ephemeral is duplicate, lucid is not
    mockLimit
      .mockResolvedValueOnce([{ id: 'existing-id' }])
      .mockResolvedValueOnce([]);

    await insertExtraction('file://photo.jpg', 'image', sampleWords);
    const wordRows = mockValues.mock.calls[1][0] as Array<{ word: string }>;
    expect(wordRows).toHaveLength(1);
    expect(wordRows[0].word).toBe('lucid');
  });

  it('still creates the source row when all words are duplicates', async () => {
    // Both words are duplicates
    mockLimit.mockResolvedValue([{ id: 'existing-id' }]);

    const result = await insertExtraction('file://photo.jpg', 'image', sampleWords);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // Only source insert, no word insert
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(result.insertedIds).toEqual([]);
    expect(result.duplicates).toEqual(['ephemeral', 'lucid']);
  });
});
