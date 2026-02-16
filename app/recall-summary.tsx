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

export default function RecallSummaryScreen() {
  const router = useRouter();
  const { score: scoreStr, total: totalStr, tagId, mode, fcMode, missedIds } = useLocalSearchParams<{
    score: string;
    total: string;
    tagId: string;
    mode: string;
    fcMode: string;
    missedIds: string;
  }>();

  const score = parseInt(scoreStr ?? '0', 10);
  const total = parseInt(totalStr ?? '0', 10);
  const pct = total > 0 ? score / total : 0;

  const [missedWords, setMissedWords] = useState<WordRow[]>([]);

  useEffect(() => {
    if (!missedIds || missedIds.length === 0) return;
    const ids = new Set(missedIds.split(',').filter(Boolean));
    fetchAllWords()
      .then(all => setMissedWords(all.filter(w => ids.has(w.id))))
      .catch(() => {});
  }, [missedIds]);

  function handleRestart() {
    if (mode === 'flashcard') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace({ pathname: '/flashcard' as any, params: { tagId: tagId ?? '', fcMode: fcMode ?? 'passive' } });
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
      <Text style={styles.missedWord}>{item.word}</Text>
      <Text style={styles.missedDefinition}>{item.definition}</Text>
    </View>
  ), []);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>Session Complete</Text>

        <Text style={styles.fraction} testID="score-fraction">{score} / {total}</Text>

        <View style={styles.barTrack} testID="progress-bar">
          <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` as any }]} />
        </View>

        <Text style={styles.pctText}>{total > 0 ? `${Math.round(pct * 100)}%` : '—'}</Text>

        {missedWords.length > 0 && (
          <View style={styles.missedSection}>
            <Text style={styles.missedHeading} testID="missed-heading">
              Missed Words ({missedWords.length})
            </Text>
            <FlatList
              data={missedWords}
              keyExtractor={item => item.id}
              renderItem={renderMissedItem}
              ItemSeparatorComponent={() => <View style={styles.missedSeparator} />}
              scrollEnabled={false}
            />
          </View>
        )}
      </ScrollView>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={styles.restartButton}
          onPress={handleRestart}
          testID="restart-button"
          accessibilityRole="button"
        >
          <Text style={styles.restartText}>Restart</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={handleDone}
          testID="done-button"
          accessibilityRole="button"
        >
          <Text style={styles.doneText}>Done</Text>
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
  buttons: { gap: 12, marginBottom: 16, marginTop: 8 },
  restartButton: { backgroundColor: '#22c55e', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  restartText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  doneButton: {
    borderWidth: 1.5, borderColor: '#6B7280', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', backgroundColor: 'transparent',
  },
  doneText: { fontSize: 17, fontWeight: '600', color: '#6B7280' },
});
