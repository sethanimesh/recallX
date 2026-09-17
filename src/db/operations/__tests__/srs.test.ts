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

import { fetchDueWords, updateWordSRS, fetchDueWordsFc, updateWordFCSRS } from '../srs';

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

  it('calls db.update with correct SRS values including wrongCount and consecutiveCorrect', async () => {
    await updateWordSRS('word-1', 3, 2.3, new Date('2026-05-01'), 2, 4);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        srs_interval: 3,
        srs_ease_factor: 2.3,
        srs_wrong_count: 2,
        srs_consecutive_correct: 4,
        updated_at: expect.any(Date),
      }),
    );
  });

  it('resolves without throwing', async () => {
    await expect(updateWordSRS('w1', 0, 2.5, new Date(), 0, 0)).resolves.toBeUndefined();
  });
});

describe('fetchDueWordsFc', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls db.select and resolves to an array', async () => {
    const result = await fetchDueWordsFc();
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(Array.isArray(result)).toBe(true);
  });

  it('uses innerJoin when tagId is provided', async () => {
    await fetchDueWordsFc('tag-123');
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
  });

  it('does not use innerJoin when no tagId', async () => {
    await fetchDueWordsFc();
    expect(mockInnerJoin).not.toHaveBeenCalled();
  });
});

describe('updateWordFCSRS', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls db.update with fc_* column values', async () => {
    await updateWordFCSRS('word-1', 3, 2.3, new Date('2026-05-01'), 2, 4);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        fc_interval: 3,
        fc_ease_factor: 2.3,
        fc_wrong_count: 2,
        fc_consecutive_correct: 4,
        updated_at: expect.any(Date),
      }),
    );
  });

  it('resolves without throwing', async () => {
    await expect(updateWordFCSRS('w1', 0, 2.5, new Date(), 0, 0)).resolves.toBeUndefined();
  });
});
