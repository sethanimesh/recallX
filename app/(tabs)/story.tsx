import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useDynamicInsets } from '@/src/hooks/useDynamicInsets';
import { useThemeColors } from '@/src/utils/theme';

export default function StoryScreen() {
  const router = useRouter();
  const insets = useDynamicInsets();
  const colors = useThemeColors();

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16, backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Contextual Stories</Text>
        <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
          Generate engaging stories to read your vocabulary in context.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onPress={() => router.push('/story-setup' as any)}
          accessibilityRole="button"
          testID="story-setup-button"
        >
          <Text style={styles.buttonText}>Get Started</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
