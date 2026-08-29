import { insertManualWord } from '../operations/insertManualWord';
import { db } from '@/src/db/client';
import { postWord } from '@/src/api/wordServerClient';

jest.mock('@/src/db/client', () => {
  const mockWhere = jest.fn().mockResolvedValue([]);
  const mockFrom = jest.fn(() => ({ where: mockWhere }));
  const mockSelect = jest.fn(() => ({ from: mockFrom }));

  return {
    db: {
      insert: jest.fn(),
      select: mockSelect,
    },
  };
});

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid'),
}));

jest.mock('@/src/api/wordServerClient', () => ({
  postWord: jest.fn().mockResolvedValue(undefined),
}));

const mockValues = jest.fn();
const mockInsert = jest.fn(() => ({ values: mockValues }));

beforeEach(() => {
  jest.clearAllMocks();
  mockValues.mockReturnValue({ onConflictDoNothing: jest.fn().mockResolvedValue(undefined) });
  mockInsert.mockReturnValue({ values: mockValues });
  (db.insert as jest.Mock).mockImplementation(mockInsert);
});

describe('insertManualWord', () => {
  it('inserts a row with source_id: null', async () => {
    await insertManualWord('pellucid', 'Translucently clear.', '');
    expect(mockValues).toHaveBeenCalledTimes(1);
    const row = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.source_id).toBeNull();
  });

  it('returns the generated id', async () => {
    const result = await insertManualWord('pellucid', 'Translucently clear.', '');
    expect(result.id).toBe('test-uuid');
  });
  it('adopts the original server identity when a queued create is recovered', async () => {
    (postWord as jest.Mock).mockResolvedValueOnce({ id: 'original-operation-item' });
    const result = await insertManualWord('pellucid', 'Translucently clear.', '');
    expect(result.id).toBe('original-operation-item');
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ id: 'original-operation-item' }));
  });

  it('defaults example_sentence to empty string when passed empty string', async () => {
    await insertManualWord('pellucid', 'Translucently clear.', '');
    const row = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.example_sentence).toBe('');
  });

  it('trims whitespace from word and definition', async () => {
    await insertManualWord('  pellucid  ', '  Translucently clear.  ', '');
    const row = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.word).toBe('Pellucid');
    expect(row.definition).toBe('Translucently clear.');
  });
});
