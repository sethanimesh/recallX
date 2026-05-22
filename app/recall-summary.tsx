import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  ListRenderItemInfo,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { fetchAllWords, type WordRow } from '@/src/db/operations/tags';
import { useThemeColors } from '@/src/utils/theme';

export default function RecallSummaryScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { score: scoreStr, total: totalStr, tagId, mode, fcMode, missedIds, recentlyWrongIds, clearedFromBuffer } = useLocalSearchParams<{
    score: string;
    total: string;
    tagId: string;
    mode: string;
    fcMode: string;
    missedIds: string;
    recentlyWrongIds: string;
    clearedFromBuffer: string;
  }>();

  const score = parseInt(scoreStr ?? '0', 10);
  const total = parseInt(totalStr ?? '0', 10);
  const pct = total > 0 ? score / total : 0;

  const [missedWords, setMissedWords] = useState<WordRow[]>([]);
  const [clearedWords, setClearedWords] = useState<WordRow[]>([]);
  const [stillStrugglingWords, setStillStrugglingWords] = useState<WordRow[]>([]);

  useEffect(() => {
    if (!missedIds || missedIds.length === 0) return;
    const ids = new Set(missedIds.split(',').filter(Boolean));
    fetchAllWords()
      .then(all => setMissedWords(all.filter(w => ids.has(w.id))))
      .catch(() => {});
  }, [missedIds]);

  useEffect(() => {
    if (!recentlyWrongIds || recentlyWrongIds.length === 0) return;
    const allPriorIds = new Set(recentlyWrongIds.split(',').filter(Boolean));
    const clearedIds = new Set((clearedFromBuffer ?? '').split(',').filter(Boolean));
    fetchAllWords()
      .then(all => {
        setClearedWords(all.filter(w => clearedIds.has(w.id)));
        setStillStrugglingWords(all.filter(w => allPriorIds.has(w.id) && !clearedIds.has(w.id)));
      })
      .catch(() => {});
  }, [recentlyWrongIds, clearedFromBuffer]);

  function handleRestart() {
    if (mode === 'flashcard') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace({ pathname: '/flashcard' as any, params: { tagId: tagId ?? '', fcMode: fcMode ?? 'passive' } });
    } else if (mode === 'tutor') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace({ pathname: '/tutor' as any, params: { tagId: tagId ?? '' } });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace({ pathname: '/recall' as any, params: { tagId: tagId ?? '', mode: mode ?? 'adaptive' } });
    }
  }

  function handleDone() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace('/(tabs)/practice' as any);
  }

  const renderMissedItem = useCallback(({ item }: ListRenderItemInfo<WordRow>) => (
    <View style={styles.missedRow} testID={`missed-row-${item.id}`}>
      <Text style={[styles.missedWord, { color: colors.text }]}>{item.word}</Text>
      <Text style={[styles.missedDefinition, { color: colors.textSecondary }]}>{item.definition}</Text>
    </View>
  ), [colors]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.heading, { color: colors.text }]}>Session Complete</Text>

        <Text style={[styles.fraction, { color: colors.text }]} testID="score-fraction">{score} / {total}</Text>

        <View style={[styles.barTrack, { backgroundColor: colors.border }]} testID="progress-bar">
          <View style={[styles.barFill, { backgroundColor: colors.success, width: `${Math.round(pct * 100)}%` as any }]} />
        </View>

        <Text style={[styles.pctText, { color: colors.textSecondary }]}>{total > 0 ? `${Math.round(pct * 100)}%` : '—'}</Text>

        {missedWords.length > 0 && (
          <View style={styles.missedSection}>
            <Text style={[styles.missedHeading, { color: colors.text }]} testID="missed-heading">
              Missed Words ({missedWords.length})
            </Text>
            <FlatList
              data={missedWords}
              keyExtractor={item => item.id}
              renderItem={renderMissedItem}
              ItemSeparatorComponent={() => <View style={[styles.missedSeparator, { backgroundColor: colors.border }]} />}
              scrollEnabled={false}
            />
          </View>
        )}

        {(clearedWords.length > 0 || stillStrugglingWords.length > 0) && (
          <View style={styles.lastSessionSection}>
            <Text style={[styles.lastSessionHeading, { color: colors.text }]}>From last session</Text>
            {clearedWords.map(w => (
              <View key={w.id} style={styles.lastSessionRow} testID={`cleared-row-${w.id}`}>
                <Text style={[styles.lastSessionCheck, { color: colors.success }]}>✓</Text>
                <Text style={[styles.lastSessionWord, { color: colors.text }]}>{w.word}</Text>
              </View>
            ))}
            {stillStrugglingWords.map(w => (
              <View key={w.id} style={styles.lastSessionRow} testID={`struggling-row-${w.id}`}>
                <Text style={[styles.lastSessionCross, { color: colors.error }]}>✗</Text>
                <Text style={[styles.lastSessionWord, { color: colors.text }]}>{w.word}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.restartButton, { backgroundColor: colors.success }]}
          onPress={handleRestart}
          testID="restart-button"
          accessibilityRole="button"
        >
          <Text style={styles.restartText}>Restart</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.doneButton, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={handleDone}
          testID="done-button"
          accessibilityRole="button"
        >
          <Text style={[styles.doneText, { color: colors.textSecondary }]}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 24 },
  scrollArea: { flex: 1 },
  scrollContent: { alignItems: 'center', paddingTop: 48, gap: 24, paddingBottom: 16 },
  heading: { fontSize: 28, fontWeight: 'bold', color: '#111827', textAlign: 'center' },
  fraction: { fontSize: 56, fontWeight: 'bold', color: '#111827', textAlign: 'center' },
  barTrack: { width: '100%', height: 16, backgroundColor: '#E5E7EB', borderRadius: 8, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#22c55e', borderRadius: 8 },
  pctText: { fontSize: 16, color: '#6B7280' },
  missedSection: { width: '100%', marginTop: 8 },
  missedHeading: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  missedRow: { paddingVertical: 10, gap: 4 },
  missedWord: { fontSize: 15, fontWeight: '700', color: '#111827' },
  missedDefinition: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  missedSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB' },
  lastSessionSection: { width: '100%', marginTop: 8 },
  lastSessionHeading: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  lastSessionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  lastSessionCheck: { fontSize: 16, color: '#22C55E', fontWeight: '700', width: 20, textAlign: 'center' },
  lastSessionCross: { fontSize: 16, color: '#EF4444', fontWeight: '700', width: 20, textAlign: 'center' },
  lastSessionWord: { fontSize: 15, fontWeight: '600', color: '#111827' },
  buttons: { gap: 12, marginBottom: 16, marginTop: 8 },
  restartButton: { backgroundColor: '#22c55e', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  restartText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  doneButton: {
    borderWidth: 1.5, borderColor: '#6B7280', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', backgroundColor: 'transparent',
  },
  doneText: { fontSize: 17, fontWeight: '600', color: '#6B7280' },
});
