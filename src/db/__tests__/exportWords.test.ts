const mockSelect = jest.fn();
jest.mock('@/src/api/centralClient', () => ({ api: jest.fn() }));
import { api } from '@/src/api/centralClient';

jest.mock('@/src/db/client', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

const mockDirectoryCreate = jest.fn();
const mockFileCreate = jest.fn();
const mockFileWrite = jest.fn();
const mockPickDirectoryAsync = jest.fn();

jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;

    constructor(...parts: Array<{ uri: string } | string>) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part.uri))
        .join('/')
        .replace(/([^:]\/)\/+/g, '$1');
    }

    create = mockDirectoryCreate;
  }

  (Directory as typeof Directory & { pickDirectoryAsync: typeof mockPickDirectoryAsync }).pickDirectoryAsync =
    mockPickDirectoryAsync;

  class File {
    uri: string;

    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}/${name}`;
    }

    create = mockFileCreate;
    write = mockFileWrite;
  }

  return {
    __esModule: true,
    Directory,
    File,
  };
});

import {
  fetchWordsForExport,
  pickExportDirectory,
  saveWordsExport,
  serializeWordsToCsv,
  serializeWordsToJson,
  type ExportWordRecord,
} from '../operations/exportWords';

(require('expo-file-system').Directory as { pickDirectoryAsync?: typeof mockPickDirectoryAsync }).pickDirectoryAsync =
  mockPickDirectoryAsync;

function makeRows() {
  return [
    {
      id: 'w1',
      word: 'abate',
      definition: 'become less intense',
      example_sentence: 'The storm began to abate.',
      created_at: new Date('2026-05-20T10:00:00.000Z'),
      updated_at: new Date('2026-05-20T11:00:00.000Z'),
      source_id: 's1',
      source_type: 'pdf' as const,
      tag_name: 'GRE',
    },
    {
      id: 'w1',
      word: 'abate',
      definition: 'become less intense',
      example_sentence: 'The storm began to abate.',
      created_at: new Date('2026-05-20T10:00:00.000Z'),
      updated_at: new Date('2026-05-20T11:00:00.000Z'),
      source_id: 's1',
      source_type: 'pdf' as const,
      tag_name: 'Biology',
    },
    {
      id: 'w2',
      word: 'candid',
      definition: 'truthful',
      example_sentence: 'She gave a candid answer.',
      created_at: new Date('2026-05-19T09:00:00.000Z'),
      updated_at: new Date('2026-05-19T09:30:00.000Z'),
      source_id: null,
      source_type: null,
      tag_name: null,
    },
  ];
}

function mockSelectResultOnce(result: unknown[]) {
  const chain = {
    from: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue(result),
  };
  mockSelect.mockReturnValueOnce(chain);
  return chain;
}

function mockTagLookupOnce(result: unknown[]) {
  const chain = {
    from: jest.fn().mockResolvedValue(result),
  };
  mockSelect.mockReturnValueOnce(chain);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('serializeWordsToJson', () => {
  it('serializes export words as pretty JSON', () => {
    const records: ExportWordRecord[] = [
      {
        id: 'w1',
        word: 'abate',
        definition: 'become less intense',
        example_sentence: 'The storm began to abate.',
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-20T11:00:00.000Z',
        source_id: 's1',
        source_type: 'pdf',
        tags: ['GRE'],
      },
    ];

    expect(serializeWordsToJson(records)).toContain('"tags": [');
    expect(serializeWordsToJson(records).endsWith('\n')).toBe(true);
  });
});

describe('serializeWordsToCsv', () => {
  it('escapes commas, quotes, and newlines correctly', () => {
    const csv = serializeWordsToCsv([
      {
        id: 'w1',
        word: 'abate',
        definition: 'He said, "slow down"',
        example_sentence: 'Line one\nLine two',
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-20T11:00:00.000Z',
        source_id: 's1',
        source_type: 'pdf',
        tags: ['GRE', 'Biology'],
      },
    ]);

    expect(csv).toContain('"He said, ""slow down"""');
    expect(csv).toContain('"Line one\nLine two"');
    expect(csv).toContain('GRE|Biology');
  });
});

describe('fetchWordsForExport', () => {
  it('returns all active words with merged tag arrays when no filter is provided', async () => {
    mockSelectResultOnce(makeRows());

    const result = await fetchWordsForExport();

    expect(result).toEqual([
      {
        id: 'w1',
        word: 'abate',
        definition: 'become less intense',
        example_sentence: 'The storm began to abate.',
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-20T11:00:00.000Z',
        source_id: 's1',
        source_type: 'pdf',
        tags: ['GRE', 'Biology'],
      },
      {
        id: 'w2',
        word: 'candid',
        definition: 'truthful',
        example_sentence: 'She gave a candid answer.',
        created_at: '2026-05-19T09:00:00.000Z',
        updated_at: '2026-05-19T09:30:00.000Z',
        source_id: null,
        source_type: null,
        tags: [],
      },
    ]);
  });

  it('filters with multi-tag union semantics', async () => {
    mockSelectResultOnce(makeRows());
    mockTagLookupOnce([
      { id: 'tag-gre', name: 'GRE' },
      { id: 'tag-bio', name: 'Biology' },
    ]);

    const result = await fetchWordsForExport(['tag-bio']);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('w1');
  });

  it('returns an empty array when selected tag ids do not match any words', async () => {
    mockSelectResultOnce(makeRows());
    mockTagLookupOnce([{ id: 'tag-unknown', name: 'History' }]);

    const result = await fetchWordsForExport(['tag-unknown']);

    expect(result).toEqual([]);
  });
});

describe('saveWordsExport', () => {
  it('returns the user-picked directory', async () => {
    mockPickDirectoryAsync.mockResolvedValue({ uri: 'file:///picked-folder' });

    const directory = await pickExportDirectory();

    expect(mockPickDirectoryAsync).toHaveBeenCalled();
    expect(directory.uri).toBe('file:///picked-folder');
  });

  it('writes the export into the chosen directory and returns the saved location', async () => {
    const archive = { schema_version: 1, words: [{ id: 'w1' }, { id: 'w2' }], memory_states: [{ stability: 3 }], review_events: [{ rating: 3 }], rubrics: [{ revision: 2 }], calibration: { eligible: false }, settings: { experimental_grading: false } };
    (api as jest.Mock).mockResolvedValueOnce(archive);
    const directory = { uri: 'file:///picked-folder' } as Parameters<typeof saveWordsExport>[2];

    const result = await saveWordsExport('json', undefined, directory);

    expect(mockDirectoryCreate).not.toHaveBeenCalled();
    expect(mockFileCreate).toHaveBeenCalledWith({ overwrite: true, intermediates: true });
    expect(mockFileWrite).toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith('/export');
    expect(JSON.parse(mockFileWrite.mock.calls[0][0])).toEqual(archive);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(result.format).toBe('json');
    expect(result.count).toBe(2);
    expect(result.uri).toContain('file:///picked-folder/recallx-learning-history-');
  });
  it('does not silently substitute a partial local archive when the server cannot export', async () => {
    (api as jest.Mock).mockRejectedValueOnce(new Error('Server unavailable'));
    await expect(saveWordsExport('json', ['filter-only-applies-to-csv'], { uri: 'file:///picked-folder' } as any)).rejects.toThrow('Server unavailable');
    expect(mockFileWrite).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
