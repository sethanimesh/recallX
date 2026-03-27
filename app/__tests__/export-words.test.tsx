import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-file-system', () => ({
  Directory: class Directory {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }
  },
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  useFocusEffect: (callback: () => void) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));

const mockFetchWordsForExport = jest.fn();
const mockPickExportDirectory = jest.fn();
const mockSaveWordsExport = jest.fn();

jest.mock('@/src/db/operations/exportWords', () => ({
  fetchWordsForExport: (...args: unknown[]) => mockFetchWordsForExport(...args),
  pickExportDirectory: (...args: unknown[]) => mockPickExportDirectory(...args),
  saveWordsExport: (...args: unknown[]) => mockSaveWordsExport(...args),
}));

const mockGetAllTags = jest.fn();
const mockGetTagWordCounts = jest.fn();

jest.mock('@/src/db/operations/tags', () => ({
  getAllTags: (...args: unknown[]) => mockGetAllTags(...args),
  getTagWordCounts: (...args: unknown[]) => mockGetTagWordCounts(...args),
}));

import ExportWordsScreen from '../export-words';

describe('ExportWordsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    mockGetAllTags.mockResolvedValue([
      { id: 'tag-gre', name: 'GRE' },
      { id: 'tag-bio', name: 'Biology' },
      { id: 'tag-empty', name: 'History' },
    ]);
    mockGetTagWordCounts.mockResolvedValue({
      'tag-gre': 2,
      'tag-bio': 1,
      'tag-empty': 0,
    });
    mockFetchWordsForExport.mockResolvedValue([
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
      {
        id: 'w2',
        word: 'cell',
        definition: 'basic unit',
        example_sentence: 'A cell divides.',
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-20T11:00:00.000Z',
        source_id: null,
        source_type: null,
        tags: ['Biology'],
      },
    ]);
    mockPickExportDirectory.mockResolvedValue({ uri: 'file:///local-folder' });
    mockSaveWordsExport.mockResolvedValue({
      uri: 'file:///local-folder/words.json',
      filename: 'words.json',
      count: 1,
      format: 'json',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads tags and shows the initial all-words preview count', async () => {
    const { getByTestId } = render(<ExportWordsScreen />);

    await waitFor(() => expect(mockFetchWordsForExport).toHaveBeenCalled());
    expect(getByTestId('export-word-count').props.children).toBe('2 words ready');
    expect(getByTestId('export-folder-label').props.children).toBe('No folder selected');
  });

  it('updates the preview count when a tag is selected', async () => {
    const { getByTestId } = render(<ExportWordsScreen />);

    await waitFor(() => expect(mockFetchWordsForExport).toHaveBeenCalled());
    fireEvent.press(getByTestId('export-tag-tag-gre'));

    expect(getByTestId('export-word-count').props.children).toBe('1 word ready');
  });

  it('disables export buttons when the selected filter matches zero words', async () => {
    const { getByTestId } = render(<ExportWordsScreen />);

    await waitFor(() => expect(mockFetchWordsForExport).toHaveBeenCalled());
    fireEvent.press(getByTestId('export-tag-tag-empty'));

    const jsonButton = getByTestId('export-json-button');
    const csvButton = getByTestId('export-csv-button');
    expect(jsonButton.props.accessibilityState.disabled).toBe(true);
    expect(csvButton.props.accessibilityState.disabled).toBe(true);
  });

  it('lets the user choose a folder in Files before exporting', async () => {
    const { getByTestId } = render(<ExportWordsScreen />);

    await waitFor(() => expect(mockFetchWordsForExport).toHaveBeenCalled());
    fireEvent.press(getByTestId('choose-export-folder-button'));

    await waitFor(() => expect(mockPickExportDirectory).toHaveBeenCalled());
    expect(getByTestId('export-folder-label').props.children).toBe('local-folder');
    expect(getByTestId('export-json-button').props.accessibilityState.disabled).toBe(false);
  });

  it('exports JSON using the selected tag ids and shows a success alert', async () => {
    const { getByTestId } = render(<ExportWordsScreen />);

    await waitFor(() => expect(mockFetchWordsForExport).toHaveBeenCalled());
    fireEvent.press(getByTestId('choose-export-folder-button'));
    await waitFor(() => expect(mockPickExportDirectory).toHaveBeenCalled());
    fireEvent.press(getByTestId('export-tag-tag-gre'));
    fireEvent.press(getByTestId('export-json-button'));

    await waitFor(() =>
      expect(mockSaveWordsExport).toHaveBeenCalledWith('json', ['tag-gre'], { uri: 'file:///local-folder' }),
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'Export Saved',
      'words.json saved with 1 word.\n\nLocation:\nfile:///local-folder/words.json',
    );
  });
});
