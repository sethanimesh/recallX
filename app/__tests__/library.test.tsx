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

const mockPush = jest.fn();
const mockUseFocusEffect = jest.fn((callback: () => void | (() => void)) => {
  callback();
});

jest.mock('expo-router', () => ({
  router: { push: mockPush },
  useFocusEffect: (callback: () => void | (() => void)) => mockUseFocusEffect(callback),
}));

const mockGetAllTags = jest.fn();
const mockFetchWordsByTag = jest.fn();

jest.mock('@/src/db/operations/tags', () => ({
  getAllTags: (...args: unknown[]) => mockGetAllTags(...args),
  fetchWordsByTag: (...args: unknown[]) => mockFetchWordsByTag(...args),
}));

const mockWhere = jest.fn().mockReturnThis();
const mockOrderBy = jest.fn();
const mockFrom = jest.fn(() => ({ where: mockWhere, orderBy: mockOrderBy }));
const mockSelect = jest.fn(() => ({ from: mockFrom }));

jest.mock('@/src/db/client', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

import LibraryScreen from '../(tabs)/index';

describe('LibraryScreen accessibility-safe header layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetAllTags.mockResolvedValue([
      { id: 't1', name: 'gov' },
      { id: 't2', name: 'new' },
    ]);
    mockFetchWordsByTag.mockResolvedValue([]);
    mockOrderBy.mockResolvedValue([
      { id: 'w1', word: 'alacrity', definition: 'A feeling of happy excitement or eagerness.' },
    ]);
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('uses resilient min-heights and centered chip content to avoid text clipping', async () => {
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<LibraryScreen />);
      await Promise.resolve();
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    const searchRowStyle = StyleSheet.flatten(
      tree.root.findByProps({ testID: 'library-search-row' }).props.style,
    );
    const searchInputStyle = StyleSheet.flatten(
      tree.root.findByProps({ testID: 'library-search-input' }).props.style,
    );
    const allChipStyle = StyleSheet.flatten(
      tree.root.findByProps({ testID: 'library-tag-chip-all' }).props.style,
    );
    const allChipTextStyle = StyleSheet.flatten(
      tree.root.findByProps({ testID: 'library-tag-chip-all' }).findByType('Text').props.style,
    );

    expect(searchRowStyle.minHeight).toBe(40);
    expect(searchRowStyle.paddingVertical).toBe(6);
    expect(searchInputStyle.lineHeight).toBe(20);
    expect(allChipStyle.minHeight).toBe(36);
    expect(allChipStyle.alignItems).toBe('center');
    expect(allChipStyle.justifyContent).toBe('center');
    expect(allChipTextStyle.lineHeight).toBe(18);
  });
});
