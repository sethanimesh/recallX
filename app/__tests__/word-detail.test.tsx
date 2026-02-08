import React from 'react';
import { StyleSheet } from 'react-native';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockBack = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({ id: 'word-1' }));
const mockScreen = jest.fn(() => null);

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  router: { back: mockBack },
  Stack: {
    Screen: (props: unknown) => mockScreen(props),
  },
}));

const mockFetchWordWithSource = jest.fn();
const mockUpdateWordField = jest.fn();
const mockSoftDeleteWord = jest.fn();

jest.mock('@/src/db/operations/wordDetail', () => ({
  fetchWordWithSource: (...args: unknown[]) => mockFetchWordWithSource(...args),
  updateWordField: (...args: unknown[]) => mockUpdateWordField(...args),
  softDeleteWord: (...args: unknown[]) => mockSoftDeleteWord(...args),
}));

const mockGetTagsForWord = jest.fn();
const mockRemoveTagFromWord = jest.fn();

jest.mock('@/src/db/operations/tags', () => ({
  getTagsForWord: (...args: unknown[]) => mockGetTagsForWord(...args),
  removeTagFromWord: (...args: unknown[]) => mockRemoveTagFromWord(...args),
}));

jest.mock('@/src/components/TagPickerSheet', () => () => null);

import WordDetailScreen from '../words/[id]';

describe('WordDetailScreen header delete action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchWordWithSource.mockResolvedValue({
      id: 'word-1',
      word: 'alacrity',
      definition: 'A feeling of happy excitement or eagerness.',
      example_sentence: 'She accepted the challenge with alacrity.',
      source: null,
    });
    mockGetTagsForWord.mockResolvedValue([]);
    mockUpdateWordField.mockResolvedValue(undefined);
    mockSoftDeleteWord.mockResolvedValue(undefined);
  });

  it('centers the header trash icon inside a square touch target', async () => {
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<WordDetailScreen />);
      await Promise.resolve();
    });

    expect(tree.toJSON()).toBeTruthy();

    const screenCalls = mockScreen.mock.calls;
    const detailScreenCall = screenCalls.find(
      ([props]) => props?.options?.headerRight,
    );
    expect(detailScreenCall).toBeTruthy();

    const headerRight = detailScreenCall![0].options.headerRight;
    const headerAction = headerRight();
    const buttonStyle = StyleSheet.flatten(headerAction.props.style);

    expect(headerAction.props.accessibilityLabel).toBe('Delete word');
    expect(buttonStyle.width).toBe(32);
    expect(buttonStyle.height).toBe(32);
    expect(buttonStyle.alignItems).toBe('center');
    expect(buttonStyle.justifyContent).toBe('center');
  });
});
