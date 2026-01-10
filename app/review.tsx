import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { takePendingExtraction } from '@/src/store/pendingWords';
import { insertExtraction } from '@/src/db/operations/insertExtraction';
import { buildReviewResult } from '@/src/screens/reviewLogic';
import type { ExtractedWord } from '@/src/api/types';

export default function ReviewScreen() {
  const [words, setWords] = useState<ExtractedWord[]>([]);
  const [sourceUri, setSourceUri] = useState('');
  const [sourceType, setSourceType] = useState<'image' | 'pdf'>('image');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<boolean[]>([]);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const pending = takePendingExtraction();
    if (!pending || pending.words.length === 0) {
      // Nothing to review — go straight to Library
      router.replace('/(tabs)');
      return;
    }
    setWords(pending.words);
    setSourceUri(pending.sourceUri);
    setSourceType(pending.sourceType);
    // All entries are explicitly set before finishReview is called; the initial
    // false values are never used as final decisions.
    setDecisions(new Array(pending.words.length).fill(false));
    setInitialized(true);
  }, []);

  const finishReview = useCallback(
    async (finalDecisions: boolean[], wordList: ExtractedWord[], uri: string, type: 'image' | 'pdf') => {
      const accepted = buildReviewResult(wordList, finalDecisions);
      if (accepted.length === 0) {
        router.replace('/(tabs)');
        return;
      }
      setSaving(true);
      try {
        await insertExtraction(uri, type, accepted);
        router.replace('/(tabs)');
      } catch (err) {
        setSaving(false);
        const message = err instanceof Error ? err.message : String(err);
        Alert.alert(
          'Save Failed',
          `Could not save words: ${message}`,
          [
            {
              text: 'Retry',
              onPress: () => finishReview(finalDecisions, wordList, uri, type),
            },
            {
              text: 'Skip to Library',
              style: 'cancel',
              onPress: () => router.replace('/(tabs)'),
            },
          ],
        );
      }
    },
    [setSaving], // setSaving is stable; buildReviewResult + insertExtraction are module imports
  );

  const handleDecision = useCallback(
    (accept: boolean) => {
      if (saving) return;
      const newDecisions = [...decisions];
      newDecisions[currentIndex] = accept;

      const isLast = currentIndex === words.length - 1;
      if (isLast) {
        finishReview(newDecisions, words, sourceUri, sourceType);
      } else {
        setDecisions(newDecisions);
        setCurrentIndex((prev) => prev + 1);
      }
    },
    [saving, decisions, currentIndex, words, sourceUri, sourceType, finishReview],
  );

  // Not yet initialized (pending extraction not consumed yet)
  if (!initialized) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </SafeAreaView>
    );
  }

  const currentWord = words[currentIndex];
  const progressLabel = `${currentIndex + 1} of ${words.length}`;

  if (saving) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Review Extracted Words</Text>
        <View style={styles.savingContainer}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={styles.savingText}>Saving words…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Review Extracted Words</Text>
      <Text style={styles.progress}>{progressLabel}</Text>

      <View style={styles.card}>
        <Text style={styles.word}>{currentWord.word}</Text>
        <Text style={styles.definition}>{currentWord.definition}</Text>
        <Text style={styles.example}>&ldquo;{currentWord.example_sentence}&rdquo;</Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.rejectButton]}
          onPress={() => handleDecision(false)}
          accessibilityLabel="Reject word"
        >
          <Ionicons name="close" size={22} color="#fff" />
          <Text style={styles.buttonText}>Reject</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.acceptButton]}
          onPress={() => handleDecision(true)}
          accessibilityLabel="Accept word"
        >
          <Ionicons name="checkmark" size={22} color="#fff" />
          <Text style={styles.buttonText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  progress: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 28,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    marginBottom: 36,
  },
  word: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
  },
  definition: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
    marginBottom: 12,
  },
  example: {
    fontSize: 15,
    color: '#6B7280',
    fontStyle: 'italic',
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 16,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  rejectButton: {
    backgroundColor: '#EF4444',
  },
  acceptButton: {
    backgroundColor: '#10B981',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  savingContainer: {
    alignItems: 'center',
    gap: 16,
  },
  savingText: {
    fontSize: 16,
    color: '#6B7280',
  },
});
