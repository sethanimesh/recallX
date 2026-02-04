import { useState, useEffect } from 'react';
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
import { gradeAnswer, type GradeResult } from '@/src/api/gradeClient';
import { useVoiceInput } from '@/src/audio/useVoiceInput';
import { VoiceInputButton } from '@/src/components/VoiceInputButton';

type Phase = 'input' | 'result';

export default function RecallScreen() {
  const router = useRouter();
  const { tagId } = useLocalSearchParams<{ tagId: string }>();

  const [deck, setDeck] = useState<WordRow[]>([]);
  const [deckLoaded, setDeckLoaded] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('input');
  const [userAnswer, setUserAnswer] = useState('');
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);

  const voiceInput = useVoiceInput();

  // Load deck on mount
  useEffect(() => {
    async function loadDeck() {
      const words =
        tagId && tagId.length > 0
          ? await fetchWordsByTag(tagId)
          : await fetchAllWords();
      const shuffled = [...words].sort(() => Math.random() - 0.5);
      setDeck(shuffled);
      setDeckLoaded(true);
    }
    loadDeck().catch(() => setDeckLoaded(true));
  }, [tagId]);

  useEffect(() => {
    if (voiceInput.state === 'done' && voiceInput.transcript) {
      setUserAnswer(voiceInput.transcript);
      handleSubmit(voiceInput.transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceInput.state]);

  const currentWord = deck[currentIndex];

  async function handleSubmit(answerOverride?: string) {
    const answer = answerOverride ?? userAnswer;
    if (!currentWord || loading || !answer.trim()) return;
    setLoading(true);
    try {
      const result = await gradeAnswer(currentWord.word, answer, currentWord.definition);
      setGradeResult(result);
      setTotal((t) => t + 1);
      if (result.correct) setScore((s) => s + 1);
      setPhase('result');
    } catch {
      Alert.alert('Error', 'Could not reach server. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleNext() {
    voiceInput.reset();
    if (currentIndex + 1 < deck.length) {
      setCurrentIndex((i) => i + 1);
      setPhase('input');
      setUserAnswer('');
      setGradeResult(null);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace({ pathname: '/recall-summary' as any, params: { score: String(score), total: String(total), tagId: tagId ?? '' } });
    }
  }

  // Loading state
  if (!deckLoaded) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  // Empty deck state
  if (deck.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No words to review</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isLastCard = currentIndex + 1 >= deck.length;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Progress */}
      <Text style={styles.progress}>
        {currentIndex + 1} / {deck.length}
      </Text>

      {/* Score */}
      <Text style={styles.scoreText}>
        Score: {score} / {total}
      </Text>

      {/* Word */}
      <Text style={styles.wordText} testID="word-display">
        {currentWord.word}
      </Text>

      {phase === 'input' && (
        <View style={styles.inputSection}>
          <TextInput
            style={styles.textInput}
            placeholder="Type the meaning…"
            value={userAnswer}
            onChangeText={(text) => {
              setUserAnswer(text);
              if (voiceInput.state === 'done') voiceInput.reset();
            }}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => handleSubmit()}
            editable={
              !loading &&
              (voiceInput.state === 'idle' ||
                voiceInput.state === 'done' ||
                voiceInput.state === 'error')
            }
            testID="answer-input"
          />
          {loading && (
            <ActivityIndicator
              style={styles.spinner}
              size="small"
              color="#3B82F6"
              testID="loading-indicator"
            />
          )}
          <VoiceInputButton state={voiceInput.state} onPress={voiceInput.start} />
          {voiceInput.state === 'listening' && (
            <Text style={styles.voiceLabel}>Listening…</Text>
          )}
          {voiceInput.state === 'speech_detected' && (
            <Text style={styles.voiceLabel}>Got it, keep going…</Text>
          )}
          {voiceInput.state === 'error' && (
            <View style={styles.voiceErrorRow}>
              <Text style={styles.voiceError}>Couldn&apos;t understand, try again</Text>
              <TouchableOpacity onPress={voiceInput.start} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity
            style={[
              styles.submitButton,
              (loading ||
                voiceInput.state === 'initializing' ||
                voiceInput.state === 'listening' ||
                voiceInput.state === 'speech_detected') &&
                styles.submitButtonDisabled,
            ]}
            onPress={() => handleSubmit()}
            disabled={
              loading ||
              voiceInput.state === 'initializing' ||
              voiceInput.state === 'listening' ||
              voiceInput.state === 'speech_detected'
            }
            testID="submit-button"
          >
            <Text style={styles.submitButtonText}>Submit</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'result' && gradeResult && (
        <View style={styles.resultSection}>
          {/* Banner */}
          <View
            style={[
              styles.banner,
              gradeResult.correct ? styles.bannerCorrect : styles.bannerIncorrect,
            ]}
            testID="result-banner"
          >
            <Text
              style={[
                styles.bannerText,
                gradeResult.correct ? styles.bannerTextCorrect : styles.bannerTextIncorrect,
              ]}
            >
              {gradeResult.correct ? 'Correct ✓' : 'Incorrect ✗'}
            </Text>
          </View>

          {/* Feedback */}
          <Text style={styles.feedbackText} testID="feedback-text">
            {gradeResult.feedback}
          </Text>

          {/* Definition */}
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Definition:</Text>
            <Text style={styles.infoText}>{currentWord.definition}</Text>
          </View>

          {/* Example */}
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Example:</Text>
            <Text style={styles.infoText}>{currentWord.example_sentence}</Text>
          </View>

          {/* Next / Results button */}
          <TouchableOpacity
            style={styles.nextButton}
            onPress={handleNext}
            testID="next-button"
          >
            <Text style={styles.nextButtonText}>
              {isLastCard ? 'See Results' : 'Next Word →'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    backgroundColor: '#fff',
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 24,
  },
  progress: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'right',
    marginBottom: 4,
  },
  scoreText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    marginBottom: 24,
  },
  wordText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 32,
    textAlign: 'center',
  },
  inputSection: {
    gap: 16,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  spinner: {
    alignSelf: 'center',
  },
  submitButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  resultSection: {
    gap: 16,
  },
  banner: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  bannerCorrect: {
    backgroundColor: '#DCFCE7',
  },
  bannerIncorrect: {
    backgroundColor: '#FEE2E2',
  },
  bannerText: {
    fontSize: 20,
    fontWeight: '700',
  },
  bannerTextCorrect: {
    color: '#22c55e',
  },
  bannerTextIncorrect: {
    color: '#ef4444',
  },
  feedbackText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  infoBlock: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoText: {
    fontSize: 15,
    color: '#111827',
    lineHeight: 22,
  },
  nextButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  nextButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  emptyText: {
    fontSize: 18,
    color: '#6B7280',
    marginBottom: 24,
    textAlign: 'center',
  },
  backButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  voiceLabel: {
    fontSize: 13,
    color: '#3B82F6',
    textAlign: 'center',
  },
  voiceErrorRow: {
    alignItems: 'center',
    gap: 8,
  },
  voiceError: {
    fontSize: 13,
    color: '#ef4444',
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ef4444',
  },
});
