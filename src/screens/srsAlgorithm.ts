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

// Advanced DSR-inspired calculation (Difficulty, Stability, Retrievability)
// This replaces the rigid SM-2 approach with a more fluid, human-like memory model.
function calculateNextStability(
  currentStability: number,
  easeFactor: number,
  wrongCount: number,
  consecutiveCorrect: number,
): number {
  // Base case: first time graduating
  if (currentStability === 0 || currentStability < 1) {
    return 1;
  }

  // Relearning phase: if they got it wrong recently, they need a short proof streak
  // before stability starts growing exponentially again.
  if (wrongCount > 0 && consecutiveCorrect < 2) {
    return 1;
  }

  // 1. Streak Confidence: gently rewards consistent correct answers
  // Math.log(streak + 2) provides a logarithmic growth (e.g. streak=2 -> 1.38, streak=5 -> 1.9)
  const streakConfidence = Math.log(consecutiveCorrect + 2) / Math.log(3); // Normalizes streak=1 to ~1.0

  // 2. Inherent Difficulty Penalty: cards that have been wrong a lot grow stability slower
  const difficultyPenalty = Math.pow(0.85, Math.min(wrongCount, 10)); // Max penalty ~20% of original growth

  // 3. Combined Growth Multiplier
  let growthMultiplier = easeFactor * streakConfidence * difficultyPenalty;

  // Clamp multiplier to prevent runaway intervals (max 3x) or stagnant intervals (min 1.2x)
  growthMultiplier = Math.max(1.2, Math.min(growthMultiplier, 3.0));

  // Compute next stability (interval in days)
  let nextStability = currentStability * growthMultiplier;

  // Apply "fuzzing" to prevent clumping of reviews on the exact same day
  // Fuzzing adds ±5% randomness to intervals > 4 days
  if (nextStability > 4) {
    const fuzz = nextStability * 0.05;
    nextStability += (Math.random() * (fuzz * 2)) - fuzz;
  }

  return Math.max(1, Math.round(nextStability));
}

// Adjust Ease Factor (represents internal Difficulty)
function calculateNextEaseFactor(easeFactor: number, correct: boolean): number {
  if (correct) {
    // Gently increase ease when correct, acknowledging learning
    return Math.min(3.5, easeFactor + 0.05);
  } else {
    // Sharply decrease ease when wrong, marking it as a difficult card
    return Math.max(1.3, easeFactor - 0.2);
  }
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
    // Brand new card being introduced from mainDeck
    if (correct) {
      // Correct on first try: Graduates immediately
      const newConsecutiveCorrect = card.consecutiveCorrect + 1;
      const newEaseFactor = calculateNextEaseFactor(card.easeFactor, true);
      const newInterval = calculateNextStability(card.interval, newEaseFactor, card.wrongCount, newConsecutiveCorrect);

      return {
        session: {
          ...session,
          mainDeck: session.mainDeck.filter(c => c.word.id !== card.word.id),
          cardsSinceBuffer: step + 1,
        },
        srsUpdate: {
          interval: newInterval,
          easeFactor: newEaseFactor,
          nextReviewAt: new Date(now.getTime() + newInterval * MS_PER_DAY),
          wrongCount: card.wrongCount,
          consecutiveCorrect: newConsecutiveCorrect,
        },
      };
    } else {
      // Incorrect on first try: Enters active pool (buffer)
      const newEaseFactor = calculateNextEaseFactor(card.easeFactor, false);
      const newWrongCount = card.wrongCount + 1;

      const updatedCard: CardState = {
        ...card,
        inBuffer: true,
        successCount: 0,
        wrongCount: newWrongCount,
        consecutiveCorrect: 0,
        nextAppearanceIndex: step + 2, // Re-appear soon
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
          nextReviewAt: now, // Due immediately
          wrongCount: newWrongCount,
          consecutiveCorrect: 0,
        },
      };
    }
  } else {
    // Card was already in active play (buffer)
    if (correct) {
      const newSuccessCount = card.successCount + 1;

      if (newSuccessCount >= 2) {
        // Correct twice consecutively: Graduates from buffer
        const newConsecutiveCorrect = card.consecutiveCorrect + 1;
        const newEaseFactor = calculateNextEaseFactor(card.easeFactor, true);
        
        // If it was already a graduated card that lapsed, recalculate its stability
        // If it was a new card, it will get 1 day stability
        const newInterval = calculateNextStability(card.interval, newEaseFactor, card.wrongCount, newConsecutiveCorrect);

        return {
          session: {
            ...session,
            buffer: session.buffer.filter(c => c.word.id !== card.word.id),
            cardsSinceBuffer: step + 1,
          },
          srsUpdate: {
            interval: newInterval,
            easeFactor: newEaseFactor,
            nextReviewAt: new Date(now.getTime() + newInterval * MS_PER_DAY),
            wrongCount: card.wrongCount,
            consecutiveCorrect: newConsecutiveCorrect,
          },
        };
      } else {
        // Correct once, needs one more to graduate
        const updatedCard: CardState = {
          ...card,
          successCount: newSuccessCount,
          nextAppearanceIndex: step + 3,
        };

        return {
          session: {
            ...session,
            buffer: session.buffer.map(c => c.word.id === card.word.id ? updatedCard : c),
            cardsSinceBuffer: step + 1,
          },
          srsUpdate: {
            interval: card.interval,
            easeFactor: card.easeFactor, // Don't bump ease until fully graduated
            nextReviewAt: new Date(now.getTime() + 60_000), // Check again in 1 min
            wrongCount: card.wrongCount,
            consecutiveCorrect: card.consecutiveCorrect,
          },
        };
      }
    } else {
      // Incorrect again in buffer
      const newEaseFactor = calculateNextEaseFactor(card.easeFactor, false);
      const newWrongCount = card.wrongCount + 1;

      const updatedCard: CardState = {
        ...card,
        successCount: 0, // Reset streak in buffer
        wrongCount: newWrongCount,
        consecutiveCorrect: 0, // Reset overall streak
        nextAppearanceIndex: step + 2,
      };

      return {
        session: {
          ...session,
          buffer: session.buffer.map(c => c.word.id === card.word.id ? updatedCard : c),
          cardsSinceBuffer: step + 1,
        },
        srsUpdate: {
          interval: 0, // Falls back to 0 interval (in relearning)
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

