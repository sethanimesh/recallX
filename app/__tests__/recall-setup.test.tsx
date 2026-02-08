import React from 'react';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
    SafeAreaView: ({ children, ...props }: any) => <View {...props}>{children}</View>,
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => { cb(); },
}));

const mockGetAllTags = jest.fn();
const mockFetchWordsByTag = jest.fn();
const mockFetchAllWords = jest.fn();
jest.mock('@/src/db/operations/tags', () => ({
  getAllTags: (...args: unknown[]) => mockGetAllTags(...args),
  fetchWordsByTag: (...args: unknown[]) => mockFetchWordsByTag(...args),
  fetchAllWords: (...args: unknown[]) => mockFetchAllWords(...args),
}));

const mockFetchDueWords = jest.fn();
jest.mock('@/src/db/operations/srs', () => ({
  fetchDueWords: (...args: unknown[]) => mockFetchDueWords(...args),
}));

import RecallSetupScreen from '../recall-setup';

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

describe('RecallSetupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetAllTags.mockResolvedValue([]);
    mockFetchAllWords.mockResolvedValue([]);
    mockFetchDueWords.mockResolvedValue([]);
  });

  afterEach(() => {
    act(() => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
  });

  it('shows "All caught up!" when Adaptive mode has 0 due words', async () => {
    mockFetchDueWords.mockResolvedValue([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('All caught up! No words due today.');
  });

  it('Start button is disabled when word count is 0', async () => {
    mockFetchDueWords.mockResolvedValue([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    const startBtn = tree.root.findByProps({ testID: 'start-button' });
    expect(startBtn.props.disabled).toBe(true);
  });

  it('Start button is enabled when Adaptive has due words', async () => {
    mockFetchDueWords.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    const startBtn = tree.root.findByProps({ testID: 'start-button' });
    expect(startBtn.props.disabled).toBe(false);
  });

  it('switches to Classic mode and shows "No words to review" when Classic deck is empty', async () => {
    mockFetchDueWords.mockResolvedValue([]);
    mockFetchAllWords.mockResolvedValue([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    // Tap Classic toggle
    await act(async () => {
      tree.root.findByProps({ testID: 'mode-classic' }).props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('No words to review');
  });

  it('Start button passes mode param to router', async () => {
    mockFetchDueWords.mockResolvedValue([{ id: 'w1' }]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'start-button' }).props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ mode: 'adaptive' }) })
    );
  });
});
