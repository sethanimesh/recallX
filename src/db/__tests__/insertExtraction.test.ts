import { insertExtraction } from '../operations/insertExtraction';
import { db } from '@/src/db/client';

jest.mock('@/src/db/client', () => ({
  db: { transaction: jest.fn() },
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
    await insertExtraction('file://photo.jpg', 'image', []);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
