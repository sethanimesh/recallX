import React from 'react';
import { StyleSheet, Text, Alert } from 'react-native';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockPush = jest.fn();
const mockSetParams = jest.fn();
const mockUseFocusEffect = jest.fn((callback: () => void | (() => void)) => {
  callback();
});
const mockUseLocalSearchParams = jest.fn(() => ({}));

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    setParams: (...args: unknown[]) => mockSetParams(...args),
  },
  useFocusEffect: (callback: () => void | (() => void)) => mockUseFocusEffect(callback),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
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
const mockSelect = jest.fn((_args?: unknown) => ({ from: mockFrom }));

jest.mock('@/src/db/client', () => ({
  db: {
    select: (args: unknown) => mockSelect(args),
  },
}));

const mockSetNav = jest.fn();
jest.mock('@/src/store/libraryNav', () => ({
  setNav: (...args: unknown[]) => mockSetNav(...args),
}));

import LibraryScreen from '../(tabs)/index';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('LibraryScreen accessibility-safe header layout', () => {
  let tree: renderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetAllTags.mockResolvedValue([
      { id: 't1', name: 'gov' },
      { id: 't2', name: 'new' },
    ]);
    mockFetchWordsByTag.mockResolvedValue([]);
    mockOrderBy.mockResolvedValue([
      { id: 'w1', word: 'alacrity', definition: 'A feeling of happy excitement or eagerness.', created_at: new Date('2026-06-01T12:00:00Z') },
      { id: 'w2', word: 'banish', definition: 'Send away.', created_at: new Date('2026-06-02T12:00:00Z') },
    ]);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await act(async () => {
      await flushPromises();
      tree?.unmount();
    });
    tree = null;
  });

  it('uses resilient sizing and wrapped tag filters to avoid horizontal scrolling', async () => {
    await act(async () => {
      tree = renderer.create(<LibraryScreen />);
      await flushPromises();
    });

    const searchRowStyle = StyleSheet.flatten(
      tree!.root.findByProps({ testID: 'library-search-row' }).props.style,
    );
    const searchInputStyle = StyleSheet.flatten(
      tree!.root.findByProps({ testID: 'library-search-input' }).props.style,
    );
    const tagWrapStyle = StyleSheet.flatten(
      tree!.root.findByProps({ testID: 'library-tag-wrap' }).props.style,
    );
    const allChipStyle = StyleSheet.flatten(
      tree!.root.findByProps({ testID: 'library-tag-chip-all' }).props.style,
    );
    const allChipTextStyle = StyleSheet.flatten(
      tree!.root.findByProps({ testID: 'library-tag-chip-all' }).findByType(Text).props.style,
    );

    expect(searchRowStyle.minHeight).toBe(40);
    expect(searchRowStyle.paddingVertical).toBe(6);
    expect(searchInputStyle.lineHeight).toBe(20);
    expect(tagWrapStyle.flexDirection).toBe('row');
    expect(tagWrapStyle.flexWrap).toBe('wrap');
    expect(allChipStyle.minHeight).toBe(36);
    expect(allChipStyle.alignItems).toBe('center');
    expect(allChipStyle.justifyContent).toBe('center');
    expect(allChipTextStyle.lineHeight).toBe(18);
  });

  it('passes the active tag to Add Words when tapping plus from a tag filter', async () => {
    await act(async () => {
      tree = renderer.create(<LibraryScreen />);
      await flushPromises();
    });
    mockPush.mockClear();

    act(() => {
      tree!.root.findByProps({ testID: 'library-tag-chip-t1' }).props.onPress();
    });

    act(() => {
      tree!.root.findByProps({ testID: 'library-add-button' }).props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/ingest',
      params: { tagId: 't1', tagName: 'gov' },
    });
  });

  it('calls setNav with filtered ids and tapped index when a word row is pressed', async () => {
    await act(async () => {
      tree = renderer.create(<LibraryScreen />);
      await flushPromises();
    });
    mockSetNav.mockClear();

    act(() => {
      tree!.root.findByProps({ testID: 'word-row-w1' }).props.onPress();
    });

    expect(mockSetNav).toHaveBeenCalledWith(['w1', 'w2'], 0);
    expect(mockPush).toHaveBeenCalledWith('/words/w1');
  });

  it('allows sorting words alphabetically and by timestamp (ascending/descending)', async () => {
    await act(async () => {
      tree = renderer.create(<LibraryScreen />);
      await flushPromises();
    });

    const alertSpy = jest.spyOn(Alert, 'alert');

    // 1. Check sort button exists
    const sortBtn = tree!.root.findByProps({ testID: 'library-sort-button' });
    expect(sortBtn).toBeTruthy();

    // 2. Press sort button to trigger Alert
    act(() => {
      sortBtn.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalled();
    const alertButtons = alertSpy.mock.calls[0][2];
    expect(alertButtons).toBeDefined();

    // Find options
    const alphaOpt = alertButtons!.find((b: any) => b.text === 'Alphabetical (A-Z)');
    const newestOpt = alertButtons!.find((b: any) => b.text === 'Newest First');
    const oldestOpt = alertButtons!.find((b: any) => b.text === 'Oldest First');

    expect(alphaOpt).toBeDefined();
    expect(newestOpt).toBeDefined();
    expect(oldestOpt).toBeDefined();

    // 3. Test sorting: Default is Alphabetical (A-Z) -> ['w1', 'w2'] (alacrity then banish)
    // Now trigger "Newest First" (w2: 2026-06-02, w1: 2026-06-01)
    act(() => {
      newestOpt.onPress();
    });

    // Check sorted order in FlatList
    let flatList = tree!.root.findByType(require('react-native').FlatList);
    let displayedIds = flatList.props.data.map((item: any) => item.id);
    expect(displayedIds).toEqual(['w2', 'w1']);

    // Now trigger "Oldest First" (w1: 2026-06-01, w2: 2026-06-02)
    act(() => {
      oldestOpt.onPress();
    });

    displayedIds = flatList.props.data.map((item: any) => item.id);
    expect(displayedIds).toEqual(['w1', 'w2']);

    // Now trigger "Alphabetical (A-Z)" again
    act(() => {
      alphaOpt.onPress();
    });

    displayedIds = flatList.props.data.map((item: any) => item.id);
    expect(displayedIds).toEqual(['w1', 'w2']);
  });
});
