import {
  createSession,
  getNextCard,
  handleResponse,
  isSessionComplete,
} from '../srsAlgorithm';
import type { WordSRSRow } from '@/src/db/operations/srs';

function makeWord(id: string, interval = 0, easeFactor = 2.5): WordSRSRow {
  return {
    id,
    word: `word-${id}`,
    definition: `def-${id}`,
    example_sentence: `ex-${id}`,
    source_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    srs_interval: interval,
    srs_ease_factor: easeFactor,
    srs_next_review_at: null,
  };
}

describe('createSession', () => {
  it('puts all words in mainDeck with empty buffer', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    expect(session.mainDeck).toHaveLength(2);
    expect(session.buffer).toHaveLength(0);
  });

  it('initialises CardState from word SRS values', () => {
    const session = createSession([makeWord('a', 5, 2.3)]);
    expect(session.mainDeck[0].interval).toBe(5);
    expect(session.mainDeck[0].easeFactor).toBe(2.3);
    expect(session.mainDeck[0].inBuffer).toBe(false);
    expect(session.mainDeck[0].successCount).toBe(0);
  });

  it('starts cardsSinceBuffer at 0', () => {
    const session = createSession([makeWord('a')]);
    expect(session.cardsSinceBuffer).toBe(0);
  });
});

describe('isSessionComplete', () => {
  it('returns true when both queues are empty', () => {
    expect(isSessionComplete(createSession([]))).toBe(true);
  });

  it('returns false when mainDeck has cards', () => {
    expect(isSessionComplete(createSession([makeWord('a')]))).toBe(false);
  });

  it('returns false when buffer has cards and mainDeck is empty', () => {
    const session = createSession([]);
    const bufferSession = { ...session, buffer: [{ word: makeWord('a'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0 }] };
    expect(isSessionComplete(bufferSession)).toBe(false);
  });
});

describe('getNextCard', () => {
  it('returns null when session is complete', () => {
    expect(getNextCard(createSession([]))).toBeNull();
  });

  it('returns mainDeck[0] when buffer is empty', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const card = getNextCard(session);
    expect(card).not.toBeNull();
    expect(card!.inBuffer).toBe(false);
  });

  it('returns buffer[0] when cardsSinceBuffer >= 5 (always over any threshold)', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const bufferCard = { word: makeWord('x'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0 };
    const sessionWithBuffer = { ...session, buffer: [bufferCard], cardsSinceBuffer: 5 };
    const card = getNextCard(sessionWithBuffer, () => 0); // threshold = 3, 5 >= 3
    expect(card!.inBuffer).toBe(true);
  });

  it('returns mainDeck card when only buffer exists but cardsSinceBuffer is 0', () => {
    const session = createSession([makeWord('a')]);
    const bufferCard = { word: makeWord('x'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0 };
    const sessionWithBuffer = { ...session, buffer: [bufferCard], cardsSinceBuffer: 0 };
    const card = getNextCard(sessionWithBuffer, () => 0); // threshold = 3, 0 < 3 → main deck
    expect(card!.inBuffer).toBe(false);
  });

  it('returns buffer card when mainDeck is empty', () => {
    const session = createSession([]);
    const bufferCard = { word: makeWord('x'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0 };
    const bufferSession = { ...session, buffer: [bufferCard] };
    const card = getNextCard(bufferSession);
    expect(card!.inBuffer).toBe(true);
  });
});

describe('handleResponse — correct, main deck card', () => {
  it('removes card from mainDeck', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const card = session.mainDeck[0];
    const { session: next } = handleResponse(session, card, true);
    expect(next.mainDeck.find(c => c.word.id === card.word.id)).toBeUndefined();
  });

  it('applies SM-2: new interval = max(1, round(interval * easeFactor))', () => {
    const session = createSession([makeWord('a', 4, 2.5)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    expect(srsUpdate.interval).toBe(10); // max(1, round(4 * 2.5))
  });

  it('sets interval to 1 for new cards (interval=0)', () => {
    const session = createSession([makeWord('a', 0, 2.5)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    expect(srsUpdate.interval).toBe(1); // max(1, 0)
  });

  it('sets nextReviewAt to ~interval days from now', () => {
    const session = createSession([makeWord('a', 2, 2.5)]);
    const before = Date.now();
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    const expectedMs = 5 * 24 * 60 * 60 * 1000; // interval=max(1, round(2*2.5))=5 days
    expect(srsUpdate.nextReviewAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 1000);
    expect(srsUpdate.nextReviewAt.getTime()).toBeLessThanOrEqual(Date.now() + expectedMs + 1000);
  });

  it('increments cardsSinceBuffer', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const { session: next } = handleResponse(session, session.mainDeck[0], true);
    expect(next.cardsSinceBuffer).toBe(1);
  });
});

describe('handleResponse — incorrect, main deck card', () => {
  it('moves card to buffer with inBuffer=true', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const card = session.mainDeck[0];
    const { session: next } = handleResponse(session, card, false);
    expect(next.mainDeck.find(c => c.word.id === card.word.id)).toBeUndefined();
    expect(next.buffer.some(c => c.word.id === card.word.id)).toBe(true);
    expect(next.buffer.find(c => c.word.id === card.word.id)!.inBuffer).toBe(true);
  });

  it('decreases easeFactor by 0.2', () => {
    const session = createSession([makeWord('a', 0, 2.0)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], false);
    expect(srsUpdate.easeFactor).toBeCloseTo(1.8, 5);
  });

  it('does not reduce easeFactor below 1.3', () => {
    const session = createSession([makeWord('a', 0, 1.3)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], false);
    expect(srsUpdate.easeFactor).toBe(1.3);
  });

  it('sets interval to 0', () => {
    const session = createSession([makeWord('a', 5, 2.5)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], false);
    expect(srsUpdate.interval).toBe(0);
  });

  it('sets nextReviewAt to now (within 200ms)', () => {
    const session = createSession([makeWord('a')]);
    const before = Date.now();
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], false);
    expect(srsUpdate.nextReviewAt.getTime()).toBeGreaterThanOrEqual(before - 100);
    expect(srsUpdate.nextReviewAt.getTime()).toBeLessThanOrEqual(Date.now() + 100);
  });

  it('resets cardsSinceBuffer to 0', () => {
    const session = { ...createSession([makeWord('a'), makeWord('b')]), cardsSinceBuffer: 4 };
    const { session: next } = handleResponse(session, session.mainDeck[0], false);
    expect(next.cardsSinceBuffer).toBe(0);
  });
});

describe('handleResponse — buffer card lifecycle', () => {
  function bufferSession() {
    const base = createSession([makeWord('a')]);
    const bufferCard = { ...base.mainDeck[0], inBuffer: true, successCount: 0 };
    return { session: { ...base, mainDeck: [], buffer: [bufferCard] }, card: bufferCard };
  }

  it('increments successCount on first correct but keeps card in buffer', () => {
    const { session, card } = bufferSession();
    const { session: next } = handleResponse(session, card, true);
    expect(next.buffer).toHaveLength(1);
    expect(next.buffer[0].successCount).toBe(1);
  });

  it('graduates card after 2 consecutive correct answers', () => {
    const base = createSession([makeWord('a')]);
    const bufferCard = { ...base.mainDeck[0], inBuffer: true, successCount: 1 };
    const sess = { ...base, mainDeck: [], buffer: [bufferCard] };
    const { session: next, srsUpdate } = handleResponse(sess, bufferCard, true);
    expect(next.buffer).toHaveLength(0);
    expect(srsUpdate.interval).toBe(1);
  });

  it('resets successCount and stays in buffer on incorrect', () => {
    const base = createSession([makeWord('a')]);
    const bufferCard = { ...base.mainDeck[0], inBuffer: true, successCount: 1 };
    const sess = { ...base, mainDeck: [], buffer: [bufferCard] };
    const { session: next } = handleResponse(sess, bufferCard, false);
    expect(next.buffer[0].successCount).toBe(0);
    expect(next.buffer[0].inBuffer).toBe(true);
  });

  it('resets cardsSinceBuffer to 0 after any buffer card interaction', () => {
    const { session, card } = bufferSession();
    const sessionWith = { ...session, cardsSinceBuffer: 4 };
    const { session: next } = handleResponse(sessionWith, card, true);
    expect(next.cardsSinceBuffer).toBe(0);
  });
});
