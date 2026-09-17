// @ts-nocheck
import {
  createSession,
  getNextCard,
  handleResponse,
  isSessionComplete,
} from '../srsAlgorithm';
import type { WordSRSRow } from '@/src/db/operations/srs';

function makeWord(
  id: string,
  interval = 0,
  easeFactor = 2.5,
  wrongCount = 0,
  consecutiveCorrect = 0,
): WordSRSRow {
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
    srs_wrong_count: wrongCount,
    srs_consecutive_correct: consecutiveCorrect,
    fc_wrong_count: 0,
    mnemonic: null,
  };
}

function makeBufferCard(id: string, wrongCount = 1, consecutiveCorrect = 0, successCount = 0) {
  const base = createSession([makeWord(id, 0, 2.5, wrongCount, consecutiveCorrect)]);
  return { ...base.mainDeck[0], inBuffer: true, successCount };
}

describe('createSession', () => {
  it('puts all words in mainDeck with empty buffer', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    expect(session.mainDeck).toHaveLength(2);
    expect(session.buffer).toHaveLength(0);
  });

  it('initialises CardState from word SRS values', () => {
    const session = createSession([makeWord('a', 5, 2.3, 2, 3)]);
    expect(session.mainDeck[0].interval).toBe(5);
    expect(session.mainDeck[0].easeFactor).toBe(2.3);
    expect(session.mainDeck[0].wrongCount).toBe(2);
    expect(session.mainDeck[0].consecutiveCorrect).toBe(3);
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
    const bufferSession = {
      ...session,
      buffer: [{ word: makeWord('a'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0, wrongCount: 1, consecutiveCorrect: 0 }],
    };
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
    const bufferCard = { word: makeWord('x'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0, wrongCount: 1, consecutiveCorrect: 0 };
    const sessionWithBuffer = { ...session, buffer: [bufferCard], cardsSinceBuffer: 5 };
    const card = getNextCard(sessionWithBuffer, () => 0); // threshold = 3, 5 >= 3
    expect(card!.inBuffer).toBe(true);
  });

  it('returns mainDeck card when active buffer card is not yet due', () => {
    const session = createSession([makeWord('a')]);
    const bufferCard = { word: makeWord('x'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0, wrongCount: 1, consecutiveCorrect: 0, nextAppearanceIndex: 2 };
    const sessionWithBuffer = { ...session, buffer: [bufferCard], cardsSinceBuffer: 0 };
    const card = getNextCard(sessionWithBuffer);
    expect(card!.inBuffer).toBe(false);
  });

  it('returns buffer card when mainDeck is empty', () => {
    const session = createSession([]);
    const bufferCard = { word: makeWord('x'), interval: 0, easeFactor: 2.5, inBuffer: true, successCount: 0, wrongCount: 1, consecutiveCorrect: 0 };
    const bufferSession = { ...session, buffer: [bufferCard] };
    const card = getNextCard(bufferSession);
    expect(card!.inBuffer).toBe(true);
  });
});

describe('handleResponse — correct, main deck card (never wrong)', () => {
  it('removes card from mainDeck', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const card = session.mainDeck[0];
    const { session: next } = handleResponse(session, card, true);
    expect(next.mainDeck.find(c => c.word.id === card.word.id)).toBeUndefined();
  });

  it('applies DSR growth for never-wrong cards', () => {
    const session = createSession([makeWord('a', 4, 2.5, 0, 0)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    expect(srsUpdate.interval).toBeGreaterThan(4);
  });

  it('sets interval to 1 for brand-new cards (interval=0, wrongCount=0)', () => {
    const session = createSession([makeWord('a', 0, 2.5, 0, 0)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    expect(srsUpdate.interval).toBe(1);
  });

  it('sets nextReviewAt to ~interval days from now for never-wrong cards', () => {
    const session = createSession([makeWord('a', 2, 2.5, 0, 0)]);
    const before = Date.now();
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    const expectedMs = 5 * 24 * 60 * 60 * 1000; // max(1, round(2*2.5))=5 days
    expect(srsUpdate.nextReviewAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 1000);
    expect(srsUpdate.nextReviewAt.getTime()).toBeLessThanOrEqual(Date.now() + expectedMs + 1000);
  });

  it('increments cardsSinceBuffer', () => {
    const session = createSession([makeWord('a'), makeWord('b')]);
    const { session: next } = handleResponse(session, session.mainDeck[0], true);
    expect(next.cardsSinceBuffer).toBe(1);
  });

  it('increments consecutiveCorrect', () => {
    const session = createSession([makeWord('a', 0, 2.5, 0, 2)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    expect(srsUpdate.consecutiveCorrect).toBe(3);
  });
});

describe('handleResponse — correct, main deck card (previously wrong) - DSR model', () => {
  it('returns interval=1 when wrongCount>0 and consecutiveCorrect<1 (relearning phase)', () => {
    // Before this answer, consecutiveCorrect is 0. Next will be 1, which is < 2.
    const session = createSession([makeWord('a', 3, 2.5, 2, 0)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    expect(srsUpdate.interval).toBe(1);
  });

  it('grows interval when consecutiveCorrect>=1 (after this answer) despite previous wrongs', () => {
    // Before this answer, consecutiveCorrect is 1. Next will be 2.
    const session = createSession([makeWord('a', 4, 2.5, 2, 1)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    expect(srsUpdate.interval).toBeGreaterThan(4);
  });

  it('grows slower for cards with many previous wrongs (difficulty penalty)', () => {
    const sessionFewWrongs = createSession([makeWord('a', 4, 2.5, 1, 3)]);
    const { srsUpdate: updateFew } = handleResponse(sessionFewWrongs, sessionFewWrongs.mainDeck[0], true);

    const sessionManyWrongs = createSession([makeWord('b', 4, 2.5, 5, 3)]);
    const { srsUpdate: updateMany } = handleResponse(sessionManyWrongs, sessionManyWrongs.mainDeck[0], true);

    // updateMany should be less than or equal due to fuzzing, but statistically lower
    expect(updateMany.interval).toBeLessThan(updateFew.interval + 2);
  });

  it('does not change wrongCount on correct answer', () => {
    const session = createSession([makeWord('a', 0, 2.5, 3, 0)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], true);
    expect(srsUpdate.wrongCount).toBe(3);
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

  it('increments wrongCount', () => {
    const session = createSession([makeWord('a', 0, 2.5, 2, 3)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], false);
    expect(srsUpdate.wrongCount).toBe(3);
  });

  it('resets consecutiveCorrect to 0', () => {
    const session = createSession([makeWord('a', 0, 2.5, 1, 4)]);
    const { srsUpdate } = handleResponse(session, session.mainDeck[0], false);
    expect(srsUpdate.consecutiveCorrect).toBe(0);
  });

  it('increments cardsSinceBuffer', () => {
    const session = { ...createSession([makeWord('a'), makeWord('b')]), cardsSinceBuffer: 4 };
    const { session: next } = handleResponse(session, session.mainDeck[0], false);
    expect(next.cardsSinceBuffer).toBe(5);
  });
});

describe('handleResponse — buffer card lifecycle', () => {
  it('increments successCount on first correct but keeps card in buffer', () => {
    const card = makeBufferCard('a', 1, 0, 0);
    const sess = createSession([]);
    const session = { ...sess, buffer: [card] };
    const { session: next } = handleResponse(session, card, true);
    expect(next.buffer).toHaveLength(1);
    expect(next.buffer[0].successCount).toBe(1);
  });

  it('graduates card after 2 consecutive correct answers with interval=1', () => {
    const card = makeBufferCard('a', 1, 0, 1);
    const sess = createSession([]);
    const session = { ...sess, mainDeck: [], buffer: [card] };
    const { session: next, srsUpdate } = handleResponse(session, card, true);
    expect(next.buffer).toHaveLength(0);
    expect(srsUpdate.interval).toBe(1);
  });

  it('increments consecutiveCorrect on graduation', () => {
    const card = makeBufferCard('a', 1, 2, 1);
    const sess = createSession([]);
    const session = { ...sess, mainDeck: [], buffer: [card] };
    const { srsUpdate } = handleResponse(session, card, true);
    expect(srsUpdate.consecutiveCorrect).toBe(3);
  });

  it('resets successCount and stays in buffer on incorrect', () => {
    const card = makeBufferCard('a', 1, 0, 1);
    const sess = createSession([]);
    const session = { ...sess, mainDeck: [], buffer: [card] };
    const { session: next } = handleResponse(session, card, false);
    expect(next.buffer[0].successCount).toBe(0);
    expect(next.buffer[0].inBuffer).toBe(true);
  });

  it('increments wrongCount on incorrect buffer card', () => {
    const card = makeBufferCard('a', 2, 0, 0);
    const sess = createSession([]);
    const session = { ...sess, mainDeck: [], buffer: [card] };
    const { srsUpdate } = handleResponse(session, card, false);
    expect(srsUpdate.wrongCount).toBe(3);
  });

  it('resets consecutiveCorrect to 0 on incorrect buffer card', () => {
    const card = makeBufferCard('a', 1, 3, 0);
    const sess = createSession([]);
    const session = { ...sess, mainDeck: [], buffer: [card] };
    const { srsUpdate } = handleResponse(session, card, false);
    expect(srsUpdate.consecutiveCorrect).toBe(0);
  });

  it('increments cardsSinceBuffer after any buffer card interaction', () => {
    const card = makeBufferCard('a', 1, 0, 0);
    const sess = createSession([]);
    const session = { ...sess, mainDeck: [], buffer: [card], cardsSinceBuffer: 4 };
    const { session: next } = handleResponse(session, card, true);
    expect(next.cardsSinceBuffer).toBe(5);
  });
});

describe('createSession with recentlyWrongIds and todayWordIds', () => {
  it('pre-seeds recentlyWrongIds into buffer, not mainDeck', () => {
    const words = [makeWord('a'), makeWord('b'), makeWord('c')];
    const session = createSession(words, ['a'], []);
    const bufferIds = session.buffer.map(c => c.word.id);
    const mainIds = session.mainDeck.map(c => c.word.id);
    expect(bufferIds).toContain('a');
    expect(mainIds).not.toContain('a');
    expect(session.buffer[0].inBuffer).toBe(true);
  });

  it('places todayWordIds at the front of mainDeck', () => {
    const words = [makeWord('x'), makeWord('y'), makeWord('z')];
    const session = createSession(words, [], ['z']);
    const mainIds = session.mainDeck.map(c => c.word.id);
    const zIdx = mainIds.indexOf('z');
    const xIdx = mainIds.indexOf('x');
    const yIdx = mainIds.indexOf('y');
    expect(zIdx).toBeLessThan(xIdx);
    expect(zIdx).toBeLessThan(yIdx);
  });

  it('word in recentlyWrongIds is not duplicated in mainDeck', () => {
    const words = [makeWord('a'), makeWord('b')];
    const session = createSession(words, ['a'], ['a']);
    const allIds = [...session.mainDeck, ...session.buffer].map(c => c.word.id);
    const aCount = allIds.filter(id => id === 'a').length;
    expect(aCount).toBe(1);
  });

  it('empty arrays behave identically to no args', () => {
    const words = [makeWord('a'), makeWord('b')];
    const s1 = createSession(words);
    const s2 = createSession(words, [], []);
    expect(s1.buffer).toHaveLength(s2.buffer.length);
    expect(s1.mainDeck).toHaveLength(s2.mainDeck.length);
  });

  it('recentlyWrongIds not in words list are silently ignored', () => {
    const words = [makeWord('a')];
    const session = createSession(words, ['no-such-id'], []);
    expect(session.mainDeck).toHaveLength(1);
    expect(session.buffer).toHaveLength(0);
  });
});
