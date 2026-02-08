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
import { fetchDueWords } from '@/src/db/operations/srs';

type DeckOption = { id: string | null; name: string };
export type Mode = 'adaptive' | 'classic';

export default function RecallSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [mode, setMode] = useState<Mode>('adaptive');

  useFocusEffect(
    useCallback(() => {
      getAllTags().then(setTags);
    }, [])
  );

  useEffect(() => {
    let cancelled = false;
    async function computeCount() {
      if (mode === 'adaptive') {
        const rows = selectedTagId !== null
          ? await fetchDueWords(selectedTagId)
          : await fetchDueWords();
        if (!cancelled) setWordCount(rows.length);
      } else {
        const rows = selectedTagId === null
          ? await fetchAllWords()
          : await fetchWordsByTag(selectedTagId);
        if (!cancelled) setWordCount(rows.length);
      }
    }
    computeCount().catch(() => {});
    return () => { cancelled = true; };
  }, [selectedTagId, mode]);

  const handleStart = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push({ pathname: '/recall' as any, params: { tagId: selectedTagId ?? '', mode } });
  }, [router, selectedTagId, mode]);

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
          <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>{item.name}</Text>
        </TouchableOpacity>
      );
    },
    [selectedTagId],
  );

  const allCaughtUp = mode === 'adaptive' && wordCount === 0;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <Text style={styles.heading}>Choose a deck</Text>

      <View style={styles.modeToggle}>
        {(['adaptive', 'classic'] as Mode[]).map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.modeButton, mode === m && styles.modeButtonActive]}
            onPress={() => setMode(m)}
            testID={`mode-${m}`}
          >
            <Text style={[styles.modeButtonText, mode === m && styles.modeButtonTextActive]}>
              {m === 'adaptive' ? 'Adaptive' : 'Classic'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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
        {mode === 'adaptive' ? ' due today' : ''}
      </Text>

      {allCaughtUp && (
        <Text style={styles.caughtUpLabel} testID="caught-up-label">
          All caught up! No words due today.
        </Text>
      )}

      {wordCount === 0 && mode === 'classic' && (
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
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 20, paddingTop: 16 },
  heading: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  modeButton: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  modeButtonActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  modeButtonText: { fontSize: 14, fontWeight: '500', color: '#6B7280' },
  modeButtonTextActive: { color: '#111827', fontWeight: '700' },
  list: { flex: 1 },
  listContent: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  row: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#F9FAFB' },
  rowSelected: { backgroundColor: '#3B82F6' },
  rowText: { fontSize: 16, color: '#111827' },
  rowTextSelected: { color: '#fff', fontWeight: '600' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB' },
  wordCount: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 12, marginBottom: 4 },
  caughtUpLabel: { fontSize: 14, color: '#22c55e', textAlign: 'center', marginBottom: 8 },
  noWordsLabel: { fontSize: 14, color: '#EF4444', textAlign: 'center', marginBottom: 8 },
  startButton: { marginTop: 12, backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  startButtonDisabled: { backgroundColor: '#E5E7EB' },
  startButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  startButtonTextDisabled: { color: '#9CA3AF' },
});
