import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sql } from 'drizzle-orm';
import { db } from '@/src/db/client';
import { words } from '@/src/db/schema';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [wordCount, setWordCount] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      db.select({ count: sql<number>`count(*)` })
        .from(words)
        .then((rows) => { if (active) setWordCount(Number(rows[0]?.count ?? 0)); })
        .catch((err) => {
          if (__DEV__) console.warn('[HomeScreen] word count query failed', err);
          if (active) setWordCount(0);
        });
      return () => { active = false; };
    }, []),
  );

  const countLabel =
    wordCount === null
      ? ''
      : wordCount === 0
        ? 'No words yet'
        : `${wordCount} word${wordCount === 1 ? '' : 's'} in your library`;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Home</Text>
      {countLabel ? <Text style={styles.body}>{countLabel}</Text> : null}
      <TouchableOpacity
        style={[styles.fab, { bottom: 24 + insets.bottom }]}
        onPress={() => router.push('/ingest')}
      >
        <Ionicons name="add" size={28} color="white" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  body: { fontSize: 16, color: '#666' },
  fab: {
    position: 'absolute',
    right: 24,
    backgroundColor: '#007AFF',
    borderRadius: 32,
    padding: 16,
  },
});
