import { insertManualWord } from '../operations/insertManualWord';
import { db } from '@/src/db/client';

jest.mock('@/src/db/client', () => ({
  db: { insert: jest.fn() },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid'),
}));

const mockValues = jest.fn();
const mockInsert = jest.fn(() => ({ values: mockValues }));

beforeEach(() => {
  jest.clearAllMocks();
  mockValues.mockResolvedValue(undefined);
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
    const id = await insertManualWord('pellucid', 'Translucently clear.', '');
    expect(id).toBe('test-uuid');
  });

  it('defaults example_sentence to empty string when passed empty string', async () => {
    await insertManualWord('pellucid', 'Translucently clear.', '');
    const row = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.example_sentence).toBe('');
  });

  it('trims whitespace from word and definition', async () => {
    await insertManualWord('  pellucid  ', '  Translucently clear.  ', '');
    const row = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.word).toBe('pellucid');
    expect(row.definition).toBe('Translucently clear.');
  });
});
