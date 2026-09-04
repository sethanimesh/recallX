import { useState, useCallback } from 'react';
import { View, Text, FlatList, Platform, StyleSheet, ListRenderItemInfo, AppState } from 'react-native';
import { TVFocusable } from '@/src/components/TVFocusable';
import { useRouter, useFocusEffect } from 'expo-router';
import { useDynamicInsets } from '@/src/hooks/useDynamicInsets';
import { getAllTags, fetchAllWords, fetchWordsByTag, type Tag, type WordRow } from '@/src/db/operations/tags';
import { allOperations, getSnapshot } from '@/src/db/operations/central';
import { useThemeColors } from '@/src/utils/theme';

type DeckOption = { id: string | null; name: string };
export type Mode = 'recall' | 'flashcard' | 'tutor';
export default function RecallSetupScreen() {
  const router = useRouter(); const insets = useDynamicInsets(); const colors = useThemeColors();
  const [tags, setTags] = useState<Tag[]>([]); const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0); const [todayCount, setTodayCount] = useState(0);
  const [mode, setMode] = useState<Mode>(Platform.isTV ? 'flashcard' : 'recall');
  const [sortOrder, setSortOrder] = useState<'jumbled' | 'alphabetical' | 'newest'>('jumbled');
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let mounted = true; let loading = false;
    async function refresh() {
      if (loading) return; loading = true;
      try {
        const [tagRows, all, selected, snapshot, operations] = await Promise.all([
          getAllTags(), fetchAllWords(), selectedTagId ? fetchWordsByTag(selectedTagId) : Promise.resolve(null), getSnapshot(), allOperations(),
        ]);
        if (!mounted) return;
        setTags(tagRows);
        if (!snapshot) { setWordCount(0); setTodayCount(0); setError('Pair and sync this device before reviewing.'); return; }
        const pending = new Set(operations.filter(operation => operation.status === 'pending').map(operation => { const review = JSON.parse(operation.payload); return `${review.item_id}:${review.mode}`; }));
        const available = (rows: WordRow[]) => mode === 'tutor' ? rows : rows.filter(word => {
          const state = snapshot.memory_states.find(state => state.item_id === word.id && state.mode === mode);
          return !pending.has(`${word.id}:${mode}`) && (!state || new Date(state.due).getTime() <= Date.now());
        });
        const day = new Date(); day.setHours(0, 0, 0, 0);
        setWordCount(available(selected ?? all).length);
        setTodayCount(available(all).filter(word => word.created_at >= day).length); setError('');
      } catch (error) { if (mounted) setError(error instanceof Error ? error.message : 'Could not load your confirmed schedule.'); }
      finally { loading = false; }
    }
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { mounted = false; clearInterval(timer); subscription.remove(); };
  }, [mode, selectedTagId]));
  function start(todayOnly = false) {
    const params = { tagId: todayOnly ? '' : selectedTagId ?? '', sortOrder, ...(todayOnly ? { todayOnly: 'true' } : {}) };
    if (mode === 'flashcard') router.push({ pathname: '/flashcard', params: { ...params, fcMode: 'self-rated' } });
    else if (mode === 'tutor') router.push({ pathname: '/tutor', params });
    else router.push({ pathname: '/recall', params });
  }
  const renderItem = useCallback(({ item }: ListRenderItemInfo<DeckOption>) => <TVFocusable
    style={[styles.row, { backgroundColor: item.id === selectedTagId ? colors.primary : colors.card }]}
    onPress={() => setSelectedTagId(item.id)} accessibilityRole="radio" accessibilityState={{ selected: item.id === selectedTagId }}>
    <Text style={[styles.rowText, { color: item.id === selectedTagId ? '#fff' : colors.text }]}>{item.name}</Text>
  </TVFocusable>, [selectedTagId, colors]);
  const options: Array<{ mode: Mode; label: string }> = Platform.isTV ? [{ mode: 'flashcard', label: 'Self-rated flashcards' }] : [
    { mode: 'recall', label: 'Scheduled recall' }, { mode: 'flashcard', label: 'Self-rated flashcards' }, { mode: 'tutor', label: 'Tutor practice' },
  ];
  return <View style={[styles.container, { paddingBottom: insets.bottom + 16, backgroundColor: colors.background }]}>
    <Text style={[styles.heading, { color: colors.text }]}>Choose a deck</Text>
    <Text style={[styles.subHeading, { color: colors.textSecondary }]}>Review mode</Text>
    <View style={styles.modeGrid}>{options.map((option, index) => <TVFocusable key={option.mode} testID={`mode-${option.mode}`} hasTVPreferredFocus={index === 0}
      accessibilityRole="radio" accessibilityState={{ selected: mode === option.mode }} onPress={() => setMode(option.mode)}
      style={[styles.modeCard, { backgroundColor: mode === option.mode ? colors.accent : colors.inputBackground, borderColor: mode === option.mode ? colors.primary : 'transparent' }]}>
      <Text style={[styles.modeCardText, { color: mode === option.mode ? colors.primary : colors.text }]}>{option.label}</Text>
    </TVFocusable>)}</View>
    <Text style={{ color: colors.textSecondary }}>{mode === 'tutor' ? 'Practice any item with feedback. Your schedule stays unchanged.' : mode === 'flashcard' ? 'Reveal each answer, then rate your recall. Offline ratings wait for server confirmation.' : 'Explain each meaning. Semantic assessment needs the server and an approved rubric.'}</Text>
    <Text style={[styles.subHeading, { color: colors.textSecondary }]}>Sort Order</Text>
    <View style={[styles.sortToggle, { backgroundColor: colors.inputBackground }]}>{(['jumbled', 'alphabetical', 'newest'] as const).map(order => <TVFocusable key={order}
      testID={`sort-${order}`} onPress={() => setSortOrder(order)} accessibilityRole="radio" accessibilityState={{ selected: sortOrder === order }}
      style={[styles.modeButton, sortOrder === order && { backgroundColor: colors.card }]}><Text style={{ color: colors.text }}>{order === 'jumbled' ? 'Jumbled' : order === 'alphabetical' ? 'Alphabetical' : 'Newest'}</Text></TVFocusable>)}</View>
    <FlatList data={[{ id: null, name: 'All Words' }, ...tags]} keyExtractor={item => item.id ?? '__all__'} renderItem={renderItem} style={styles.list} contentContainerStyle={[styles.listContent, { borderColor: colors.border }]} />
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text>}
    <Text style={[styles.wordCount, { color: colors.textSecondary }]} testID="word-count-label">{`${wordCount} ${wordCount === 1 ? 'word' : 'words'}${mode === 'tutor' ? ' available for practice' : ' due now'}`}</Text>
    {!error && wordCount === 0 && <Text style={[styles.caughtUpLabel, { color: colors.textSecondary }]}>{mode === 'tutor' ? 'No words to practice.' : 'All caught up! No words due now.'}</Text>}
    <TVFocusable style={[styles.todayButton, { backgroundColor: todayCount ? '#8B5CF6' : colors.inputBackground }]} onPress={() => start(true)} disabled={!todayCount} testID="today-words-button"><Text style={[styles.todayButtonText, !todayCount && { color: colors.textSecondary }]}>Today's Words ({todayCount})</Text></TVFocusable>
    <TVFocusable style={[styles.startButton, { backgroundColor: wordCount ? colors.primary : colors.inputBackground }]} onPress={() => start()} disabled={!wordCount} testID="start-button" accessibilityRole="button" accessibilityState={{ disabled: !wordCount }}><Text style={[styles.startButtonText, !wordCount && { color: colors.textSecondary }]}>Start</Text></TVFocusable>
  </View>;
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
