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

  it('sorts words alphabetically if sortOrder is alphabetical', async () => {
    mockParams = { tagId: '', fcMode: 'passive', sortOrder: 'alphabetical' };
    mockFetchAllWords.mockResolvedValue([WORD_B, WORD_A]); // tenacious (B), ephemeral (A)

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    // Should sort alphabetically, so 'ephemeral' (A) is first
    const texts = collectText(tree.toJSON());
    expect(texts).toContain('ephemeral');
  });

  it('allows going back to the previous card', async () => {
    mockParams = { tagId: '', fcMode: 'passive', sortOrder: 'alphabetical' };
    mockFetchAllWords.mockResolvedValue([WORD_B, WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    // Sorted alphabetically: WORD_A (ephemeral) is first, WORD_B (tenacious) is second.
    await act(async () => {
      tree.root.findByProps({ testID: 'reveal-button' }).props.onPress();
    });
    // Go to next card
    await act(async () => {
      tree.root.findByProps({ testID: 'next-button' }).props.onPress();
    });

    // We should be on card 2. Now tap back
    await act(async () => {
      tree.root.findByProps({ testID: 'prev-button' }).props.onPress();
    });

    // Check we are back in the question phase of card 1
    const texts = collectText(tree.toJSON());
    expect(texts).toContain(WORD_A.word);
    expect(texts).not.toContain(WORD_A.definition);
  });

  it('allows skipping a card without revealing', async () => {
    mockParams = { tagId: '', fcMode: 'passive', sortOrder: 'alphabetical' };
    mockFetchAllWords.mockResolvedValue([WORD_B, WORD_A]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<FlashcardScreen />); });
    await act(async () => { await Promise.resolve(); });

    // Starts on card 1 (WORD_A). Tap skip to go to card 2 (WORD_B).
    await act(async () => {
      tree.root.findByProps({ testID: 'skip-button' }).props.onPress();
    });

    // Now we should be on card 2 (WORD_B). We can reveal it
    await act(async () => {
      tree.root.findByProps({ testID: 'reveal-button' }).props.onPress();
    });

    const texts = collectText(tree.toJSON());
    expect(texts).toContain(WORD_B.word);
    expect(texts).toContain(WORD_B.definition);
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
