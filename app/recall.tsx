import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { fetchAllWords, fetchWordsByTag, type WordRow } from '@/src/db/operations/tags';
import { fetchDueWords, updateWordSRS, type WordSRSRow } from '@/src/db/operations/srs';
import { gradeAnswer, type GradeResult } from '@/src/api/gradeClient';
import {
  insertSession,
  closeSession,
  insertSessionResult,
  fetchRecentlyWrongIds,
  fetchTodayWordIds,
  fetchWordsCreatedTodayForRecall,
} from '@/src/db/operations/sessionHistory';
import { useVoiceInput } from '@/src/audio/useVoiceInput';
import { VoiceInputButton } from '@/src/components/VoiceInputButton';
import {
  createSession,
  getNextCard,
  handleResponse,
  type Session,
  type CardState,
  type SRSUpdate,
} from '@/src/screens/srsAlgorithm';

type Phase = 'input' | 'result';
type Mode = 'adaptive' | 'classic';

export default function RecallScreen() {
  const router = useRouter();
  const { tagId, mode: modeParam, todayOnly } = useLocalSearchParams<{ tagId: string; mode: string; todayOnly: string }>();
  const mode: Mode = modeParam === 'classic' ? 'classic' : 'adaptive';

  // Classic mode
  const [deck, setDeck] = useState<WordRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Adaptive mode
  const [adaptiveSession, setAdaptiveSession] = useState<Session | null>(null);
  const [adaptiveCard, setAdaptiveCard] = useState<CardState | null>(null);
  const [adaptiveNextCard, setAdaptiveNextCard] = useState<CardState | null | undefined>(undefined);
  const pendingSRSUpdate = useRef<{ wordId: string; update: SRSUpdate } | null>(null);
  const missedIdsRef = useRef<string[]>([]);
  const sessionIdRef = useRef<string>(Date.now().toString(36) + Math.random().toString(36).slice(2));
  const attemptCountRef = useRef<Map<string, number>>(new Map());
  const preSeededIdsRef = useRef<Set<string>>(new Set());
  const clearedFromBufferRef = useRef<string[]>([]);
  const recentlyWrongIdsRef = useRef<string[]>([]);

  // Shared
  const [deckLoaded, setDeckLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>('input');
  const [userAnswer, setUserAnswer] = useState('');
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  const voiceInput = useVoiceInput();

  useEffect(() => {
    async function loadDeck() {
      if (mode === 'adaptive') {
        const wordsPool = todayOnly === 'true'
          ? await fetchWordsCreatedTodayForRecall(tagId && tagId.length > 0 ? tagId : undefined)
          : tagId && tagId.length > 0
            ? await fetchDueWords(tagId)
            : await fetchDueWords();
        const dueIds = wordsPool.map(w => w.id);
        const wrongIds = await fetchRecentlyWrongIds('recall', dueIds);
        const todayIds = todayOnly === 'true' ? [] : await fetchTodayWordIds(dueIds);
        recentlyWrongIdsRef.current = wrongIds;
        preSeededIdsRef.current = new Set(wrongIds);
        const session = createSession(wordsPool, wrongIds, todayIds);
        await insertSession(sessionIdRef.current, 'recall', tagId && tagId.length > 0 ? tagId : undefined);
        setAdaptiveSession(session);
        setAdaptiveCard(getNextCard(session));
      } else {
        const words = tagId && tagId.length > 0
          ? await fetchWordsByTag(tagId)
          : await fetchAllWords();
        setDeck([...words].sort(() => Math.random() - 0.5));
      }
      setDeckLoaded(true);
    }
    loadDeck().catch(() => setDeckLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (voiceInput.state === 'done' && voiceInput.transcript) {
      setUserAnswer(voiceInput.transcript);
      handleSubmit(voiceInput.transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceInput.state]);

  useEffect(() => {
    if (phase !== 'result' || !gradeResult?.correct) {
      setCountdown(null);
      return;
    }
    let count = 10;
    let cancelled = false;
    setCountdown(count);
    const id = setInterval(() => {
      if (cancelled) return;
      count -= 1;
      if (count <= 0) { clearInterval(id); setCountdown(null); handleNext(); }
      else setCountdown(count);
    }, 1000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, gradeResult?.correct]);

  const currentWord: WordRow | WordSRSRow | null =
    mode === 'adaptive' ? (adaptiveCard?.word ?? null) : (deck[currentIndex] ?? null);

  function recordAnswer(wordId: string, correct: boolean) {
    const prev = attemptCountRef.current.get(wordId) ?? 0;
    const attempt = prev + 1;
    attemptCountRef.current.set(wordId, attempt);
    insertSessionResult(sessionIdRef.current, wordId, correct, attempt).catch(() => {});
  }

  async function handleSubmit(answerOverride?: string) {
    const answer = answerOverride ?? userAnswer;
    if (!currentWord || loading) return;
    setLoading(true);
    try {
      const result = await gradeAnswer(currentWord.word, answer, currentWord.definition);
      setGradeResult(result);
      setTotal(t => t + 1);
      if (result.correct) setScore(s => s + 1);

      if (mode === 'adaptive' && adaptiveCard && adaptiveSession) {
        const { session: newSession, srsUpdate } = handleResponse(adaptiveSession, adaptiveCard, result.correct);
        setAdaptiveSession(newSession);
        pendingSRSUpdate.current = { wordId: adaptiveCard.word.id, update: srsUpdate };
        recordAnswer(adaptiveCard.word.id, result.correct);
        if (!result.correct && !missedIdsRef.current.includes(adaptiveCard.word.id)) {
          missedIdsRef.current.push(adaptiveCard.word.id);
        }
        if (
          adaptiveCard.inBuffer &&
          preSeededIdsRef.current.has(adaptiveCard.word.id) &&
          !newSession.buffer.some(c => c.word.id === adaptiveCard.word.id)
        ) {
          if (!clearedFromBufferRef.current.includes(adaptiveCard.word.id)) {
            clearedFromBufferRef.current.push(adaptiveCard.word.id);
          }
        }
        setAdaptiveNextCard(getNextCard(newSession));
      }

      setPhase('result');
    } catch {
      Alert.alert('Error', 'Could not reach server. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleNext() {
    voiceInput.reset();

    if (mode === 'adaptive') {
      if (pendingSRSUpdate.current) {
        const { wordId, update } = pendingSRSUpdate.current;
        updateWordSRS(wordId, update.interval, update.easeFactor, update.nextReviewAt, update.wrongCount, update.consecutiveCorrect).catch(() => {});
        pendingSRSUpdate.current = null;
      }
      if (adaptiveNextCard == null) {
        navigateToSummary(score, total);
      } else {
        setAdaptiveCard(adaptiveNextCard);
        setAdaptiveNextCard(undefined);
        setPhase('input');
        setUserAnswer('');
        setGradeResult(null);
      }
    } else {
      if (currentIndex + 1 < deck.length) {
        setCurrentIndex(i => i + 1);
        setPhase('input');
        setUserAnswer('');
        setGradeResult(null);
      } else {
        navigateToSummary(score, total);
      }
    }
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
        mode,
        recentlyWrongIds: recentlyWrongIdsRef.current.join(','),
        clearedFromBuffer: clearedFromBufferRef.current.join(','),
        missedIds: missedIdsRef.current.join(','),
      },
    });
  }

  if (!deckLoaded) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  const isEmpty = mode === 'adaptive' ? adaptiveCard === null : deck.length === 0;
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
    mode === 'adaptive' ? adaptiveNextCard === null : currentIndex + 1 >= deck.length;

  const progressText =
    mode === 'adaptive' && adaptiveSession
      ? `${adaptiveSession.mainDeck.length} left · ${adaptiveSession.buffer.length} to retry`
      : `${currentIndex + 1} / ${deck.length}`;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.progress}>{progressText}</Text>
      <Text style={styles.scoreText}>Score: {score} / {total}</Text>

      <Text style={styles.wordText} testID="word-display">{currentWord!.word}</Text>

      {adaptiveCard && adaptiveCard.wrongCount > 0 && (
        <Text style={[
          styles.difficultyBadge,
          adaptiveCard.wrongCount >= 6 ? styles.badgeRed :
          adaptiveCard.wrongCount >= 3 ? styles.badgeOrange :
          styles.badgeAmber,
        ]}>
          Struggled {adaptiveCard.wrongCount}×
        </Text>
      )}

      {phase === 'input' && (
        <View style={styles.inputSection}>
          <TextInput
            style={styles.textInput}
            placeholder="Type the meaning…"
            value={userAnswer}
            onChangeText={text => {
              setUserAnswer(text);
              if (voiceInput.state === 'done') voiceInput.reset();
            }}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => handleSubmit()}
            editable={
              !loading &&
              (voiceInput.state === 'idle' || voiceInput.state === 'done' || voiceInput.state === 'error')
            }
            testID="answer-input"
          />
          {loading && <ActivityIndicator style={styles.spinner} size="small" color="#3B82F6" testID="loading-indicator" />}
          <VoiceInputButton state={voiceInput.state} onPress={voiceInput.start} />
          {voiceInput.state === 'listening' && <Text style={styles.voiceLabel}>Listening…</Text>}
          {voiceInput.state === 'speech_detected' && <Text style={styles.voiceLabel}>Got it, keep going…</Text>}
          {voiceInput.state === 'error' && (
            <View style={styles.voiceErrorRow}>
              <Text style={styles.voiceError}>Couldn't understand, try again</Text>
              <TouchableOpacity onPress={voiceInput.start} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity
            style={[
              styles.submitButton,
              (loading || voiceInput.state === 'connecting' || voiceInput.state === 'transcribing' ||
                voiceInput.state === 'listening' || voiceInput.state === 'speech_detected') &&
                styles.submitButtonDisabled,
            ]}
            onPress={() => handleSubmit()}
            disabled={
              loading || voiceInput.state === 'connecting' || voiceInput.state === 'transcribing' ||
              voiceInput.state === 'listening' || voiceInput.state === 'speech_detected'
            }
            testID="submit-button"
          >
            <Text style={styles.submitButtonText}>Submit</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'result' && gradeResult && (
        <View style={styles.resultSection}>
          <View
            style={[styles.banner, gradeResult.correct ? styles.bannerCorrect : styles.bannerIncorrect]}
            testID="result-banner"
          >
            <Text style={[styles.bannerText, gradeResult.correct ? styles.bannerTextCorrect : styles.bannerTextIncorrect]}>
              {gradeResult.correct ? 'Correct ✓' : 'Incorrect ✗'}
            </Text>
          </View>
          <Text style={styles.feedbackText} testID="feedback-text">{gradeResult.feedback}</Text>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Definition:</Text>
            <Text style={styles.infoText}>{currentWord!.definition}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Example:</Text>
            <Text style={styles.infoText}>{currentWord!.example_sentence}</Text>
          </View>
          <TouchableOpacity
            style={styles.nextButton}
            onPress={() => { setCountdown(null); handleNext(); }}
            testID="next-button"
          >
            <Text style={styles.nextButtonText}>
              {isLastCard ? 'See Results' : countdown !== null ? `Next in ${countdown}s` : 'Next Word →'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#fff', flexGrow: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 24 },
  progress: { fontSize: 13, color: '#9CA3AF', textAlign: 'right', marginBottom: 4 },
  scoreText: { fontSize: 13, color: '#6B7280', textAlign: 'right', marginBottom: 24 },
  wordText: { fontSize: 32, fontWeight: 'bold', color: '#111827', marginBottom: 32, textAlign: 'center' },
  inputSection: { gap: 16 },
  textInput: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: '#111827', backgroundColor: '#F9FAFB',
  },
  spinner: { alignSelf: 'center' },
  submitButton: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#E5E7EB' },
  submitButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  resultSection: { gap: 16 },
  banner: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  bannerCorrect: { backgroundColor: '#DCFCE7' },
  bannerIncorrect: { backgroundColor: '#FEE2E2' },
  bannerText: { fontSize: 20, fontWeight: '700' },
  bannerTextCorrect: { color: '#22c55e' },
  bannerTextIncorrect: { color: '#ef4444' },
  feedbackText: { fontSize: 14, color: '#6B7280', textAlign: 'center' },
  infoBlock: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 16, gap: 4 },
  infoLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoText: { fontSize: 15, color: '#111827', lineHeight: 22 },
  nextButton: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  nextButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  emptyText: { fontSize: 18, color: '#6B7280', marginBottom: 24, textAlign: 'center' },
  backButton: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32 },
  backButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  voiceLabel: { fontSize: 13, color: '#3B82F6', textAlign: 'center' },
  voiceErrorRow: { alignItems: 'center', gap: 8 },
  voiceError: { fontSize: 13, color: '#ef4444', textAlign: 'center' },
  retryButton: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#FEE2E2', borderRadius: 8 },
  retryButtonText: { fontSize: 13, fontWeight: '600', color: '#ef4444' },
  difficultyBadge: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 4, marginBottom: 8 },
  badgeAmber: { color: '#D97706' },
  badgeOrange: { color: '#EA580C' },
  badgeRed: { color: '#DC2626' },
});
