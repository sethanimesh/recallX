import { Alert } from 'react-native';

const mockRenameTag = jest.fn();
const mockFindTagByName = jest.fn();
const mockMergeTagIntoExisting = jest.fn();

jest.mock('@/src/db/operations/tags', () => ({
  getAllTags: jest.fn(),
  renameTag: (...args: unknown[]) => mockRenameTag(...args),
  deleteTag: jest.fn(),
  getTagWordCounts: jest.fn(),
  findTagByName: (...args: unknown[]) => mockFindTagByName(...args),
  mergeTagIntoExisting: (...args: unknown[]) => mockMergeTagIntoExisting(...args),
}));

jest.mock('@/src/api/wordServerClient', () => ({
  WordServerError: class WordServerError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  useFocusEffect: jest.fn(),
}));

import { WordServerError } from '@/src/api/wordServerClient';
import { submitTagRename } from '../manage-tags';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('submitTagRename', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prompts for merge on rename collision and merges only after both confirmations', async () => {
    const load = jest.fn().mockResolvedValue(undefined);
    mockRenameTag.mockRejectedValue(new WordServerError('conflict', 409));
    mockFindTagByName.mockResolvedValue({ id: 'target', name: 'Existing' });
    mockMergeTagIntoExisting.mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await submitTagRename({ id: 'source', name: 'Old' }, 'Existing', load);

    expect(mockRenameTag).toHaveBeenCalledWith('source', 'Existing');
    expect(mockFindTagByName).toHaveBeenCalledWith('Existing');
    expect(alertSpy).toHaveBeenCalledWith(
      'Merge Tags?',
      expect.stringContaining('"Old" will be merged into "Existing"'),
      expect.any(Array),
    );
    expect(mockMergeTagIntoExisting).not.toHaveBeenCalled();

    alertSpy.mock.calls[0][2]?.find((button) => button.text === 'Merge')?.onPress?.();

    expect(alertSpy).toHaveBeenCalledWith(
      'Are You Sure?',
      expect.stringContaining('remove "Old"'),
      expect.any(Array),
    );
    expect(mockMergeTagIntoExisting).not.toHaveBeenCalled();

    await alertSpy.mock.calls[1][2]?.find((button) => button.text === 'Merge Tags')?.onPress?.();
    await flushPromises();

    expect(mockMergeTagIntoExisting).toHaveBeenCalledWith('source', 'target');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
