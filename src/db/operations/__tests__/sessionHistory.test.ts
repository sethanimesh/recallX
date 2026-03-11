// Mocks must be declared before imports

// ── Insert mock chain ─────────────────────────────────────────────────────────
const mockInsertValues = jest.fn().mockResolvedValue(undefined);
const mockInsert = jest.fn().mockReturnValue({ values: mockInsertValues });

// ── Update mock chain ─────────────────────────────────────────────────────────
const mockUpdateWhere = jest.fn().mockResolvedValue(undefined);
const mockSet = jest.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = jest.fn().mockReturnValue({ set: mockSet });

// ── Select mock chains ────────────────────────────────────────────────────────
//
// Query shapes used in sessionHistory.ts:
//
//   A) select().from().where().orderBy().limit()
//      → fetchLastSessionStartTime, fetchWordHistory
//
//   B) select().from().where()   [resolves directly]
//      → fetchTodayWordCount, fetchWordsCreatedTodayFor*
//
//   C) select().from().innerJoin().where()  [resolves directly]
//      → fetchRecentlyWrongIds (wrong rows), fetchWordsCreatedTodayFor* with tag
//
// Strategy:
//   - mockWhereFromDirect: used by .from().where()  — resolves directly via mockResolvedValueOnce
//   - mockWhereAfterInnerJoin: used by .innerJoin().where() — separate mock, resolves directly
//   - mockLimit: terminal for chain A
//
// We give mockFrom two different `where` functions based on path, but since jest mocks
// return the same value each call, we use a single mockWhereSelect that returns a
// chainable object by default, and tests override with mockResolvedValueOnce when needed.
// The key: queries that don't chain after where() (B, C) use mockResolvedValueOnce on the mock;
// queries that do chain (A) rely on the default return value.

const mockLimit = jest.fn().mockResolvedValue([]);
const mockOrderBy = jest.fn().mockReturnValue({ limit: mockLimit });

// Default: returns chainable object. Tests can override with .mockResolvedValueOnce([...])
// for queries where .where() is the terminal call.
const mockWhereSelect = jest.fn().mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });

// Separate where mock for the innerJoin path — resolves directly by default
const mockWhereAfterInnerJoin = jest.fn().mockResolvedValue([]);

const mockInnerJoin = jest.fn().mockReturnValue({ where: mockWhereAfterInnerJoin });
const mockFrom = jest.fn().mockReturnValue({ where: mockWhereSelect, innerJoin: mockInnerJoin });
const mockSelect = jest.fn().mockReturnValue({ from: mockFrom });

jest.mock('@/src/db/client', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

import {
  insertSession,
  closeSession,
  insertSessionResult,
  fetchLastSessionStartTime,
  fetchRecentlyWrongIds,
  fetchTodayWordCount,
  fetchWordHistory,
  fetchWordsCreatedTodayForRecall,
  fetchWordsCreatedTodayForFlashcard,
} from '../sessionHistory';

describe('insertSession / closeSession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts a session and closes it', async () => {
    await insertSession('sess-1', 'recall', undefined);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess-1', mode: 'recall', tag_id: null }),
    );

    await closeSession('sess-1');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ ended_at: expect.any(Date) }));
  });

  it('inserts a session with a tag_id', async () => {
    await insertSession('sess-2', 'flashcard', 'tag-abc');
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess-2', mode: 'flashcard', tag_id: 'tag-abc' }),
    );
  });
});

describe('insertSessionResult', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts a correct result', async () => {
    await insertSessionResult('sess-3', 'word-1', true, 1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'sess-3', word_id: 'word-1', correct: 1, attempt_number: 1 }),
    );
  });

  it('inserts an incorrect result', async () => {
    await insertSessionResult('sess-4', 'word-2', false, 1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'sess-4', word_id: 'word-2', correct: 0, attempt_number: 1 }),
    );
  });
});

describe('fetchLastSessionStartTime', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a date ~24h ago when no sessions exist for mode', async () => {
    // Chain: select().from().where().orderBy().limit() → mockLimit resolves []
    mockLimit.mockResolvedValueOnce([]);
    const before = Date.now() - 24 * 60 * 60 * 1000 - 1000;
    const result = await fetchLastSessionStartTime('flashcard');
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('returns the most recent session start time for the mode', async () => {
    const startedAt = new Date();
    mockLimit.mockResolvedValueOnce([{ started_at: startedAt }]);
    const result = await fetchLastSessionStartTime('recall');
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(startedAt.getTime());
  });
});

describe('fetchRecentlyWrongIds', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty array when dueWordIds is empty', async () => {
    const result = await fetchRecentlyWrongIds('recall', []);
    expect(result).toEqual([]);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns word ids that were wrong and are in due pool', async () => {
    // 1st select: fetchLastSessionStartTime → .where().orderBy().limit()
    mockLimit.mockResolvedValueOnce([{ started_at: new Date(Date.now() - 1000) }]);
    // 2nd select: wrongRows → .innerJoin().where() → mockWhereAfterInnerJoin
    mockWhereAfterInnerJoin.mockResolvedValueOnce([{ word_id: 'word-10' }]);

    const result = await fetchRecentlyWrongIds('recall', ['word-10', 'word-11', 'word-12']);
    expect(result).toContain('word-10');
    expect(result).not.toContain('word-11');
  });

  it('excludes wrong words not in the due pool', async () => {
    // 1st select: fetchLastSessionStartTime
    mockLimit.mockResolvedValueOnce([{ started_at: new Date(Date.now() - 1000) }]);
    // 2nd select: word-20 is wrong but NOT in due pool ['word-99']
    mockWhereAfterInnerJoin.mockResolvedValueOnce([{ word_id: 'word-20' }]);

    const result = await fetchRecentlyWrongIds('recall', ['word-99']);
    expect(result).not.toContain('word-20');
    expect(result).not.toContain('word-99');
  });

  it('does not cross-contaminate between modes', async () => {
    // fetchLastSessionStartTime → no sessions (returns 24h-ago default)
    mockLimit.mockResolvedValueOnce([]);
    // wrongRows → empty for flashcard
    mockWhereAfterInnerJoin.mockResolvedValueOnce([]);

    const result = await fetchRecentlyWrongIds('flashcard', ['word-30']);
    expect(result).not.toContain('word-30');
  });
});

describe('fetchTodayWordCount', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a number >= 0 when no words today', async () => {
    // select().from().where() resolves to []
    mockWhereSelect.mockResolvedValueOnce([]);
    const count = await fetchTodayWordCount();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('returns the count of words created today', async () => {
    mockWhereSelect.mockResolvedValueOnce([{ id: 'w1' }, { id: 'w2' }]);
    const count = await fetchTodayWordCount();
    expect(count).toBe(2);
  });
});

describe('fetchWordHistory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty array for word with no history', async () => {
    // select().from().where().orderBy().limit() → mockLimit resolves []
    mockLimit.mockResolvedValueOnce([]);
    const result = await fetchWordHistory('no-such-word', 5);
    expect(result).toEqual([]);
  });

  it('returns results ordered by answered_at descending', async () => {
    const t1 = new Date(Date.now() - 1000);
    const t2 = new Date(Date.now() - 2000);
    mockLimit.mockResolvedValueOnce([
      { word_id: 'word-50', correct: 1, attempt_number: 2, answered_at: t1 },
      { word_id: 'word-50', correct: 0, attempt_number: 1, answered_at: t2 },
    ]);
    const result = await fetchWordHistory('word-50', 5);
    expect(result.length).toBe(2);
    expect(result[0].answered_at.getTime()).toBeGreaterThanOrEqual(result[1].answered_at.getTime());
  });

  it('respects the limit parameter', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      word_id: 'word-60', correct: i % 2, attempt_number: i + 1, answered_at: new Date(),
    }));
    mockLimit.mockResolvedValueOnce(rows);
    await fetchWordHistory('word-60', 3);
    expect(mockLimit).toHaveBeenCalledWith(3);
  });
});

describe('fetchWordsCreatedTodayForRecall', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an array without tagId', async () => {
    mockWhereSelect.mockResolvedValueOnce([]);
    const result = await fetchWordsCreatedTodayForRecall();
    expect(Array.isArray(result)).toBe(true);
  });

  it('uses innerJoin when tagId provided', async () => {
    mockWhereAfterInnerJoin.mockResolvedValueOnce([]);
    await fetchWordsCreatedTodayForRecall('tag-1');
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
  });

  it('does not use innerJoin when no tagId', async () => {
    mockWhereSelect.mockResolvedValueOnce([]);
    await fetchWordsCreatedTodayForRecall();
    expect(mockInnerJoin).not.toHaveBeenCalled();
  });
});

describe('fetchWordsCreatedTodayForFlashcard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an array without tagId', async () => {
    mockWhereSelect.mockResolvedValueOnce([]);
    const result = await fetchWordsCreatedTodayForFlashcard();
    expect(Array.isArray(result)).toBe(true);
  });

  it('uses innerJoin when tagId provided', async () => {
    mockWhereAfterInnerJoin.mockResolvedValueOnce([]);
    await fetchWordsCreatedTodayForFlashcard('tag-1');
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
  });

  it('does not use innerJoin when no tagId', async () => {
    mockWhereSelect.mockResolvedValueOnce([]);
    await fetchWordsCreatedTodayForFlashcard();
    expect(mockInnerJoin).not.toHaveBeenCalled();
  });
});
