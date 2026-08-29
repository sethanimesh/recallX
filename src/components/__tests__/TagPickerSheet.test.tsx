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

const mockGetAllTags = jest.fn();
const mockCreateOrGetTag = jest.fn();
const mockAddTagToWord = jest.fn();
const mockRemoveTagFromWord = jest.fn();

jest.mock('@/src/db/operations/tags', () => ({
  getAllTags: (...args: unknown[]) => mockGetAllTags(...args),
  createOrGetTag: (...args: unknown[]) => mockCreateOrGetTag(...args),
  addTagToWord: (...args: unknown[]) => mockAddTagToWord(...args),
  removeTagFromWord: (...args: unknown[]) => mockRemoveTagFromWord(...args),
}));

import TagPickerSheet from '../TagPickerSheet';

function collectText(node: renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] | null): string[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(collectText);
  const children = node.children ?? [];

  return [
    ...children.filter((child): child is string => typeof child === 'string'),
    ...children.flatMap((child) =>
      typeof child === 'string' ? [] : collectText(child)
    ),
  ];
}

describe('TagPickerSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetAllTags.mockResolvedValue([
      { id: 't1', name: 'GRE' },
      { id: 't2', name: 'Fiction' },
      { id: 't3', name: 'Gov' },
    ]);
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  async function renderSheet(overrideProps?: Partial<React.ComponentProps<typeof TagPickerSheet>>) {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <TagPickerSheet
          currentTags={[{ id: 't1', name: 'GRE' }]}
          visible
          onClose={() => {}}
          onTagsChanged={() => {}}
          {...overrideProps}
        />
      );
    });
    return tree;
  }

  it('renders selected tags as chips when currentTags are provided', async () => {
    const tree = await renderSheet();

    expect(tree.root.findByProps({ testID: 'selected-chip-t1' })).toBeTruthy();
    expect(collectText(tree.toJSON())).toContain('GRE');
  });

  it('filters visible tags as the search query changes', async () => {
    const tree = await renderSheet();

    await act(async () => {
      tree.root.findByProps({ testID: 'tag-picker-search-input' }).props.onChangeText('gov');
    });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('Gov');
    expect(texts).not.toContain('Fiction');
  });

  it('shows create action only when query has no exact case-insensitive match', async () => {
    const tree = await renderSheet();

    await act(async () => {
      tree.root.findByProps({ testID: 'tag-picker-search-input' }).props.onChangeText('gre');
    });
    expect(tree.root.findAllByProps({ testID: 'tag-picker-create' })).toHaveLength(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'tag-picker-search-input' }).props.onChangeText('history');
    });
    expect(tree.root.findByProps({ testID: 'tag-picker-create' })).toBeTruthy();
  });

  it('toggling a selected chip removes it from the selected state', async () => {
    const onTagsChanged = jest.fn();
    const tree = await renderSheet({ onTagsChanged });

    await act(async () => {
      tree.root.findByProps({ testID: 'selected-chip-t1' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'tag-picker-done' }).props.onPress();
    });

    expect(onTagsChanged).toHaveBeenCalledWith([]);
  });

  it('returns the full selected tag set on Done', async () => {
    const onTagsChanged = jest.fn();
    const tree = await renderSheet({ onTagsChanged });

    await act(async () => {
      tree.root.findByProps({ testID: 'tag-row-t2' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'tag-picker-done' }).props.onPress();
    });

    expect(onTagsChanged).toHaveBeenCalledWith([
      { id: 't1', name: 'GRE' },
      { id: 't2', name: 'Fiction' },
    ]);
  });

  it('creates and selects a new tag from the create action', async () => {
    mockCreateOrGetTag.mockResolvedValue('t9');
    const onTagsChanged = jest.fn();
    const tree = await renderSheet({ currentTags: [], onTagsChanged });

    await act(async () => {
      tree.root.findByProps({ testID: 'tag-picker-search-input' }).props.onChangeText('History');
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'tag-picker-create' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'tag-picker-done' }).props.onPress();
    });

    expect(mockCreateOrGetTag).toHaveBeenCalledWith('History');
    expect(onTagsChanged).toHaveBeenCalledWith([{ id: 't9', name: 'History' }]);
  });

  it('keeps the done button inside a dedicated footer when selected tags are shown', async () => {
    const tree = await renderSheet();

    const sheet = tree.root.findByProps({ testID: 'tag-picker-sheet' });
    const list = tree.root.findByProps({ testID: 'tag-picker-list' });
    const listHeader = tree.root.findByProps({ testID: 'tag-picker-list-header' });
    const selectedSection = tree.root.findByProps({ testID: 'tag-picker-selected-section' });
    const allTagsLabel = tree.root.findByProps({ testID: 'tag-picker-all-tags-label' });
    const doneButton = tree.root.findByProps({ testID: 'tag-picker-done' });

    const sheetStyle = StyleSheet.flatten(sheet.props.style);
    const listStyle = StyleSheet.flatten(list.props.style);
    const listContentStyle = StyleSheet.flatten(list.props.contentContainerStyle);
    const footerStyle = StyleSheet.flatten(doneButton.parent?.props.style);

    expect(sheetStyle.maxHeight).toBe('88%');
    expect(listHeader).toBeTruthy();
    expect(selectedSection).toBeTruthy();
    expect(allTagsLabel).toBeTruthy();
    expect(listStyle.flex).toBe(1);
    expect(listStyle.minHeight).toBe(0);
    expect(listContentStyle.paddingBottom).toBe(24);
    expect(footerStyle.flexShrink).toBe(0);
    expect(footerStyle.paddingTop).toBe(16);
  });
});
