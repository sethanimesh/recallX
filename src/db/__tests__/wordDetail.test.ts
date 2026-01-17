import { fetchWordTags, updateWordField, softDeleteWord, fetchWordWithSource } from '../operations/wordDetail';
import { db } from '@/src/db/client';

jest.mock('@/src/db/client', () => ({
  db: { select: jest.fn(), update: jest.fn() },
}));

// ── shared builder helpers ────────────────────────────────────────────────────

type AnyFn = jest.Mock<unknown, unknown[]>;

interface SelectChain {
  from: AnyFn;
  innerJoin: (arg: unknown) => { where: AnyFn };
  where: AnyFn;
}

function makeSelectChainWithJoin(result: unknown[]): SelectChain {
  const terminal = jest.fn().mockResolvedValue(result);
  const chain: SelectChain = {
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnValue({ where: terminal }),
    where: jest.fn().mockResolvedValue([]),
  };
  (db.select as jest.Mock).mockReturnValue(chain);
  return chain;
}

interface SimpleSelectChain {
  from: AnyFn;
  where: AnyFn;
}

function makeSimpleSelectChain(result: unknown[]): SimpleSelectChain {
  const chain: SimpleSelectChain = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(result),
  };
  (db.select as jest.Mock).mockReturnValue(chain);
  return chain;
}

interface UpdateChain {
  set: AnyFn;
  where: AnyFn;
}

function makeUpdateChain(): UpdateChain {
  const chain: UpdateChain = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
  };
  (db.update as jest.Mock).mockReturnValue(chain);
  return chain;
}

// ── fetchWordTags ─────────────────────────────────────────────────────────────

describe('fetchWordTags', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an array of tag name strings', async () => {
    const tagRows = [{ name: 'science' }, { name: 'biology' }];
    makeSelectChainWithJoin(tagRows);

    const result = await fetchWordTags('word-1');
    expect(result).toEqual(['science', 'biology']);
  });

  it('returns empty array when word has no tags', async () => {
    makeSelectChainWithJoin([]);

    const result = await fetchWordTags('word-no-tags');
    expect(result).toEqual([]);
  });
});

// ── updateWordField ───────────────────────────────────────────────────────────

describe('updateWordField', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls UPDATE with new definition value and a timestamp', async () => {
    const chain = makeUpdateChain();
    const before = new Date();
    await updateWordField('word-1', 'definition', 'A new definition.');
    const after = new Date();

    expect(db.update).toHaveBeenCalledTimes(1);
    const setCall = chain.set.mock.calls[0][0] as {
      definition: string;
      updated_at: Date;
    };
    expect(setCall.definition).toBe('A new definition.');
    expect(setCall.updated_at).toBeInstanceOf(Date);
    expect(setCall.updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(setCall.updated_at.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('calls UPDATE with new example_sentence value and a timestamp', async () => {
    const chain = makeUpdateChain();
    await updateWordField('word-2', 'example_sentence', 'She spoke lucidly.');

    expect(db.update).toHaveBeenCalledTimes(1);
    const setCall = chain.set.mock.calls[0][0] as {
      example_sentence: string;
      updated_at: Date;
    };
    expect(setCall.example_sentence).toBe('She spoke lucidly.');
    expect(setCall.updated_at).toBeInstanceOf(Date);
  });
});

// ── softDeleteWord ────────────────────────────────────────────────────────────

describe('softDeleteWord', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls UPDATE setting deleted_at to a Date (not null)', async () => {
    const chain = makeUpdateChain();
    const before = new Date();
    await softDeleteWord('word-3');
    const after = new Date();

    expect(db.update).toHaveBeenCalledTimes(1);
    const setCall = chain.set.mock.calls[0][0] as { deleted_at: Date };
    expect(setCall.deleted_at).toBeInstanceOf(Date);
    expect(setCall.deleted_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(setCall.deleted_at.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ── fetchWordWithSource ───────────────────────────────────────────────────────

describe('fetchWordWithSource', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when word is not found', async () => {
    makeSimpleSelectChain([]);

    const result = await fetchWordWithSource('missing-id');
    expect(result).toBeNull();
  });

  it('returns word without source when source_id is null', async () => {
    const wordRow = {
      id: 'w1',
      word: 'ephemeral',
      definition: 'Lasting briefly.',
      example_sentence: 'The joy was ephemeral.',
      source_id: null,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    };
    makeSimpleSelectChain([wordRow]);

    const result = await fetchWordWithSource('w1');
    expect(result).not.toBeNull();
    expect(result!.word).toBe('ephemeral');
    expect(result!.source).toBeUndefined();
  });
});
