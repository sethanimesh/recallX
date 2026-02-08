import type { WordSRSRow } from '@/src/db/operations/srs';

export interface CardState {
  word: WordSRSRow;
  interval: number;
  easeFactor: number;
  inBuffer: boolean;
  successCount: number;
}

export interface Session {
  mainDeck: CardState[];
  buffer: CardState[];
  mainIndex: number;
  cardsSinceBuffer: number;
}

export interface SRSUpdate {
  interval: number;
  easeFactor: number;
  nextReviewAt: Date;
}

export interface ResponseResult {
  session: Session;
  srsUpdate: SRSUpdate;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function createSession(words: WordSRSRow[]): Session {
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  return {
    mainDeck: shuffled.map(w => ({
      word: w,
      interval: w.srs_interval,
      easeFactor: w.srs_ease_factor,
      inBuffer: false,
      successCount: 0,
    })),
    buffer: [],
    mainIndex: 0,
    cardsSinceBuffer: 0,
  };
}

export function getNextCard(session: Session): CardState | null {
  if (session.mainDeck.length === 0 && session.buffer.length === 0) return null;

  // Serve a buffer card every 3–5 main-deck cards
  const threshold = 3 + Math.floor(Math.random() * 3);
  if (session.buffer.length > 0 && session.cardsSinceBuffer >= threshold) {
    return session.buffer[0];
  }

  if (session.mainDeck.length > 0) return session.mainDeck[0];

  // Only buffer remains
  return session.buffer[0];
}

export function handleResponse(
  session: Session,
  card: CardState,
  correct: boolean,
): ResponseResult {
  const now = new Date();

  if (card.inBuffer) {
    if (correct) {
      const newSuccessCount = card.successCount + 1;
      if (newSuccessCount >= 2) {
        // Graduate from buffer
        return {
          session: {
            ...session,
            buffer: session.buffer.filter(c => c.word.id !== card.word.id),
            cardsSinceBuffer: 0,
          },
          srsUpdate: { interval: 1, easeFactor: card.easeFactor, nextReviewAt: new Date(now.getTime() + MS_PER_DAY) },
        };
      }
      // Still needs one more correct — keep in buffer
      return {
        session: {
          ...session,
          buffer: session.buffer.map(c =>
            c.word.id === card.word.id ? { ...c, successCount: newSuccessCount } : c,
          ),
          cardsSinceBuffer: 0,
        },
        srsUpdate: { interval: card.interval, easeFactor: card.easeFactor, nextReviewAt: now },
      };
    } else {
      // Incorrect buffer card — reset successCount
      const newEaseFactor = Math.max(1.3, card.easeFactor - 0.2);
      return {
        session: {
          ...session,
          buffer: session.buffer.map(c =>
            c.word.id === card.word.id ? { ...c, easeFactor: newEaseFactor, successCount: 0 } : c,
          ),
          cardsSinceBuffer: 0,
        },
        srsUpdate: { interval: 0, easeFactor: newEaseFactor, nextReviewAt: now },
      };
    }
  }

  // Main deck card
  if (correct) {
    const newInterval = Math.max(1, Math.round(card.interval * card.easeFactor));
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
      },
    };
  } else {
    const newEaseFactor = Math.max(1.3, card.easeFactor - 0.2);
    const bufferCard: CardState = { ...card, easeFactor: newEaseFactor, interval: 0, inBuffer: true, successCount: 0 };
    const insertAt = Math.min(3, session.buffer.length);
    return {
      session: {
        ...session,
        mainDeck: session.mainDeck.filter(c => c.word.id !== card.word.id),
        buffer: [...session.buffer.slice(0, insertAt), bufferCard, ...session.buffer.slice(insertAt)],
        cardsSinceBuffer: 0,
      },
      srsUpdate: { interval: 0, easeFactor: newEaseFactor, nextReviewAt: now },
    };
  }
}

export function isSessionComplete(session: Session): boolean {
  return session.mainDeck.length === 0 && session.buffer.length === 0;
}
