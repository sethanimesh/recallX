import type { WordSRSRow } from '@/src/db/operations/srs';

export interface CardState {
  word: WordSRSRow;
  interval: number;
  easeFactor: number;
  inBuffer: boolean;
  successCount: number; // Consecutive correct answers in this session (acts as streak)
  wrongCount: number;
  consecutiveCorrect: number;
  nextAppearanceIndex?: number; // Absolute step index when this card is next due
}

export interface Session {
  mainDeck: CardState[]; // Pending pool of unintroduced words
  buffer: CardState[];   // Active pool of words currently in play (max 3)
  cardsSinceBuffer: number; // Acts as currentStepIndex (incremented after each response)
}

export interface SRSUpdate {
  interval: number;
  easeFactor: number;
  nextReviewAt: Date;
  wrongCount: number;
  consecutiveCorrect: number;
}

export interface ResponseResult {
  session: Session;
  srsUpdate: SRSUpdate;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Aggressive interval calculation:
// - Never wrong: standard SM-2
// - Wrong ≥1: stay at 1 day until 5 consecutive correct sessions
// - After 5 consecutive: SM-2 with caps based on failure count
//   wrongCount 6+  → permanently 1 day
//   wrongCount 3-5 → max 2 days
//   wrongCount 1-2 → normal SM-2 resumes
function calculateNextInterval(
  interval: number,
  easeFactor: number,
  wrongCount: number,
  consecutiveCorrect: number,
): number {
  if (wrongCount === 0) {
    return Math.max(1, Math.round(interval * easeFactor));
  }
  if (consecutiveCorrect < 5) {
    return 1;
  }
  const sm2 = Math.max(1, Math.round(interval * easeFactor));
  if (wrongCount >= 6) return 1;
  if (wrongCount >= 3) return Math.min(sm2, 2);
  return sm2;
}

export function createSession(
  words: WordSRSRow[],
  recentlyWrongIds: string[] = [],
  todayWordIds: string[] = [],
): Session {
  const wrongIdSet = new Set(recentlyWrongIds);
  const todayIdSet = new Set(todayWordIds);

  const bufferCards: CardState[] = [];
  const todayCards: CardState[] = [];
  const restCards: CardState[] = [];

  for (const w of words) {
    const card: CardState = {
      word: w,
      interval: w.srs_interval,
      easeFactor: w.srs_ease_factor,
      inBuffer: false,
      successCount: 0,
      wrongCount: w.srs_wrong_count,
      consecutiveCorrect: w.srs_consecutive_correct,
      nextAppearanceIndex: 0,
    };
    if (wrongIdSet.has(w.id)) {
      bufferCards.push({ ...card, inBuffer: true, nextAppearanceIndex: 0 });
    } else if (todayIdSet.has(w.id)) {
      todayCards.push(card);
    } else {
      restCards.push(card);
    }
  }

  const shuffledToday = [...todayCards].sort(() => Math.random() - 0.5);
  const shuffledRest = [...restCards].sort(() => Math.random() - 0.5);

  return {
    mainDeck: [...shuffledToday, ...shuffledRest],
    buffer: bufferCards,
    cardsSinceBuffer: 0,
  };
}

export function getNextCard(session: Session, _randomFn: () => number = Math.random): CardState | null {
  if (session.mainDeck.length === 0 && session.buffer.length === 0) return null;

  const step = session.cardsSinceBuffer;

  // 1. Check if any card in the active pool (buffer) is due
  const dueCards = session.buffer.filter(c => (c.nextAppearanceIndex ?? 0) <= step);

  if (dueCards.length > 0) {
    // Pick the one with the lowest successCount (streak)
    // If equal, pick the one with the lowest nextAppearanceIndex (most overdue)
    dueCards.sort((a, b) => {
      if (a.successCount !== b.successCount) {
        return a.successCount - b.successCount;
      }
      return (a.nextAppearanceIndex ?? 0) - (b.nextAppearanceIndex ?? 0);
    });
    return dueCards[0];
  }

  // 2. If no active card is due, introduce a new card from mainDeck if active pool is not full (max 3 in play)
  const MAX_ACTIVE_POOL_SIZE = 3;
  if (session.buffer.length < MAX_ACTIVE_POOL_SIZE && session.mainDeck.length > 0) {
    return session.mainDeck[0];
  }

  // 3. If pool is full or mainDeck empty, fallback to the card in buffer closest to being due
  if (session.buffer.length > 0) {
    const sortedActive = [...session.buffer].sort((a, b) => (a.nextAppearanceIndex ?? 0) - (b.nextAppearanceIndex ?? 0));
    return sortedActive[0];
  }

  // 4. Fallback to mainDeck
  if (session.mainDeck.length > 0) {
    return session.mainDeck[0];
  }

  return null;
}

export function handleResponse(
  session: Session,
  card: CardState,
  correct: boolean,
  _randomFn: () => number = Math.random,
): ResponseResult {
  const now = new Date();
  const step = session.cardsSinceBuffer;

  const wasInBuffer = card.inBuffer;

  if (!wasInBuffer) {
    // This is a brand new card being introduced from mainDeck
    if (correct) {
      // Correct on very first try! Graduates immediately.
      const newConsecutiveCorrect = card.consecutiveCorrect + 1;
      const newInterval = calculateNextInterval(card.interval, card.easeFactor, card.wrongCount, newConsecutiveCorrect);

      return {
        session: {
          ...session,
          mainDeck: session.mainDeck.filter(c => c.word.id !== card.word.id),
          cardsSinceBuffer: step + 1,
        },
        srsUpdate: {
          interval: newInterval,
          easeFactor: card.easeFactor,
          nextReviewAt: new Date(now.getTime() + newInterval * MS_PER_DAY),
          wrongCount: card.wrongCount,
          consecutiveCorrect: newConsecutiveCorrect,
        },
      };
    } else {
      // Incorrect on first try! Enters active pool (buffer)
      const newEaseFactor = Math.max(1.3, card.easeFactor - 0.2);
      const newWrongCount = card.wrongCount + 1;

      const updatedCard: CardState = {
        ...card,
        inBuffer: true,
        successCount: 0,
        wrongCount: newWrongCount,
        consecutiveCorrect: 0,
        nextAppearanceIndex: step + 2, // Re-appear after a 1-card gap (step + 2)
      };

      return {
        session: {
          ...session,
          mainDeck: session.mainDeck.filter(c => c.word.id !== card.word.id),
          buffer: [...session.buffer, updatedCard],
          cardsSinceBuffer: step + 1,
        },
        srsUpdate: {
          interval: 0,
          easeFactor: newEaseFactor,
          nextReviewAt: now,
          wrongCount: newWrongCount,
          consecutiveCorrect: 0,
        },
      };
    }
  } else {
    // This card was already in active play (buffer)
    if (correct) {
      const newSuccessCount = card.successCount + 1;

      if (newSuccessCount >= 2) {
        // Correct twice consecutively! Graduates from buffer.
        const newConsecutiveCorrect = card.consecutiveCorrect + 1;

        return {
          session: {
            ...session,
            buffer: session.buffer.filter(c => c.word.id !== card.word.id),
            cardsSinceBuffer: step + 1,
          },
          srsUpdate: {
            interval: 1,
            easeFactor: card.easeFactor,
            nextReviewAt: new Date(now.getTime() + MS_PER_DAY),
            wrongCount: card.wrongCount,
            consecutiveCorrect: newConsecutiveCorrect,
          },
        };
      } else {
        // Correct once, needs one more correct response to graduate. Space it out.
        const updatedCard: CardState = {
          ...card,
          successCount: newSuccessCount,
          nextAppearanceIndex: step + 3, // Re-appear after a 2-card gap (step + 3)
        };

        return {
          session: {
            ...session,
            buffer: session.buffer.map(c => c.word.id === card.word.id ? updatedCard : c),
            cardsSinceBuffer: step + 1,
          },
          srsUpdate: {
            interval: card.interval,
            easeFactor: card.easeFactor,
            nextReviewAt: new Date(now.getTime() + 60_000), // check again in 1 min
            wrongCount: card.wrongCount,
            consecutiveCorrect: card.consecutiveCorrect,
          },
        };
      }
    } else {
      // Incorrect again! Reset streak, schedule to re-appear very soon.
      const newEaseFactor = Math.max(1.3, card.easeFactor - 0.2);
      const newWrongCount = card.wrongCount + 1;

      const updatedCard: CardState = {
        ...card,
        successCount: 0,
        wrongCount: newWrongCount,
        consecutiveCorrect: 0,
        nextAppearanceIndex: step + 2, // Re-appear after a 1-card gap (step + 2)
      };

      return {
        session: {
          ...session,
          buffer: session.buffer.map(c => c.word.id === card.word.id ? updatedCard : c),
          cardsSinceBuffer: step + 1,
        },
        srsUpdate: {
          interval: 0,
          easeFactor: newEaseFactor,
          nextReviewAt: now,
          wrongCount: newWrongCount,
          consecutiveCorrect: 0,
        },
      };
    }
  }
}

export function isSessionComplete(session: Session): boolean {
  return session.mainDeck.length === 0 && session.buffer.length === 0;
}

