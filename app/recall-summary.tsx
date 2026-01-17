import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function RecallSummaryScreen() {
  const router = useRouter();
  const { score: scoreStr, total: totalStr, tagId } = useLocalSearchParams<{
    score: string;
    total: string;
    tagId: string;
  }>();

  const score = parseInt(scoreStr ?? '0', 10);
  const total = parseInt(totalStr ?? '0', 10);
  const pct = total > 0 ? score / total : 0;

  function handleRestart() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace({ pathname: '/recall' as any, params: { tagId: tagId ?? '' } });
  }

  function handleDone() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace('/(tabs)/practice' as any);
  }

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Text style={styles.heading}>Session Complete</Text>

        <Text style={styles.fraction} testID="score-fraction">
          {score} / {total}
        </Text>

        <View style={styles.barTrack} testID="progress-bar">
          <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` as any }]} />
        </View>

        <Text style={styles.pctText}>{total > 0 ? `${Math.round(pct * 100)}%` : '—'}</Text>
      </View>

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
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
    justifyContent: 'space-between',
  },
  top: {
    alignItems: 'center',
    marginTop: 48,
    gap: 24,
  },
  heading: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  fraction: {
    fontSize: 56,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  barTrack: {
    width: '100%',
    height: 16,
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 8,
  },
  pctText: {
    fontSize: 16,
    color: '#6B7280',
  },
  buttons: {
    gap: 12,
    marginBottom: 16,
  },
  restartButton: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  restartText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  doneButton: {
    borderWidth: 1.5,
    borderColor: '#6B7280',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  doneText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#6B7280',
  },
});
