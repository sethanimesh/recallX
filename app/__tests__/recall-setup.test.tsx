import React from 'react';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';

// Mock safe-area-context
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
    SafeAreaView: ({ children, ...props }: any) => <View {...props}>{children}</View>,
  };
});

// Mock router
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => { cb(); },
}));

// Mock tags DB operations
const mockGetAllTags = jest.fn();
const mockFetchWordsByTag = jest.fn();
const mockFetchAllWords = jest.fn();
jest.mock('@/src/db/operations/tags', () => ({
  getAllTags: (...args: unknown[]) => mockGetAllTags(...args),
  fetchWordsByTag: (...args: unknown[]) => mockFetchWordsByTag(...args),
  fetchAllWords: (...args: unknown[]) => mockFetchAllWords(...args),
}));

import RecallSetupScreen from '../recall-setup';

// Helper: set up fetchAllWords mock return value
function setupAllWordsMock(returnRows: unknown[]) {
  mockFetchAllWords.mockResolvedValue(returnRows);
}

describe('RecallSetupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('shows "No words to review" when word count is 0 (no tags, all-words pool empty)', async () => {
    mockGetAllTags.mockResolvedValue([]);
    setupAllWordsMock([]); // 0 words in "all words" pool

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RecallSetupScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('No words to review');
  });

  it('Start button is disabled when word count is 0', async () => {
    mockGetAllTags.mockResolvedValue([]);
    setupAllWordsMock([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RecallSetupScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    const startBtn = tree.root.findByProps({ testID: 'start-button' });
    expect(startBtn.props.disabled).toBe(true);
    expect(startBtn.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('Start button is enabled when word count > 0', async () => {
    mockGetAllTags.mockResolvedValue([{ id: 'tag-1', name: 'GRE' }]);
    // All-words pool (selected by default on mount): 3 words
    setupAllWordsMock([{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RecallSetupScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    const startBtn = tree.root.findByProps({ testID: 'start-button' });
    expect(startBtn.props.disabled).toBe(false);
    expect(startBtn.props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('Start button is disabled when a tag is selected but that tag has no words', async () => {
    mockGetAllTags.mockResolvedValue([{ id: 'tag-1', name: 'GRE' }]);
    mockFetchWordsByTag.mockResolvedValue([]);
    // All-words pool is also empty to keep button disabled from the start
    setupAllWordsMock([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RecallSetupScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    // Press the GRE tag row — fetchWordsByTag will return []
    await act(async () => {
      const radioRows = tree.root.findAllByProps({ accessibilityRole: 'radio' });
      radioRows[1].props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    // Button should be disabled and label shown (tag has no words)
    const startBtn = tree.root.findByProps({ testID: 'start-button' });
    expect(startBtn.props.disabled).toBe(true);
    const texts = collectText(tree.toJSON());
    expect(texts).toContain('No words to review');
  });
});

// Utility to collect all text strings from a rendered tree
function collectText(
  node: renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] | null,
): string[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(collectText);
  const children = node.children ?? [];
  return [
    ...children.filter((child): child is string => typeof child === 'string'),
    ...children.flatMap((child) =>
      typeof child === 'string' ? [] : collectText(child),
    ),
  ];
}
