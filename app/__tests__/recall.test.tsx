import React from 'react';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';
import { Alert, ScrollView } from 'react-native';

// Mock tags DB operations
const mockFetchWordsByTag = jest.fn();
const mockFetchAllWords = jest.fn();
jest.mock('@/src/db/operations/tags', () => ({
  fetchWordsByTag: (...args: unknown[]) => mockFetchWordsByTag(...args),
  fetchAllWords: (...args: unknown[]) => mockFetchAllWords(...args),
}));

// Mock gradeClient
const mockGradeAnswer = jest.fn();
jest.mock('@/src/api/gradeClient', () => ({
  gradeAnswer: (...args: unknown[]) => mockGradeAnswer(...args),
}));

// Mock voice input dependencies to keep tests isolated from native modules.
const mockVoiceInput = {
  state: 'idle',
  transcript: '',
  start: jest.fn(),
  reset: jest.fn(),
};
jest.mock('@/src/audio/useVoiceInput', () => ({
  useVoiceInput: () => mockVoiceInput,
}));
jest.mock('@/src/components/VoiceInputButton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    VoiceInputButton: ({ onPress }: { onPress: () => void }) =>
      React.createElement(View, { testID: 'voice-input-button', onTouchEnd: onPress }),
  };
});

// Mock router
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = { tagId: 'tag1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

import RecallScreen from '../recall';

// Sample word rows
const WORD_A = {
  id: 'w1',
  word: 'ephemeral',
  definition: 'Lasting for a very short time',
  example_sentence: 'The ephemeral beauty of cherry blossoms.',
  source_id: null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};
const WORD_B = {
  id: 'w2',
  word: 'tenacious',
  definition: 'Holding fast; persistent',
  example_sentence: 'She was tenacious in her pursuit.',
  source_id: null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};

// Utility: collect all text strings from rendered tree
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

describe('RecallScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Default: fetchWordsByTag returns deck with two words
    mockFetchWordsByTag.mockResolvedValue([WORD_A, WORD_B]);
    mockFetchAllWords.mockResolvedValue([WORD_A, WORD_B]);
    mockParams = { tagId: 'tag1' };
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders the current word text on mount', async () => {
    // Force deterministic order by returning single word
    mockFetchWordsByTag.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RecallScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('ephemeral');
  });

  it('keeps taps actionable while keyboard is open', async () => {
    mockFetchWordsByTag.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RecallScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    const container = tree.root.findByType(ScrollView);
    expect(container.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('shows green "Correct ✓" banner after correct response', async () => {
    mockFetchWordsByTag.mockResolvedValue([WORD_A]);
    mockGradeAnswer.mockResolvedValue({ correct: true, feedback: 'Great.' });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RecallScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      const input = tree.root.findByProps({ testID: 'answer-input' });
      input.props.onChangeText('short-lived');
    });

    // Submit the answer
    await act(async () => {
      const submitBtn = tree.root.findByProps({ testID: 'submit-button' });
      submitBtn.props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('Correct ✓');

    // Banner should have correct (green) style
    const banner = tree.root.findByProps({ testID: 'result-banner' });
    const bannerStyle = banner.props.style;
    const flatStyle = Array.isArray(bannerStyle) ? Object.assign({}, ...bannerStyle) : bannerStyle;
    expect(flatStyle.backgroundColor).toBe('#DCFCE7');
  });

  it('shows red "Incorrect ✗" banner after incorrect response', async () => {
    mockFetchWordsByTag.mockResolvedValue([WORD_A]);
    mockGradeAnswer.mockResolvedValue({ correct: false, feedback: 'Not quite.' });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RecallScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      const input = tree.root.findByProps({ testID: 'answer-input' });
      input.props.onChangeText('wrong meaning');
    });

    await act(async () => {
      const submitBtn = tree.root.findByProps({ testID: 'submit-button' });
      submitBtn.props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('Incorrect ✗');

    const banner = tree.root.findByProps({ testID: 'result-banner' });
    const bannerStyle = banner.props.style;
    const flatStyle = Array.isArray(bannerStyle) ? Object.assign({}, ...bannerStyle) : bannerStyle;
    expect(flatStyle.backgroundColor).toBe('#FEE2E2');
  });

  it('shows "See Results" button on the last card', async () => {
    // Single-card deck → last card immediately
    mockFetchWordsByTag.mockResolvedValue([WORD_A]);
    mockGradeAnswer.mockResolvedValue({ correct: true, feedback: 'Great.' });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RecallScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      const input = tree.root.findByProps({ testID: 'answer-input' });
      input.props.onChangeText('short-lived');
    });

    // Submit to move to result phase
    await act(async () => {
      const submitBtn = tree.root.findByProps({ testID: 'submit-button' });
      submitBtn.props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('See Results');
    expect(texts).not.toContain('Next Word →');
  });

  it('shows "Next Word →" button when there are more cards', async () => {
    mockFetchWordsByTag.mockResolvedValue([WORD_A, WORD_B]);
    mockGradeAnswer.mockResolvedValue({ correct: true, feedback: 'Great.' });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RecallScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      const input = tree.root.findByProps({ testID: 'answer-input' });
      input.props.onChangeText('persistent');
    });

    // Submit first card
    await act(async () => {
      const submitBtn = tree.root.findByProps({ testID: 'submit-button' });
      submitBtn.props.onPress();
    });
    await act(async () => { await Promise.resolve(); });

    const nextButton = tree.root.findByProps({ testID: 'next-button' });
    expect(nextButton).toBeTruthy();

    const texts = collectText(tree.toJSON());
    expect(texts).not.toContain('See Results');
  });
});
