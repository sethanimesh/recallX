import React from 'react';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';

const mockFetchWordsByTag = jest.fn();
const mockFetchAllWords = jest.fn();
jest.mock('@/src/db/operations/tags', () => ({
  fetchWordsByTag: (...args: unknown[]) => mockFetchWordsByTag(...args),
  fetchAllWords: (...args: unknown[]) => mockFetchAllWords(...args),
}));

const mockFetchDueWordsFc = jest.fn();
const mockUpdateWordFCSRS = jest.fn().mockResolvedValue(undefined);
jest.mock('@/src/db/operations/srs', () => ({
  fetchDueWordsFc: (...args: unknown[]) => mockFetchDueWordsFc(...args),
  updateWordFCSRS: (...args: unknown[]) => mockUpdateWordFCSRS(...args),
}));

jest.mock('@/src/db/operations/sessionHistory', () => ({
  insertSession: jest.fn().mockResolvedValue(undefined),
  closeSession: jest.fn().mockResolvedValue(undefined),
  insertSessionResult: jest.fn().mockResolvedValue(undefined),
  fetchRecentlyWrongIds: jest.fn().mockResolvedValue([]),
  fetchTodayWordIds: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/src/screens/srsAlgorithm', () => ({
  createSession: jest.fn((words: unknown[]) => ({
    mainDeck: words.map((w: unknown) => ({
      word: w, interval: 0, easeFactor: 2.5, inBuffer: false, successCount: 0,
      wrongCount: 0, consecutiveCorrect: 0,
    })),
    buffer: [],
    cardsSinceBuffer: 0,
  })),
  getNextCard: jest.fn((session: { mainDeck: unknown[] }) =>
    session.mainDeck.length > 0 ? session.mainDeck[0] : null),
  handleResponse: jest.fn((session: { mainDeck: unknown[]; buffer: unknown[] }, card: unknown, correct: boolean) => ({
    session: {
      ...session,
      mainDeck: correct ? session.mainDeck.filter((c: unknown) => c !== card) : session.mainDeck,
      buffer: session.buffer,
    },
    srsUpdate: { interval: 1, easeFactor: 2.5, nextReviewAt: new Date(), wrongCount: 0, consecutiveCorrect: 1 },
  })),
}));

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = { tagId: '', fcMode: 'passive' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

import FlashcardScreen from '../flashcard';

const WORD_A = {
  id: 'w1',
  word: 'ephemeral',
  definition: 'Lasting for a very short time',
  example_sentence: 'The ephemeral beauty of cherry blossoms.',
  source_id: null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  srs_interval: 0,
  srs_ease_factor: 2.5,
  srs_next_review_at: null,
  srs_wrong_count: 0,
  srs_consecutive_correct: 0,
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
  srs_interval: 0,
  srs_ease_factor: 2.5,
  srs_next_review_at: null,
  srs_wrong_count: 0,
  srs_consecutive_correct: 0,
};

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

describe('FlashcardScreen — Passive mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { tagId: '', fcMode: 'passive' };
    mockFetchAllWords.mockResolvedValue([WORD_A, WORD_B]);
    mockFetchDueWordsFc.mockResolvedValue([]);
  });

  it('shows the word on mount', async () => {
    mockFetchAllWords.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('ephemeral');
  });

  it('does not show definition before reveal', async () => {
    mockFetchAllWords.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    const texts = collectText(tree.toJSON());
    expect(texts).not.toContain('Lasting for a very short time');
  });

  it('shows definition and example after tapping Reveal Answer', async () => {
    mockFetchAllWords.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'reveal-button' }).props.onPress();
    });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('Lasting for a very short time');
    expect(texts).toContain('The ephemeral beauty of cherry blossoms.');
  });

  it('shows Next button (not Got it / Missed it) in passive mode after reveal', async () => {
    mockFetchAllWords.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'reveal-button' }).props.onPress();
    });

    const texts = collectText(tree.toJSON());
    expect(texts.some(t => t.includes('Next'))).toBe(true);
    expect(texts).not.toContain('Got it ✓');
    expect(texts).not.toContain('Missed it ✗');
  });

  it('navigates to recall-summary when last card is passed in passive mode', async () => {
    mockFetchAllWords.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'reveal-button' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'next-button' }).props.onPress();
    });

    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/recall-summary',
        params: expect.objectContaining({ mode: 'flashcard', fcMode: 'passive' }),
      })
    );
  });
});

describe('FlashcardScreen — Self-Rated mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { tagId: '', fcMode: 'self-rated' };
    mockFetchDueWordsFc.mockResolvedValue([WORD_A, WORD_B]);
    mockFetchAllWords.mockResolvedValue([]);
  });

  it('shows Got it and Missed it buttons after reveal in self-rated mode', async () => {
    mockFetchDueWordsFc.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'reveal-button' }).props.onPress();
    });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain('Got it ✓');
    expect(texts).toContain('Missed it ✗');
    expect(texts.some(t => t.includes('Next'))).toBe(false);
  });

  it('increments score when Got it is tapped', async () => {
    mockFetchDueWordsFc.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'reveal-button' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'got-it-button' }).props.onPress();
    });

    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ score: '1', total: '1' }),
      })
    );
  });

  it('does not increment score when Missed it is tapped', async () => {
    mockFetchDueWordsFc.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'reveal-button' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'missed-it-button' }).props.onPress();
    });

    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ score: '0', total: '1' }),
      })
    );
  });

  it('calls updateWordFCSRS after Got it', async () => {
    mockFetchDueWordsFc.mockResolvedValue([WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      tree.root.findByProps({ testID: 'reveal-button' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'got-it-button' }).props.onPress();
    });

    expect(mockUpdateWordFCSRS).toHaveBeenCalledWith(
      WORD_A.id,
      expect.any(Number),
      expect.any(Number),
      expect.any(Date),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
