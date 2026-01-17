import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ListRenderItemInfo,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllTags, fetchAllWords, fetchWordsByTag, type Tag } from '@/src/db/operations/tags';

type DeckOption = { id: string | null; name: string };

export default function RecallSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);

  // Load tags on focus
  useFocusEffect(
    useCallback(() => {
      getAllTags().then(setTags);
    }, [])
  );

  // Recompute word count when selectedTagId changes
  useEffect(() => {
    let cancelled = false;

    async function computeCount() {
      if (selectedTagId === null) {
        const rows = await fetchAllWords();
        if (!cancelled) setWordCount(rows.length);
      } else {
        const rows = await fetchWordsByTag(selectedTagId);
        if (!cancelled) setWordCount(rows.length);
      }
    }

    computeCount().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedTagId]);

  const handleStart = useCallback(() => {
    // '/recall' will be created in a future phase; cast to any to satisfy typed routes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push({ pathname: '/recall' as any, params: { tagId: selectedTagId ?? '' } });
  }, [router, selectedTagId]);

  const deckOptions: DeckOption[] = [{ id: null, name: 'All Words' }, ...tags];

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<DeckOption>) => {
      const isSelected = item.id === selectedTagId;
      return (
        <TouchableOpacity
          style={[styles.row, isSelected && styles.rowSelected]}
          onPress={() => setSelectedTagId(item.id)}
          accessibilityRole="radio"
          accessibilityState={{ selected: isSelected }}
        >
          <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>
            {item.name}
          </Text>
        </TouchableOpacity>
      );
    },
    [selectedTagId],
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <Text style={styles.heading}>Choose a deck</Text>

      <FlatList
        data={deckOptions}
        keyExtractor={(item) => item.id ?? '__all__'}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        style={styles.list}
        contentContainerStyle={styles.listContent}
      />

      <Text style={styles.wordCount} testID="word-count-label">
        {wordCount} {wordCount === 1 ? 'word' : 'words'}
      </Text>

      {wordCount === 0 && (
        <Text style={styles.noWordsLabel} testID="no-words-label">
          No words to review
        </Text>
      )}

      <TouchableOpacity
        style={[styles.startButton, wordCount === 0 && styles.startButtonDisabled]}
        onPress={handleStart}
        disabled={wordCount === 0}
        accessibilityRole="button"
        accessibilityState={{ disabled: wordCount === 0 }}
        testID="start-button"
      >
        <Text style={[styles.startButtonText, wordCount === 0 && styles.startButtonTextDisabled]}>
          Start
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 16,
  },
  list: {
    flex: 1,
  },
  listContent: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#F9FAFB',
  },
  rowSelected: {
    backgroundColor: '#3B82F6',
  },
  rowText: {
    fontSize: 16,
    color: '#111827',
  },
  rowTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
  },
  wordCount: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  noWordsLabel: {
    fontSize: 14,
    color: '#EF4444',
    textAlign: 'center',
    marginBottom: 8,
  },
  startButton: {
    marginTop: 12,
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  startButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  startButtonTextDisabled: {
    color: '#9CA3AF',
  },
});
