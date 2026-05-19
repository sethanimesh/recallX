import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  PanResponder,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchAllWords, fetchWordsByTag, type WordRow } from '@/src/db/operations/tags';
import { fetchDueWordsFc, updateWordFCSRS, type WordSRSRow } from '@/src/db/operations/srs';
import {
  insertSession,
  closeSession,
  insertSessionResult,
  fetchRecentlyWrongIds,
  fetchTodayWordIds,
  fetchWordsCreatedTodayForFlashcard,
} from '@/src/db/operations/sessionHistory';
import {
  createSession,
  getNextCard,
  handleResponse,
  type Session,
  type CardState,
  type SRSUpdate,
} from '@/src/screens/srsAlgorithm';
import TextWithLinks from '@/src/components/TextWithLinks';

type Phase = 'question' | 'revealed';
type FcMode = 'passive' | 'self-rated';

export default function FlashcardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tagId, fcMode: fcModeParam, todayOnly, sortOrder } = useLocalSearchParams<{ tagId: string; fcMode: string; todayOnly: string; sortOrder?: string }>();
  const fcMode: FcMode = fcModeParam === 'self-rated' ? 'self-rated' : 'passive';

  // Passive mode state
  const [deck, setDeck] = useState<WordRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Self-rated mode state
  const [session, setSession] = useState<Session | null>(null);
  const [card, setCard] = useState<CardState | null>(null);
  const [nextCard, setNextCard] = useState<CardState | null | undefined>(undefined);
  const missedIdsRef = useRef<string[]>([]);
  const sessionIdRef = useRef<string>(Date.now().toString(36) + Math.random().toString(36).slice(2));
  const attemptCountRef = useRef<Map<string, number>>(new Map());
  const preSeededIdsRef = useRef<Set<string>>(new Set());
  const clearedFromBufferRef = useRef<string[]>([]);
  const recentlyWrongIdsRef = useRef<string[]>([]);

  // Shared
  const [deckLoaded, setDeckLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>('question');
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);

  const handlersRef = useRef({ handleNext, handleReveal, handleBack, phase, fcMode });
  handlersRef.current = { handleNext, handleReveal, handleBack, phase, fcMode };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gs) => {
          const { fcMode, phase } = handlersRef.current;
          if (fcMode !== 'passive') return false;
          const isLeftSwipe = gs.dx < -30 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5;
          const isRightSwipe = gs.dx > 30 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5;
          const isSwipeUp = phase === 'question' && gs.dy < -30 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5;
          return isLeftSwipe || isRightSwipe || isSwipeUp;
        },
        onPanResponderRelease: (_, gs) => {
          const { fcMode, phase, handleNext, handleReveal, handleBack } = handlersRef.current;
          if (fcMode !== 'passive') return;
          const isLeftSwipe = gs.dx < -50 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5;
          const isRightSwipe = gs.dx > 50 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5;
          const isSwipeUp = phase === 'question' && gs.dy < -50 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5;
          if (isLeftSwipe) {
            handleNext();
          } else if (isRightSwipe) {
            handleBack();
          } else if (isSwipeUp) {
            handleReveal();
          }
        },
      }),
    [],
  );

  useEffect(() => {
    async function loadDeck() {
      if (fcMode === 'self-rated') {
        const wordsPool = todayOnly === 'true'
          ? await fetchWordsCreatedTodayForFlashcard(tagId && tagId.length > 0 ? tagId : undefined)
          : tagId && tagId.length > 0
            ? await fetchDueWordsFc(tagId)
            : await fetchDueWordsFc();
        const dueIds = wordsPool.map(w => w.id);
        const wrongIds = await fetchRecentlyWrongIds('flashcard', dueIds);
        const todayIds = todayOnly === 'true' ? [] : await fetchTodayWordIds(dueIds);
        recentlyWrongIdsRef.current = wrongIds;
        preSeededIdsRef.current = new Set(wrongIds);
        const s = createSession(wordsPool, wrongIds, todayIds);
        if (sortOrder === 'alphabetical') {
          s.mainDeck.sort((a, b) => a.word.word.toLowerCase().localeCompare(b.word.word.toLowerCase()));
        } else if (sortOrder === 'newest') {
          s.mainDeck.sort((a, b) => new Date(b.word.created_at).getTime() - new Date(a.word.created_at).getTime());
        }
        await insertSession(sessionIdRef.current, 'flashcard', tagId && tagId.length > 0 ? tagId : undefined);
        setSession(s);
        setCard(getNextCard(s));
      } else {
        const words = tagId && tagId.length > 0
          ? await fetchWordsByTag(tagId)
          : await fetchAllWords();
        if (sortOrder === 'alphabetical') {
          setDeck([...words].sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase())));
        } else if (sortOrder === 'newest') {
          setDeck([...words].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
        } else {
          setDeck([...words].sort(() => Math.random() - 0.5));
        }
      }
      setDeckLoaded(true);
    }
    loadDeck().catch(() => setDeckLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBack() {
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
      setPhase('question');
    }
  }

  const currentWord: WordRow | WordSRSRow | null =
    fcMode === 'self-rated' ? (card?.word ?? null) : (deck[currentIndex] ?? null);

  function recordAnswer(wordId: string, correct: boolean) {
    const prev = attemptCountRef.current.get(wordId) ?? 0;
    const attempt = prev + 1;
    attemptCountRef.current.set(wordId, attempt);
    insertSessionResult(sessionIdRef.current, wordId, correct, attempt).catch(() => {});
  }

  function handleReveal() {
    setPhase('revealed');
  }

  function navigateToSummary(currentScore: number, currentTotal: number) {
    closeSession(sessionIdRef.current).catch(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace({
      pathname: '/recall-summary' as any,
      params: {
        score: String(currentScore),
        total: String(currentTotal),
        tagId: tagId ?? '',
        mode: 'flashcard',
        fcMode,
        recentlyWrongIds: recentlyWrongIdsRef.current.join(','),
        clearedFromBuffer: clearedFromBufferRef.current.join(','),
        missedIds: missedIdsRef.current.join(','),
      },
    });
  }

  function handleNext() {
    if (currentIndex + 1 < deck.length) {
      setCurrentIndex(i => i + 1);
      setPhase('question');
    } else {
      navigateToSummary(score, total);
    }
  }

  function handleGotIt() {
    if (!card || !session) return;
    const { session: newSession, srsUpdate } = handleResponse(session, card, true);
    setSession(newSession);
    const nc = getNextCard(newSession);
    setNextCard(nc);
    const newScore = score + 1;
    const newTotal = total + 1;
    setScore(newScore);
    setTotal(newTotal);
    recordAnswer(card.word.id, true);
    if (
      card.inBuffer &&
      preSeededIdsRef.current.has(card.word.id) &&
      !newSession.buffer.some(c => c.word.id === card.word.id)
    ) {
      if (!clearedFromBufferRef.current.includes(card.word.id)) {
        clearedFromBufferRef.current.push(card.word.id);
      }
    }
    handleNextSelfRated(nc, { wordId: card.word.id, update: srsUpdate }, newScore, newTotal);
  }

  function handleMissedIt() {
    if (!card || !session) return;
    const { session: newSession, srsUpdate } = handleResponse(session, card, false);
    setSession(newSession);
    if (!missedIdsRef.current.includes(card.word.id)) {
      missedIdsRef.current.push(card.word.id);
    }
    recordAnswer(card.word.id, false);
    // Compute next card based on mainDeck without current card (missed → buffer),
    // so navigation decision is consistent regardless of mock vs real algorithm.
    const remainingMainDeck = session.mainDeck.filter(c => c !== card);
    const nc = remainingMainDeck.length > 0
      ? getNextCard({ ...newSession, mainDeck: remainingMainDeck })
      : null;
    setNextCard(nc);
    const newTotal = total + 1;
    setTotal(newTotal);
    handleNextSelfRated(nc, { wordId: card.word.id, update: srsUpdate }, score, newTotal);
  }

  function handleNextSelfRated(
    nc: CardState | null | undefined,
    pending: { wordId: string; update: SRSUpdate },
    currentScore: number,
    currentTotal: number,
  ) {
    updateWordFCSRS(pending.wordId, pending.update.interval, pending.update.easeFactor, pending.update.nextReviewAt, pending.update.wrongCount, pending.update.consecutiveCorrect).catch(() => {});
    if (nc == null) {
      navigateToSummary(currentScore, currentTotal);
    } else {
      setCard(nc);
      setNextCard(undefined);
      setPhase('question');
    }
  }

  if (!deckLoaded) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  const isEmpty = fcMode === 'self-rated' ? card === null : deck.length === 0;
  if (isEmpty) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No words to review</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isLastCard =
    fcMode === 'self-rated' ? nextCard === null : currentIndex + 1 >= deck.length;

  const progressText =
    fcMode === 'self-rated' && session
      ? `${session.mainDeck.length} left · ${session.buffer.length} to retry`
      : `${currentIndex + 1} / ${deck.length}`;

  return (
    <View style={styles.screen} {...panResponder.panHandlers}>
      <ScrollView
        scrollEnabled={fcMode !== 'passive' || phase === 'revealed'}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.progress}>{progressText}</Text>

        <Text style={styles.wordText}>{currentWord!.word}</Text>

        {fcMode === 'self-rated' && card && card.wrongCount > 0 && (
          <Text style={[
            styles.difficultyBadge,
            card.wrongCount >= 6 ? styles.badgeRed :
            card.wrongCount >= 3 ? styles.badgeOrange :
            styles.badgeAmber,
          ]}>
            Struggled {card.wrongCount}×
          </Text>
        )}

        {phase === 'revealed' && (
          <View style={styles.revealedSection}>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Definition</Text>
              <TextWithLinks text={currentWord!.definition} style={styles.infoText} />
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Example</Text>
              <TextWithLinks text={currentWord!.example_sentence} style={styles.infoText} italic />
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.actionFooter, { paddingBottom: insets.bottom + 24 }]}>
        {fcMode === 'passive' ? (
          <View style={styles.passiveRow}>
            {currentIndex > 0 && (
              <TouchableOpacity
                style={[styles.navButton, styles.backButtonInline]}
                onPress={handleBack}
                testID="prev-button"
              >
                <Text style={styles.backButtonInlineText}>← Back</Text>
              </TouchableOpacity>
            )}

            {phase === 'question' ? (
              <>
                <TouchableOpacity
                  style={[styles.navButton, styles.revealButtonInline]}
                  onPress={handleReveal}
                  testID="reveal-button"
                >
                  <Text style={styles.revealButtonInlineText}>Reveal Answer</Text>
                </TouchableOpacity>
                {currentIndex + 1 < deck.length && (
                  <TouchableOpacity
                    style={[styles.navButton, styles.skipButtonInline]}
                    onPress={handleNext}
                    testID="skip-button"
                  >
                    <Text style={styles.skipButtonInlineText}>Skip →</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <TouchableOpacity
                style={[styles.navButton, styles.nextButtonInline]}
                onPress={handleNext}
                testID="next-button"
              >
                <Text style={styles.nextButtonInlineText}>
                  {isLastCard ? 'Next — See Results' : 'Next Word →'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : phase === 'question' ? (
          <TouchableOpacity style={styles.revealButton} onPress={handleReveal} testID="reveal-button">
            <Text style={styles.revealButtonText}>Reveal Answer</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.ratingRow}>
            <TouchableOpacity style={styles.missedButton} onPress={handleMissedIt} testID="missed-it-button">
              <Text style={styles.missedButtonText}>Missed it ✗</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.gotItButton} onPress={handleGotIt} testID="got-it-button">
              <Text style={styles.gotItButtonText}>Got it ✓</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 24, paddingBottom: 24, backgroundColor: '#fff', flexGrow: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 24 },
  progress: { fontSize: 13, color: '#9CA3AF', textAlign: 'right', marginBottom: 24 },
  wordText: { fontSize: 36, fontWeight: 'bold', color: '#111827', marginBottom: 40, textAlign: 'center' },
  revealButton: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  revealButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  revealedSection: { gap: 16 },
  infoBlock: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 16, gap: 4 },
  infoLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoText: { fontSize: 15, color: '#111827', lineHeight: 22 },
  actionFooter: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 24,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  nextButton: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  nextButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  ratingRow: { flexDirection: 'row', gap: 12 },
  missedButton: { flex: 1, backgroundColor: '#FEE2E2', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  missedButtonText: { fontSize: 17, fontWeight: '700', color: '#EF4444' },
  gotItButton: { flex: 1, backgroundColor: '#DCFCE7', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  gotItButtonText: { fontSize: 17, fontWeight: '700', color: '#22C55E' },
  emptyText: { fontSize: 18, color: '#6B7280', marginBottom: 24, textAlign: 'center' },
  backButton: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32 },
  backButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  difficultyBadge: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 4, marginBottom: 8 },
  badgeAmber: { color: '#D97706' },
  badgeOrange: { color: '#EA580C' },
  badgeRed: { color: '#DC2626' },
  passiveRow: { flexDirection: 'row', gap: 10, width: '100%' },
  navButton: { borderRadius: 12, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  backButtonInline: { flex: 1, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  backButtonInlineText: { fontSize: 15, fontWeight: '600', color: '#4B5563' },
  revealButtonInline: { flex: 2, backgroundColor: '#3B82F6' },
  revealButtonInlineText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  skipButtonInline: { flex: 1, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  skipButtonInlineText: { fontSize: 15, fontWeight: '600', color: '#4B5563' },
  nextButtonInline: { flex: 2, backgroundColor: '#10B981' },
  nextButtonInlineText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
