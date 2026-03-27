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
const mockFetchDueWordsFc = jest.fn();
jest.mock('@/src/db/operations/srs', () => ({
  fetchDueWords: (...args: unknown[]) => mockFetchDueWords(...args),
  fetchDueWordsFc: (...args: unknown[]) => mockFetchDueWordsFc(...args),
}));

const mockFetchTodayWordCount = jest.fn();
jest.mock('@/src/db/operations/sessionHistory', () => ({
  fetchTodayWordCount: (...args: unknown[]) => mockFetchTodayWordCount(...args),
}));

import RecallSetupScreen from '../recall-setup';

function collectText(
  node: renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] | string | null,
): string[] {
  if (!node) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap((n) => collectText(n as renderer.ReactTestRendererJSON | string));
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
    mockFetchDueWordsFc.mockResolvedValue([]);
    mockFetchTodayWordCount.mockResolvedValue(0);
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
    expect(startBtn.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('Start button is enabled when Adaptive has due words', async () => {
    mockFetchDueWords.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    const startBtn = tree.root.findByProps({ testID: 'start-button' });
    expect(startBtn.props.disabled).toBe(false);
    expect(startBtn.props.accessibilityState).toMatchObject({ disabled: false });
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

  it('shows Flashcard mode button in toggle', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('Flashcard');
  });

  it('shows Passive/Self-Rated sub-toggle when Flashcard is selected', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'mode-flashcard' }).props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('Passive');
    expect(texts).toContain('Self-Rated');
  });

  it('Flashcard Self-Rated uses fetchDueWordsFc for word count', async () => {
    mockFetchDueWordsFc.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'mode-flashcard' }).props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'fcmode-self-rated' }).props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    expect(mockFetchDueWordsFc).toHaveBeenCalled();
    const wordCountLabel = tree.root.findByProps({ testID: 'word-count-label' });
    expect(collectText(wordCountLabel.props.children ?? wordCountLabel)).toContain('2');
  });

  it('Start button routes to /flashcard with fcMode param', async () => {
    mockFetchAllWords.mockResolvedValue([{ id: 'w1' }]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'mode-flashcard' }).props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'start-button' }).props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/flashcard',
        params: expect.objectContaining({ fcMode: 'passive' }),
      })
    );
  });

  it('renders sort order toggle and defaults to jumbled', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('Sort Order');
    expect(texts).toContain('Jumbled');
    expect(texts).toContain('Alphabetical');
  });

  it('passes sortOrder alphabetical parameter to router when toggled', async () => {
    mockFetchDueWords.mockResolvedValue([{ id: 'w1' }]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<RecallSetupScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'sort-alphabetical' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'start-button' }).props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ sortOrder: 'alphabetical' }),
      })
    );
  });
});
