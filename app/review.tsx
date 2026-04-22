import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { takePendingExtraction } from '@/src/store/pendingWords';
import { insertExtraction } from '@/src/db/operations/insertExtraction';
import { addTagToWord, type Tag } from '@/src/db/operations/tags';
import { buildReviewResult } from '@/src/screens/reviewLogic';
import TagPickerSheet from '@/src/components/TagPickerSheet';
import type { ExtractedWord } from '@/src/api/types';

export default function ReviewScreen() {
  const [words, setWords] = useState<ExtractedWord[]>([]);
  const [sourceUri, setSourceUri] = useState('');
  const [sourceType, setSourceType] = useState<'image' | 'pdf'>('image');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<boolean[]>([]);
  const [tagsByIndex, setTagsByIndex] = useState<Map<number, Tag[]>>(new Map());
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [initialTagId, setInitialTagId] = useState<string | null>(null);

  useEffect(() => {
    const pending = takePendingExtraction();
    if (!pending || pending.words.length === 0) {
      router.replace('/(tabs)');
      return;
    }
    setWords(pending.words);
    setSourceUri(pending.sourceUri);
    setSourceType(pending.sourceType);
    setDecisions(new Array(pending.words.length).fill(false));
    if (pending.defaultTags && pending.defaultTags.length > 0) {
      setTagsByIndex(new Map(pending.words.map((_, index) => [index, pending.defaultTags!])));
      setInitialTagId(pending.defaultTags[0].id);
    }
    setInitialized(true);
  }, []);

  const currentCardTags = tagsByIndex.get(currentIndex) ?? [];

  const handleTagsChanged = useCallback((tags: Tag[]) => {
    setTagsByIndex((prev) => {
      const next = new Map(prev);
      next.set(currentIndex, tags);
      return next;
    });
  }, [currentIndex]);

  const finishReview = useCallback(
    async (finalDecisions: boolean[], wordList: ExtractedWord[], uri: string, type: 'image' | 'pdf', tags: Map<number, Tag[]>) => {
      const accepted = buildReviewResult(wordList, finalDecisions);
      if (accepted.length === 0) {
        if (initialTagId) {
          router.replace({ pathname: '/(tabs)', params: { tagId: initialTagId } });
        } else {
          router.replace('/(tabs)');
        }
        return;
      }
      setSaving(true);
      try {
        // accepted word indices relative to the original wordList
        const acceptedOriginalIndices = wordList
          .map((_, i) => i)
          .filter((i) => finalDecisions[i]);

        const { insertedIds, duplicates } = await insertExtraction(uri, type, accepted);

        if (duplicates.length > 0) {
          Alert.alert(
            'Already in your library',
            duplicates.join(', '),
          );
        }

        // Filter out indices for words that were skipped as duplicates so the
        // list aligns 1-to-1 with insertedIds.
        const acceptedAndInsertedOriginalIndices = acceptedOriginalIndices.filter(
          (_, j) => !duplicates.includes(accepted[j].word),
        );

        // Apply per-word tags: accepted[j] corresponds to insertedIds[j] and acceptedAndInsertedOriginalIndices[j]
        const tagOps: Promise<void>[] = [];
        insertedIds.forEach((wordId, j) => {
          const originalIndex = acceptedAndInsertedOriginalIndices[j];
          const wordTags = tags.get(originalIndex) ?? [];
          wordTags.forEach((tag) => tagOps.push(addTagToWord(wordId, tag.id)));
        });
        await Promise.all(tagOps);

        if (initialTagId) {
          router.replace({ pathname: '/(tabs)', params: { tagId: initialTagId } });
        } else {
          router.replace('/(tabs)');
        }
      } catch (err) {
        setSaving(false);
        const message = err instanceof Error ? err.message : String(err);
        Alert.alert(
          'Save Failed',
          `Could not save words: ${message}`,
          [
            {
              text: 'Retry',
              onPress: () => finishReview(finalDecisions, wordList, uri, type, tags),
            },
            {
              text: 'Skip to Library',
              style: 'cancel',
              onPress: () => {
                if (initialTagId) {
                  router.replace({ pathname: '/(tabs)', params: { tagId: initialTagId } });
                } else {
                  router.replace('/(tabs)');
                }
              },
            },
          ],
        );
      }
    },
    [setSaving, initialTagId],
  );

  const handleDecision = useCallback(
    (accept: boolean) => {
      if (saving) return;
      const newDecisions = [...decisions];
      newDecisions[currentIndex] = accept;

      const isLast = currentIndex === words.length - 1;
      if (isLast) {
        finishReview(newDecisions, words, sourceUri, sourceType, tagsByIndex);
      } else {
        setDecisions(newDecisions);
        setCurrentIndex((prev) => prev + 1);
      }
    },
    [saving, decisions, currentIndex, words, sourceUri, sourceType, tagsByIndex, finishReview],
  );

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

        <View style={styles.tagSection}>
          <View style={styles.tagSectionHeader}>
            <View>
              <Text style={styles.tagLabel}>Tags</Text>
              <Text style={styles.tagSubtext}>
                {currentCardTags.length === 0 ? 'Add tags before saving this word' : 'Selected for this review card'}
              </Text>
            </View>
            <TouchableOpacity
              testID="review-tag-trigger"
              style={[styles.tagActionButton, currentCardTags.length > 0 && styles.tagActionButtonActive]}
              onPress={() => setTagPickerVisible(true)}
            >
              <Ionicons
                name={currentCardTags.length === 0 ? 'add' : 'create-outline'}
                size={15}
                color={currentCardTags.length === 0 ? '#2563EB' : '#1D4ED8'}
              />
              <Text style={[styles.tagActionText, currentCardTags.length > 0 && styles.tagActionTextActive]}>
                {currentCardTags.length === 0 ? 'Add tags' : 'Edit tags'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tagRow}>
            {currentCardTags.map((tag) => (
              <View key={tag.id} style={styles.chip}>
                <Text style={styles.chipText}>{tag.name}</Text>
              </View>
            ))}
          </View>
          {currentCardTags.length === 0 && (
            <View style={styles.emptyTagState}>
              <Ionicons name="pricetag-outline" size={16} color="#9CA3AF" />
              <Text style={styles.emptyTagStateText}>No tags yet</Text>
            </View>
          )}
        </View>
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

      <TagPickerSheet
        currentTags={currentCardTags}
        visible={tagPickerVisible}
        onClose={() => setTagPickerVisible(false)}
        onTagsChanged={handleTagsChanged}
      />
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
    marginBottom: 16,
  },
  tagSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F3F4F6',
    paddingTop: 12,
  },
  tagSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  tagLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  tagSubtext: {
    marginTop: 3,
    fontSize: 13,
    color: '#6B7280',
  },
  tagActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#93C5FD',
    backgroundColor: '#F8FAFC',
  },
  tagActionButtonActive: {
    borderStyle: 'solid',
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  tagActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },
  tagActionTextActive: {
    color: '#1D4ED8',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  chip: {
    backgroundColor: '#EFF6FF',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  chipText: {
    fontSize: 13,
    color: '#1D4ED8',
    fontWeight: '600',
  },
  emptyTagState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
  },
  emptyTagStateText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontStyle: 'italic',
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
