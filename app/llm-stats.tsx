import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { fetchLlmStats, type Period, type LlmStatsResponse, type LlmCall } from '@/src/api/statsClient';
import { useThemeColors } from '@/src/utils/theme';

const TASK_LABELS: Record<string, string> = { image: 'Image', text: 'Extract', word: 'Lookup', grade: 'Grade' };

const PERIODS: { label: string; value: Period }[] = [
  { label: 'Today', value: 'today' },
  { label: 'This week', value: 'week' },
  { label: 'This month', value: 'month' },
  { label: 'All time', value: 'all' },
];

function relativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function LlmStatsScreen() {
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<LlmStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const colors = useThemeColors();

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLlmStats(p);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const renderCall = useCallback(({ item }: { item: LlmCall }) => (
    <View style={[styles.callRow, { borderBottomColor: colors.border }]}>
      <View style={[
        styles.taskBadge,
        item.task === 'grade' ? { backgroundColor: colors.success + '22' } : { backgroundColor: colors.primary + '22' }
      ]}>
        <Text style={[styles.taskBadgeText, { color: item.task === 'grade' ? colors.success : colors.primary }]}>
          {TASK_LABELS[item.task] ?? item.task}
        </Text>
      </View>
      <View style={styles.callInfo}>
        <Text style={[styles.callProvider, { color: colors.text }]}>{item.provider} · {item.model}</Text>
      </View>
      <Text style={[styles.callTime, { color: colors.textSecondary }]}>{relativeTime(item.called_at)}</Text>
    </View>
  ), [colors]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Period picker */}
        <View style={styles.pickerRow}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.value}
              style={[
                styles.pill,
                { backgroundColor: colors.inputBackground },
                period === p.value && { backgroundColor: colors.primary }
              ]}
              onPress={() => setPeriod(p.value)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.pillText,
                { color: colors.textSecondary },
                period === p.value && { color: '#fff', fontWeight: '700' }
              ]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading && <ActivityIndicator style={styles.center} color={colors.primary} />}

        {!loading && error && (
          <View style={styles.center}>
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            <TouchableOpacity onPress={() => load(period)} style={[styles.retryBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !error && data && (
          <FlatList
            data={data.calls}
            keyExtractor={(_, i) => String(i)}
            ListHeaderComponent={
              <>
                {/* Summary */}
                {data.total_calls === 0 ? (
                  <Text style={[styles.empty, { color: colors.textSecondary }]}>No LLM calls recorded for this period.</Text>
                ) : (
                  <View style={styles.summarySection}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Summary · {data.total_calls} calls</Text>
                    {data.by_provider.map((pc) => {
                      const pct = data.total_calls > 0 ? pc.count / data.total_calls : 0;
                      return (
                        <View key={`${pc.provider}-${pc.model}`} style={[styles.providerCard, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
                          <View style={styles.providerHeader}>
                            <Text style={[styles.providerName, { color: colors.text }]}>{pc.provider}</Text>
                            <Text style={[styles.providerCount, { color: colors.text }]}>{pc.count}</Text>
                          </View>
                          <Text style={[styles.modelName, { color: colors.textSecondary }]}>{pc.model}</Text>
                          <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                            <View style={[styles.barFill, { backgroundColor: colors.primary, width: `${Math.round(pct * 100)}%` }]} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
                {data.calls.length > 0 && (
                  <Text style={[styles.sectionTitle, { marginTop: 24, color: colors.textSecondary }]}>Call Log</Text>
                )}
              </>
            }
            renderItem={renderCall}
            contentContainerStyle={styles.listContent}
          />
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  pickerRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexWrap: 'wrap',
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
  },
  pillActive: { backgroundColor: '#111827' },
  pillText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  pillTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: '#EF4444', textAlign: 'center', marginBottom: 12 },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#111827',
    borderRadius: 8,
  },
  retryText: { color: '#fff', fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  empty: { color: '#6B7280', textAlign: 'center', marginTop: 40 },
  summarySection: { marginTop: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  providerCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  providerHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  providerName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  providerCount: { fontSize: 15, fontWeight: '700', color: '#111827' },
  modelName: { fontSize: 12, color: '#6B7280', marginBottom: 8 },
  barTrack: { height: 4, backgroundColor: '#E5E7EB', borderRadius: 2 },
  barFill: { height: 4, backgroundColor: '#111827', borderRadius: 2 },
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    gap: 10,
  },
  taskBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeExtract: { backgroundColor: '#DBEAFE' },
  badgeGrade: { backgroundColor: '#D1FAE5' },
  taskBadgeText: { fontSize: 11, fontWeight: '700', color: '#374151' },
  callInfo: { flex: 1 },
  callProvider: { fontSize: 13, color: '#374151' },
  callTime: { fontSize: 12, color: '#9CA3AF' },
});
