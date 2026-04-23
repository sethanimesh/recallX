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
import { Ionicons } from '@expo/vector-icons';
import { getAllTags, fetchAllWords, fetchWordsByTag, type Tag } from '@/src/db/operations/tags';
import { fetchDueWords, fetchDueWordsFc } from '@/src/db/operations/srs';
import { fetchTodayWordCount } from '@/src/db/operations/sessionHistory';

type DeckOption = { id: string | null; name: string };
export type Mode = 'adaptive' | 'classic' | 'flashcard' | 'tutor';
export type FcMode = 'passive' | 'self-rated';

export default function RecallSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [mode, setMode] = useState<Mode>('adaptive');
  const [fcMode, setFcMode] = useState<FcMode>('passive');
  const [sortOrder, setSortOrder] = useState<'jumbled' | 'alphabetical' | 'newest'>('jumbled');
  const [todayCount, setTodayCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      getAllTags().then(setTags);
      fetchTodayWordCount().then(setTodayCount).catch(() => {});
    }, [])
  );

  useEffect(() => {
    let cancelled = false;
    async function computeCount() {
      let count = 0;
      if (mode === 'adaptive' || mode === 'tutor') {
        const rows = selectedTagId !== null
          ? await fetchDueWords(selectedTagId)
          : await fetchDueWords();
        count = rows.length;
      } else if (mode === 'classic') {
        const rows = selectedTagId === null
          ? await fetchAllWords()
          : await fetchWordsByTag(selectedTagId);
        count = rows.length;
      } else {
        // flashcard
        if (fcMode === 'self-rated') {
          const rows = selectedTagId !== null
            ? await fetchDueWordsFc(selectedTagId)
            : await fetchDueWordsFc();
          count = rows.length;
        } else {
          const rows = selectedTagId === null
            ? await fetchAllWords()
            : await fetchWordsByTag(selectedTagId);
          count = rows.length;
        }
      }
      if (!cancelled) setWordCount(count);
    }
    computeCount().catch(() => {});
    return () => { cancelled = true; };
  }, [selectedTagId, mode, fcMode]);

  const handleStart = useCallback(() => {
    if (mode === 'flashcard') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push({ pathname: '/flashcard' as any, params: { tagId: selectedTagId ?? '', fcMode, sortOrder } });
    } else if (mode === 'tutor') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push({ pathname: '/tutor' as any, params: { tagId: selectedTagId ?? '', sortOrder } });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push({ pathname: '/recall' as any, params: { tagId: selectedTagId ?? '', mode, sortOrder } });
    }
  }, [router, selectedTagId, mode, fcMode, sortOrder]);

  const handleTodayWords = useCallback(() => {
    if (mode === 'flashcard') {
      router.push({ pathname: '/flashcard' as any, params: { tagId: '', fcMode, todayOnly: 'true', sortOrder } });
    } else if (mode === 'tutor') {
      router.push({ pathname: '/tutor' as any, params: { tagId: '', todayOnly: 'true', sortOrder } });
    } else {
      router.push({ pathname: '/recall' as any, params: { tagId: '', mode, todayOnly: 'true', sortOrder } });
    }
  }, [router, mode, fcMode, sortOrder]);

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

  const allCaughtUp = (mode === 'adaptive' || mode === 'tutor') && wordCount === 0;
  const fcAllCaughtUp = mode === 'flashcard' && fcMode === 'self-rated' && wordCount === 0;

  const wordCountSuffix =
    mode === 'adaptive' || mode === 'tutor' || (mode === 'flashcard' && fcMode === 'self-rated')
      ? ' due today'
      : '';

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <Text style={styles.heading}>Choose a deck</Text>

      <Text style={styles.subHeading}>Review Mode</Text>
      <View style={styles.modeGrid}>
        {(['adaptive', 'classic', 'flashcard', 'tutor'] as Mode[]).map(m => {
          const isActive = mode === m;
          let iconName: keyof typeof Ionicons.glyphMap = 'sparkles-outline';
          let label = 'Adaptive';
          if (m === 'classic') {
            iconName = 'book-outline';
            label = 'Classic';
          } else if (m === 'flashcard') {
            iconName = 'albums-outline';
            label = 'Flashcard';
          } else if (m === 'tutor') {
            iconName = 'chatbubble-ellipses-outline';
            label = 'AI Tutor';
          }

          return (
            <TouchableOpacity
              key={m}
              style={[styles.modeCard, isActive && styles.modeCardActive]}
              onPress={() => setMode(m)}
              testID={`mode-${m}`}
            >
              <Ionicons
                name={iconName}
                size={18}
                color={isActive ? '#3B82F6' : '#6B7280'}
                style={styles.modeIcon}
              />
              <Text style={[styles.modeCardText, isActive && styles.modeCardTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {mode === 'flashcard' && (
        <View style={styles.fcModeToggle}>
          {(['passive', 'self-rated'] as FcMode[]).map(fm => (
            <TouchableOpacity
              key={fm}
              style={[styles.modeButton, fcMode === fm && styles.modeButtonActive]}
              onPress={() => setFcMode(fm)}
              testID={`fcmode-${fm}`}
            >
              <Text style={[styles.modeButtonText, fcMode === fm && styles.modeButtonTextActive]}>
                {fm === 'passive' ? 'Passive' : 'Self-Rated'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.subHeading}>Sort Order</Text>
      <View style={styles.sortToggle}>
        {(['jumbled', 'alphabetical', 'newest'] as const).map(so => (
          <TouchableOpacity
            key={so}
            style={[styles.modeButton, sortOrder === so && styles.modeButtonActive]}
            onPress={() => setSortOrder(so)}
            testID={`sort-${so}`}
          >
            <Text style={[styles.modeButtonText, sortOrder === so && styles.modeButtonTextActive]}>
              {so === 'jumbled' ? 'Jumbled' : so === 'alphabetical' ? 'Alphabetical' : 'Newest'}
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
        {`${wordCount}`}{` ${wordCount === 1 ? 'word' : 'words'}${wordCountSuffix}`}
      </Text>

      {allCaughtUp && (
        <Text style={styles.caughtUpLabel} testID="caught-up-label">
          All caught up! No words due today.
        </Text>
      )}

      {fcAllCaughtUp && (
        <Text style={styles.caughtUpLabel} testID="fc-caught-up-label">
          All caught up! No words due today.
        </Text>
      )}

      {wordCount === 0 && (mode === 'classic' || (mode === 'flashcard' && fcMode === 'passive')) && (
        <Text style={styles.noWordsLabel} testID="no-words-label">
          No words to review
        </Text>
      )}

      <TouchableOpacity
        style={[styles.todayButton, todayCount === 0 && styles.startButtonDisabled]}
        onPress={handleTodayWords}
        disabled={todayCount === 0}
        testID="today-words-button"
      >
        <Text style={[styles.todayButtonText, todayCount === 0 && styles.startButtonTextDisabled]}>
          Today's Words ({todayCount})
        </Text>
      </TouchableOpacity>

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
  subHeading: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginTop: 8, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  modeCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  modeCardActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  modeIcon: {
    marginRight: 6,
  },
  modeCardText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4B5563',
  },
  modeCardTextActive: {
    color: '#1E40AF',
    fontWeight: '700',
  },
  fcModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  sortToggle: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
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
  todayButton: { marginTop: 8, backgroundColor: '#8B5CF6', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  todayButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
