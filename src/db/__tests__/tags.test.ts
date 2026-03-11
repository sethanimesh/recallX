import {
  createOrGetTag,
  getAllTags,
  getTagsForWord,
  addTagToWord,
  removeTagFromWord,
  renameTag,
  findTagByName,
  mergeTagIntoExisting,
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
    transaction: jest.fn(),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid'),
}));

jest.mock('@/src/api/wordServerClient', () => ({
  postTag: jest.fn().mockResolvedValue(undefined),
  patchTag: jest.fn().mockResolvedValue(undefined),
  deleteTag: jest.fn().mockResolvedValue(undefined),
  mergeTag: jest.fn().mockResolvedValue(undefined),
  addTagToWord: jest.fn().mockResolvedValue(undefined),
  removeTagFromWord: jest.fn().mockResolvedValue(undefined),
  WordServerError: class WordServerError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
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

function makeTransaction() {
  const txInsertChain = {
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
    }),
  };
  const txDeleteChain = {
    where: jest.fn().mockResolvedValue(undefined),
  };
  const tx = {
    insert: jest.fn().mockReturnValue(txInsertChain),
    delete: jest.fn().mockReturnValue(txDeleteChain),
  };
  (db.transaction as jest.Mock).mockImplementation(async (callback) => callback(tx));
  return { tx, txInsertChain, txDeleteChain };
}

// ── createOrGetTag ────────────────────────────────────────────────────────────

describe('createOrGetTag', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts to server, inserts locally, and returns new uuid', async () => {
    const { postTag } = require('@/src/api/wordServerClient');
    postTag.mockResolvedValue(undefined);
    makeInsertChain();
    const id = await createOrGetTag('New Tag');
    expect(id).toBe('mock-uuid');
    expect(postTag).toHaveBeenCalledWith({ id: 'mock-uuid', name: 'New Tag' });
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('returns existing local id on 409 from server', async () => {
    const { postTag, WordServerError } = require('@/src/api/wordServerClient');
    postTag.mockRejectedValue(new WordServerError('conflict', 409));
    makeSelectChainReturning([{ id: 'existing-id' }]);
    const id = await createOrGetTag('GRE Prep');
    expect(id).toBe('existing-id');
    expect(db.insert).not.toHaveBeenCalled();
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

// ── findTagByName ─────────────────────────────────────────────────────────────

describe('findTagByName', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the matching tag case-insensitively', async () => {
    const rows = [{ id: 't1', name: 'GRE Prep' }];
    makeSelectChainReturning(rows);

    const result = await findTagByName('gre prep');

    expect(result).toEqual(rows[0]);
  });

  it('returns null when no tag matches', async () => {
    makeSelectChainReturning([]);

    const result = await findTagByName('missing');

    expect(result).toBeNull();
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

  it('calls server then inserts locally with correct word_id and tag_id', async () => {
    const { addTagToWord: serverAddTagToWord } = require('@/src/api/wordServerClient');
    serverAddTagToWord.mockResolvedValue(undefined);
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoNothing });
    (db.insert as jest.Mock).mockReturnValue({ values });

    await addTagToWord('w1', 't1');
    expect(serverAddTagToWord).toHaveBeenCalledWith('w1', 't1');
    expect(values).toHaveBeenCalledWith({ word_id: 'w1', tag_id: 't1' });
    expect(onConflictDoNothing).toHaveBeenCalled();
  });
});

// ── removeTagFromWord ─────────────────────────────────────────────────────────

describe('removeTagFromWord', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls server then deletes locally', async () => {
    const { removeTagFromWord: serverRemoveTagFromWord } = require('@/src/api/wordServerClient');
    serverRemoveTagFromWord.mockResolvedValue(undefined);
    const chain = makeDeleteChain();
    await removeTagFromWord('w1', 't1');
    expect(serverRemoveTagFromWord).toHaveBeenCalledWith('w1', 't1');
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
  });

  it('proceeds with local delete on 404 from server', async () => {
    const { removeTagFromWord: serverRemoveTagFromWord, WordServerError } = require('@/src/api/wordServerClient');
    serverRemoveTagFromWord.mockRejectedValue(new WordServerError('not found', 404));
    const chain = makeDeleteChain();
    await removeTagFromWord('w1', 't1');
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
  });
});

// ── renameTag ─────────────────────────────────────────────────────────────────

describe('renameTag', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls server then updates locally', async () => {
    const { patchTag } = require('@/src/api/wordServerClient');
    patchTag.mockResolvedValue(undefined);
    makeUpdateChain();

    await renameTag('t1', 'New Name');
    expect(patchTag).toHaveBeenCalledWith('t1', { name: 'New Name' });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('throws WordServerError(409) on name collision from server', async () => {
    const { patchTag, WordServerError } = require('@/src/api/wordServerClient');
    patchTag.mockRejectedValue(new WordServerError('conflict', 409));

    await expect(renameTag('t1', 'Existing')).rejects.toThrow(WordServerError);
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ── mergeTagIntoExisting ──────────────────────────────────────────────────────

describe('mergeTagIntoExisting', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls server then moves local word-tag pairs and deletes the source tag locally', async () => {
    const { mergeTag } = require('@/src/api/wordServerClient');
    mergeTag.mockResolvedValue(undefined);
    makeSelectChainReturning([{ word_id: 'w1' }, { word_id: 'w2' }]);
    const { tx, txInsertChain, txDeleteChain } = makeTransaction();

    await mergeTagIntoExisting('source', 'target');

    expect(mergeTag).toHaveBeenCalledWith('source', 'target');
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(txInsertChain.values).toHaveBeenCalledWith([
      { word_id: 'w1', tag_id: 'target' },
      { word_id: 'w2', tag_id: 'target' },
    ]);
    expect(txDeleteChain.where).toHaveBeenCalledTimes(2);
    expect(tx.delete).toHaveBeenCalledTimes(2);
  });

  it('does not mutate locally when server merge fails', async () => {
    const { mergeTag, WordServerError } = require('@/src/api/wordServerClient');
    mergeTag.mockRejectedValue(new WordServerError('missing', 404));

    await expect(mergeTagIntoExisting('source', 'target')).rejects.toThrow(WordServerError);

    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

// ── deleteTag ─────────────────────────────────────────────────────────────────

describe('deleteTag', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls server then deletes from word_tags and tags locally', async () => {
    const { deleteTag: serverDeleteTag } = require('@/src/api/wordServerClient');
    serverDeleteTag.mockResolvedValue(undefined);
    const deleteChain = makeDeleteChain();
    await deleteTag('t1');
    expect(serverDeleteTag).toHaveBeenCalledWith('t1');
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
