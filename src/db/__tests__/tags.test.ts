import {
  createOrGetTag,
  getAllTags,
  getTagsForWord,
  addTagToWord,
  removeTagFromWord,
  renameTag,
  deleteTag,
  fetchWordsByTag,
  getTagWordCounts,
} from '../operations/tags';
import { db } from '@/src/db/client';

jest.mock('@/src/db/client', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid'),
}));

// ── chain builders ────────────────────────────────────────────────────────────

type AnyFn = jest.Mock<unknown, unknown[]>;

function makeSelectChain(result: unknown[]) {
  const terminal = jest.fn().mockResolvedValue(result);
  const chain = {
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue(result),
    groupBy: jest.fn().mockResolvedValue(result),
  };
  // where resolves for simple cases; orderBy too
  chain.where.mockReturnValue({ ...chain, orderBy: jest.fn().mockResolvedValue(result) });
  (db.select as jest.Mock).mockReturnValue(chain);
  return { chain, terminal };
}

function makeSelectChainReturning(result: unknown[]) {
  const whereResolvable = jest.fn().mockResolvedValue(result);
  const groupByResolvable = jest.fn().mockResolvedValue(result);
  const orderByResolvable = jest.fn().mockResolvedValue(result);
  const innerJoinChain = {
    where: jest.fn().mockReturnValue({ orderBy: orderByResolvable }),
  };
  const chain = {
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnValue(innerJoinChain),
    where: whereResolvable,
    orderBy: orderByResolvable,
    groupBy: groupByResolvable,
  };
  (db.select as jest.Mock).mockReturnValue(chain);
  return chain;
}

function makeInsertChain() {
  const chain = {
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
    }),
  };
  (db.insert as jest.Mock).mockReturnValue(chain);
  return chain;
}

function makeUpdateChain() {
  const chain = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
  };
  (db.update as jest.Mock).mockReturnValue(chain);
  return chain;
}

function makeDeleteChain() {
  const chain = {
    where: jest.fn().mockResolvedValue(undefined),
  };
  (db.delete as jest.Mock).mockReturnValue(chain);
  return chain;
}

// ── createOrGetTag ────────────────────────────────────────────────────────────

describe('createOrGetTag', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns existing tag id when name matches (case-insensitive)', async () => {
    makeSelectChainReturning([{ id: 'existing-id' }]);
    const id = await createOrGetTag('GRE Prep');
    expect(id).toBe('existing-id');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts and returns new uuid when tag does not exist', async () => {
    makeSelectChainReturning([]);
    makeInsertChain();
    const id = await createOrGetTag('New Tag');
    expect(id).toBe('mock-uuid');
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

// ── getAllTags ─────────────────────────────────────────────────────────────────

describe('getAllTags', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns sorted tag objects', async () => {
    const rows = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
    const chain = {
      from: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue(rows),
    };
    (db.select as jest.Mock).mockReturnValue(chain);

    const result = await getAllTags();
    expect(result).toEqual(rows);
  });
});

// ── getTagsForWord ─────────────────────────────────────────────────────────────

describe('getTagsForWord', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns tag objects for a word', async () => {
    const tagRows = [{ id: 't1', name: 'science' }, { id: 't2', name: 'biology' }];
    const whereResolvable = jest.fn().mockResolvedValue(tagRows);
    const chain = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: whereResolvable,
    };
    (db.select as jest.Mock).mockReturnValue(chain);

    const result = await getTagsForWord('word-1');
    expect(result).toEqual(tagRows);
  });

  it('returns empty array when word has no tags', async () => {
    const whereResolvable = jest.fn().mockResolvedValue([]);
    const chain = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: whereResolvable,
    };
    (db.select as jest.Mock).mockReturnValue(chain);

    const result = await getTagsForWord('word-no-tags');
    expect(result).toEqual([]);
  });
});

// ── addTagToWord ──────────────────────────────────────────────────────────────

describe('addTagToWord', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls insert with correct word_id and tag_id', async () => {
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoNothing });
    (db.insert as jest.Mock).mockReturnValue({ values });

    await addTagToWord('w1', 't1');
    expect(values).toHaveBeenCalledWith({ word_id: 'w1', tag_id: 't1' });
    expect(onConflictDoNothing).toHaveBeenCalled();
  });
});

// ── removeTagFromWord ─────────────────────────────────────────────────────────

describe('removeTagFromWord', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls delete with a where clause', async () => {
    const chain = makeDeleteChain();
    await removeTagFromWord('w1', 't1');
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
  });
});

// ── renameTag ─────────────────────────────────────────────────────────────────

describe('renameTag', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates the tag name when no collision exists', async () => {
    makeSelectChainReturning([]);
    makeUpdateChain();

    await renameTag('t1', 'New Name');
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('throws when a tag with the new name already exists', async () => {
    makeSelectChainReturning([{ id: 'other-id' }]);

    await expect(renameTag('t1', 'Existing')).rejects.toThrow('already exists');
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ── deleteTag ─────────────────────────────────────────────────────────────────

describe('deleteTag', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes from word_tags first then tags', async () => {
    const deleteChain = makeDeleteChain();
    await deleteTag('t1');
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(deleteChain.where).toHaveBeenCalledTimes(2);
  });
});

// ── fetchWordsByTag ───────────────────────────────────────────────────────────

describe('fetchWordsByTag', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns words for a given tag', async () => {
    const wordRows = [
      {
        id: 'w1', word: 'abate', definition: 'To diminish.', example_sentence: 'The storm abated.',
        source_id: null, created_at: new Date(), updated_at: new Date(), deleted_at: null,
      },
    ];
    const orderByResolvable = jest.fn().mockResolvedValue(wordRows);
    const innerJoinChain = {
      where: jest.fn().mockReturnValue({ orderBy: orderByResolvable }),
    };
    const chain = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnValue(innerJoinChain),
    };
    (db.select as jest.Mock).mockReturnValue(chain);

    const result = await fetchWordsByTag('t1');
    expect(result).toEqual(wordRows);
  });
});

// ── getTagWordCounts ──────────────────────────────────────────────────────────

describe('getTagWordCounts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a Record mapping tag_id to count', async () => {
    const rows = [{ tag_id: 't1', count: 5 }, { tag_id: 't2', count: 3 }];
    const chain = {
      from: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockResolvedValue(rows),
    };
    (db.select as jest.Mock).mockReturnValue(chain);

    const result = await getTagWordCounts();
    expect(result).toEqual({ t1: 5, t2: 3 });
  });

  it('returns empty object when no word_tags exist', async () => {
    const chain = {
      from: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockResolvedValue([]),
    };
    (db.select as jest.Mock).mockReturnValue(chain);

    const result = await getTagWordCounts();
    expect(result).toEqual({});
  });
});
