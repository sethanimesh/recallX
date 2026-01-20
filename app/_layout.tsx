import 'react-native-reanimated';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useColorScheme, View, ActivityIndicator, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { runMigrations } from '@/src/db/client';
import { syncFromServer } from '@/src/db/operations/sync';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        await runMigrations();
      } catch (err) {
        console.error('[DB] Migration error:', err);
      }
      try {
        await syncFromServer();
      } catch (err) {
        console.warn('[Sync] Failed — using cached data:', err);
        setSyncError(true);
      }
      setReady(true);
    }
    init();
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {syncError && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Could not sync — showing cached data</Text>
          <TouchableOpacity onPress={() => setSyncError(false)}>
            <Text style={styles.bannerDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="ingest" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="add-word" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="review" options={{ headerShown: false }} />
        <Stack.Screen name="words/[id]" options={{ title: '', headerBackTitle: 'Library' }} />
        <Stack.Screen name="recall-setup" options={{ title: 'Start Review', headerShown: true }} />
        <Stack.Screen name="recall" options={{ title: 'Recall', headerShown: true }} />
        <Stack.Screen name="recall-summary" options={{ title: 'Session Complete', headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: {
    backgroundColor: '#FEF3C7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bannerText: { fontSize: 13, color: '#92400E', flex: 1 },
  bannerDismiss: { fontSize: 16, color: '#92400E', paddingLeft: 12 },
});
