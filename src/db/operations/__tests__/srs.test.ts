const mockOrderBy = jest.fn().mockResolvedValue([]);
const mockWhereAll = jest.fn().mockReturnValue({ orderBy: mockOrderBy });
const mockWhereTag = jest.fn().mockReturnValue({ orderBy: mockOrderBy });
const mockInnerJoin = jest.fn().mockReturnValue({ where: mockWhereTag });
const mockFrom = jest.fn().mockReturnValue({ where: mockWhereAll, innerJoin: mockInnerJoin });
const mockSelect = jest.fn().mockReturnValue({ from: mockFrom });

const mockUpdateWhere = jest.fn().mockResolvedValue(undefined);
const mockSet = jest.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = jest.fn().mockReturnValue({ set: mockSet });

jest.mock('@/src/db/client', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

import { fetchDueWords, updateWordSRS } from '../srs';

describe('fetchDueWords', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls db.select and resolves to an array', async () => {
    const result = await fetchDueWords();
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(Array.isArray(result)).toBe(true);
  });

  it('uses innerJoin when tagId is provided', async () => {
    await fetchDueWords('tag-123');
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
  });

  it('does not use innerJoin when no tagId', async () => {
    await fetchDueWords();
    expect(mockInnerJoin).not.toHaveBeenCalled();
  });
});

describe('updateWordSRS', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls db.update with correct SRS values', async () => {
    await updateWordSRS('word-1', 3, 2.3, new Date('2026-05-01'));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        srs_interval: 3,
        srs_ease_factor: 2.3,
        updated_at: expect.any(Date),
      }),
    );
  });

  it('resolves without throwing', async () => {
    await expect(updateWordSRS('w1', 0, 2.5, new Date())).resolves.toBeUndefined();
  });
});
