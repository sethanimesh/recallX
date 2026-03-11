import type { WordSRSRow } from '@/src/db/operations/srs';

export interface CardState {
  word: WordSRSRow;
  interval: number;
  easeFactor: number;
  inBuffer: boolean;
  successCount: number;
  wrongCount: number;
  consecutiveCorrect: number;
}

export interface Session {
  mainDeck: CardState[];
  buffer: CardState[];
  cardsSinceBuffer: number;
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
    };
    if (wrongIdSet.has(w.id)) {
      bufferCards.push({ ...card, inBuffer: true });
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

export function getNextCard(session: Session, randomFn: () => number = Math.random): CardState | null {
  if (session.mainDeck.length === 0 && session.buffer.length === 0) return null;

  // Serve a buffer card every 3–5 main-deck cards
  const threshold = 3 + Math.floor(randomFn() * 3);
  if (session.buffer.length > 0 && session.cardsSinceBuffer >= threshold) {
    return session.buffer[0];
  }

  if (session.mainDeck.length > 0) return session.mainDeck[0];

  return session.buffer[0];
}

export function handleResponse(
  session: Session,
  card: CardState,
  correct: boolean,
  randomFn: () => number = Math.random,
): ResponseResult {
  const now = new Date();

  if (card.inBuffer) {
    if (correct) {
      const newSuccessCount = card.successCount + 1;
      if (newSuccessCount >= 2) {
        // Graduate from buffer — counts as one correct session
        const newConsecutiveCorrect = card.consecutiveCorrect + 1;
        return {
          session: {
            ...session,
            buffer: session.buffer.filter(c => c.word.id !== card.word.id),
            cardsSinceBuffer: 0,
          },
          srsUpdate: {
            interval: 1,
            easeFactor: card.easeFactor,
            nextReviewAt: new Date(now.getTime() + MS_PER_DAY),
            wrongCount: card.wrongCount,
            consecutiveCorrect: newConsecutiveCorrect,
          },
        };
      }
      // Still needs one more correct — keep in buffer, don't change cross-session counters yet
      return {
        session: {
          ...session,
          buffer: session.buffer.map(c =>
            c.word.id === card.word.id ? { ...c, successCount: newSuccessCount } : c,
          ),
          cardsSinceBuffer: 0,
        },
        srsUpdate: {
          interval: card.interval,
          easeFactor: card.easeFactor,
          nextReviewAt: new Date(now.getTime() + 60_000),
          wrongCount: card.wrongCount,
          consecutiveCorrect: card.consecutiveCorrect,
        },
      };
    } else {
      // Incorrect buffer card — increment wrong count, reset streak, push further back
      const newEaseFactor = Math.max(1.3, card.easeFactor - 0.2);
      const newWrongCount = card.wrongCount + 1;
      // Push 2-4 positions deeper so other buffer cards appear first
      const insertOffset = 2 + Math.floor(randomFn() * 3);
      const insertAt = Math.min(insertOffset, session.buffer.length - 1);
      const withoutCard = session.buffer.filter(c => c.word.id !== card.word.id);
      const updatedCard: CardState = { ...card, easeFactor: newEaseFactor, successCount: 0, wrongCount: newWrongCount, consecutiveCorrect: 0 };
      return {
        session: {
          ...session,
          buffer: [...withoutCard.slice(0, insertAt), updatedCard, ...withoutCard.slice(insertAt)],
          cardsSinceBuffer: 0,
        },
        srsUpdate: { interval: 0, easeFactor: newEaseFactor, nextReviewAt: now, wrongCount: newWrongCount, consecutiveCorrect: 0 },
      };
    }
  }

  // Main deck card
  if (correct) {
    const newConsecutiveCorrect = card.consecutiveCorrect + 1;
    const newInterval = calculateNextInterval(card.interval, card.easeFactor, card.wrongCount, newConsecutiveCorrect);
    return {
      session: {
        ...session,
        mainDeck: session.mainDeck.filter(c => c.word.id !== card.word.id),
        cardsSinceBuffer: session.cardsSinceBuffer + 1,
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
    const newEaseFactor = Math.max(1.3, card.easeFactor - 0.2);
    const newWrongCount = card.wrongCount + 1;
    const bufferCard: CardState = {
      ...card,
      easeFactor: newEaseFactor,
      interval: 0,
      inBuffer: true,
      successCount: 0,
      wrongCount: newWrongCount,
      consecutiveCorrect: 0,
    };
    // Insert 8-15 cards ahead by placing at position 2-4 in buffer
    // (each buffer slot ≈ 3-5 main deck cards between buffer serves)
    const insertOffset = 2 + Math.floor(randomFn() * 3);
    const insertAt = Math.min(insertOffset, session.buffer.length);
    return {
      session: {
        ...session,
        mainDeck: session.mainDeck.filter(c => c.word.id !== card.word.id),
        buffer: [...session.buffer.slice(0, insertAt), bufferCard, ...session.buffer.slice(insertAt)],
        cardsSinceBuffer: 0,
      },
      srsUpdate: { interval: 0, easeFactor: newEaseFactor, nextReviewAt: now, wrongCount: newWrongCount, consecutiveCorrect: 0 },
    };
  }
}

export function isSessionComplete(session: Session): boolean {
  return session.mainDeck.length === 0 && session.buffer.length === 0;
}
