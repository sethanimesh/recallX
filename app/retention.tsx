import { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, AppState } from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDynamicInsets } from '@/src/hooks/useDynamicInsets';
import { useThemeColors } from '@/src/utils/theme';
import { getSnapshot } from '@/src/db/operations/central';


type WordRow = { id: string; word: string; definition: string; srs_next_review_at: Date | null; fc_next_review_at: Date | null };

type Bucket = {
  label: string;
  key: string;
  count: number;
  color: string;
  order: number;
};

export default function RetentionScreen() {
  const colors = useThemeColors();
  const insets = useDynamicInsets();
  const router = useRouter();
  const [allWords, setAllWords] = useState<WordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'recall' | 'flashcard'>('recall');
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    let mounted = true; let refreshing = false;
    async function loadData() {
      if (refreshing) return; refreshing = true;
      try {
        const snapshot = await getSnapshot();
        if (mounted) setError(snapshot ? '' : 'Pair and sync this device to view your confirmed schedule.');
        const data = snapshot?.words.filter(word => word.deleted_at == null).map(word => {
          const recall = snapshot.memory_states.find(state => state.item_id === word.id && state.mode === 'recall');
          const flashcard = snapshot.memory_states.find(state => state.item_id === word.id && state.mode === 'flashcard');
          return { id: word.id, word: word.word, definition: word.definition, srs_next_review_at: recall ? new Date(recall.due) : null, fc_next_review_at: flashcard ? new Date(flashcard.due) : null };
        }) ?? [];
        if (mounted) setAllWords(data);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Could not read your confirmed schedule.');
      } finally {
        refreshing = false; if (mounted) setLoading(false);
      }
    }
    void loadData();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void loadData(); }, 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void loadData(); });
    return () => { mounted = false; clearInterval(timer); subscription.remove(); };
  }, []));

  const { buckets, maxCount, vergeWords } = useMemo(() => {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const tomorrowEnd = new Date(todayEnd.getTime() + 86400000);
    const days3End = new Date(todayEnd.getTime() + 86400000 * 3);
    const days7End = new Date(todayEnd.getTime() + 86400000 * 7);

    let bOverdue = 0;
    let bToday = 0;
    let bTomorrow = 0;
    let bDays2_3 = 0;
    let bDays4_7 = 0;
    let bDays8Plus = 0;
    let bUnseen = 0;

    const verge: WordRow[] = [];

    for (const w of allWords) {
      const reviewAt = mode === 'recall' ? w.srs_next_review_at : w.fc_next_review_at;

      if (!reviewAt) {
        bUnseen++;
        continue;
      }

      if (reviewAt < now) {
        bOverdue++;
        verge.push(w);
      } else if (reviewAt <= todayEnd) {
        bToday++;
        verge.push(w);
      } else if (reviewAt <= tomorrowEnd) {
        bTomorrow++;
      } else if (reviewAt <= days3End) {
        bDays2_3++;
      } else if (reviewAt <= days7End) {
        bDays4_7++;
      } else {
        bDays8Plus++;
      }
    }

    const res: Bucket[] = [
      { label: 'Overdue', key: 'overdue', count: bOverdue, color: '#EF4444', order: 1 },
      { label: 'Today', key: 'today', count: bToday, color: '#F59E0B', order: 2 },
      { label: 'Tmrw', key: 'tomorrow', count: bTomorrow, color: '#10B981', order: 3 },
      { label: '2-3d', key: 'days2_3', count: bDays2_3, color: '#3B82F6', order: 4 },
      { label: '4-7d', key: 'days4_7', count: bDays4_7, color: '#6366F1', order: 5 },
      { label: '8+d', key: 'days8plus', count: bDays8Plus, color: '#8B5CF6', order: 6 },
    ];

    const max = Math.max(...res.map(b => b.count), 1);
    
    // Sort verge words by next_review_at ascending (most overdue first)
    verge.sort((a, b) => {
      const aTime = mode === 'recall' ? a.srs_next_review_at : a.fc_next_review_at;
      const bTime = mode === 'recall' ? b.srs_next_review_at : b.fc_next_review_at;
      if (!aTime) return 1;
      if (!bTime) return -1;
      return aTime.getTime() - bTime.getTime();
    });

    return { buckets: res, maxCount: max, vergeWords: verge };
  }, [allWords, mode]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Retention Stats',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          ),
        }}
      />
      
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}>
          {!!error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text>}
          <View style={styles.toggleRow}>
            <TouchableOpacity 
              style={[styles.toggleBtn, mode === 'recall' && { backgroundColor: colors.primary }]} 
              onPress={() => setMode('recall')}
            >
              <Text style={[styles.toggleText, mode === 'recall' ? { color: '#fff' } : { color: colors.textSecondary }]}>Recall</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.toggleBtn, mode === 'flashcard' && { backgroundColor: colors.primary }]} 
              onPress={() => setMode('flashcard')}
            >
              <Text style={[styles.toggleText, mode === 'flashcard' ? { color: '#fff' } : { color: colors.textSecondary }]}>Flashcard</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Scheduled reviews</Text>
            <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
              Server-confirmed due dates from FSRS
            </Text>

            <View style={styles.chartContainer}>
              {buckets.map((b) => {
                const heightPct = (b.count / maxCount) * 100;
                return (
                  <View key={b.key} style={styles.barCol}>
                    <Text style={[styles.barCount, { color: colors.text }]}>{b.count}</Text>
                    <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                      <View 
                        style={[
                          styles.barFill, 
                          { backgroundColor: b.color, height: `${heightPct}%` }
                        ]} 
                      />
                    </View>
                    <Text style={[styles.barLabel, { color: colors.textSecondary }]}>{b.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadow, marginTop: 16 }]}>
            <View style={styles.vergeHeader}>
              <Ionicons name="warning-outline" size={20} color="#F59E0B" />
              <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 0, marginLeft: 8 }]}>On the Verge</Text>
            </View>
            <Text style={[styles.cardSubtitle, { color: colors.textSecondary, marginBottom: 16 }]}>
              These words are due or overdue according to your confirmed schedule.
            </Text>

            {vergeWords.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{error ? 'Confirmed schedule unavailable.' : "You're all caught up!"}</Text>
            ) : (
              vergeWords.slice(0, 10).map((w, idx) => {
                const reviewAt = mode === 'recall' ? w.srs_next_review_at : w.fc_next_review_at;
                const isOverdue = reviewAt && reviewAt < new Date();
                
                return (
                  <View key={w.id} style={[styles.wordRow, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                    <View style={styles.wordInfo}>
                      <Text style={[styles.wordText, { color: colors.text }]}>{w.word}</Text>
                      <Text style={[styles.defText, { color: colors.textSecondary }]} numberOfLines={1}>{w.definition}</Text>
                    </View>
                    <View style={[styles.statusBadge, isOverdue ? { backgroundColor: '#FEE2E2' } : { backgroundColor: '#FEF3C7' }]}>
                      <Text style={[styles.statusText, isOverdue ? { color: '#EF4444' } : { color: '#F59E0B' }]}>
                        {isOverdue ? 'Overdue' : 'Today'}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
            
            {vergeWords.length > 10 && (
              <Text style={[styles.moreText, { color: colors.textSecondary }]}>+ {vergeWords.length - 10} more...</Text>
            )}
            
            {vergeWords.length > 0 && (
              <TouchableOpacity 
                style={[styles.reviewBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push(mode === 'recall' ? '/recall-setup' : '/flashcard?fcMode=self-rated' as any)}
              >
                <Text style={styles.reviewBtnText}>Review Now</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerButton: { padding: 8, marginLeft: -8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16 },
  toggleRow: { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 8, padding: 4, marginBottom: 16 },
  toggleBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  toggleText: { fontSize: 14, fontWeight: '600' },
  card: {
    borderRadius: 16,
    padding: 20,
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, marginBottom: 24 },
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 180,
    paddingTop: 20,
  },
  barCol: { alignItems: 'center', flex: 1 },
  barCount: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  barTrack: {
    width: 24,
    height: 120,
    borderRadius: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 6 },
  barLabel: { fontSize: 11, marginTop: 8, fontWeight: '500' },
  vergeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  emptyText: { textAlign: 'center', fontStyle: 'italic', marginVertical: 20 },
  wordRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  wordInfo: { flex: 1 },
  wordText: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  defText: { fontSize: 13 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: '700' },
  moreText: { textAlign: 'center', fontSize: 13, marginTop: 12, fontStyle: 'italic' },
  reviewBtn: { marginTop: 20, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  reviewBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
