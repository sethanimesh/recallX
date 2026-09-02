import 'react-native-reanimated';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useColorScheme, View, Text, StyleSheet, AppState, Platform } from 'react-native';
import { runMigrations } from '@/src/db/client';
import { syncFromServer } from '@/src/db/operations/sync';
import { initSettings, getToken, subscribeIdentity } from '@/src/config/settings';
import { LoadingScreen } from '@/src/components/LoadingScreen';
import { palette } from '@/src/utils/theme';
import { TVFocusable } from '@/src/components/TVFocusable';
import { scaleSize, scaleFont } from '@/src/utils/tvConfig';
import { SafeAreaView } from 'react-native-safe-area-context';
import { subscribeLibraryMutations } from '@/src/api/wordServerClient';

export { ErrorBoundary } from 'expo-router';

const CustomLightTheme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: palette.light.primary,
    background: palette.light.background,
    card: palette.light.card,
    text: palette.light.text,
    border: palette.light.border,
  },
};

const CustomDarkTheme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: palette.dark.primary,
    background: palette.dark.background,
    card: palette.dark.card,
    text: palette.dark.text,
    border: palette.dark.border,
  },
};

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [paired, setPaired] = useState(!!getToken());
  const [storageError, setStorageError] = useState('');

  useEffect(() => {
    if (Platform.OS === 'web' && !__DEV__ && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Offline app shell could not be cached:', error));
    }
    async function init() {
      const minDelay = new Promise<void>((r) => setTimeout(r, 2800));
      try {
        await initSettings(); setPaired(!!getToken());
      } catch (err) {
        console.warn('[Settings] Init error:', err);
      }
      try {
        await runMigrations();
      } catch (err) {
        setStorageError(err instanceof Error ? err.message : 'Local storage could not open.');
        setReady(true); return;
      }
      try {
        if (getToken()) await syncFromServer();
      } catch (err) {
        console.warn('[Sync] Failed — using cached data:', err);
        setSyncError(true);
      }
      await minDelay;
      setReady(true);
    }
    init();
    const unsubscribe = subscribeIdentity(() => setPaired(!!getToken()));
    const refresh = () => { if (getToken()) void syncFromServer().then(() => setSyncError(false)).catch(() => setSyncError(true)); };
    // A snapshot already in flight may precede the acknowledged library edit.
    const unsubscribeMutations = subscribeLibraryMutations(() => { if (getToken()) void syncFromServer().catch(() => {}).then(refresh); });
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const interval = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, 30000);
    if (Platform.OS === 'web') window.addEventListener('online', refresh);
    return () => { unsubscribe(); unsubscribeMutations(); subscription.remove(); clearInterval(interval); if (Platform.OS === 'web') window.removeEventListener('online', refresh); };
  }, []);

  const isDark = colorScheme === 'dark';

  if (!ready) {
    return <LoadingScreen />;
  }

  if (storageError) return <View style={{ padding: 32, gap: 20 }}><Text>Local storage unavailable</Text><Text>{storageError}</Text><Text>On web, use localhost or HTTPS in a current browser. Pending work requires working persistent browser storage.</Text></View>;

  return (
    <ThemeProvider value={isDark ? CustomDarkTheme : CustomLightTheme}>
      {(!paired || syncError) && <SafeAreaView edges={['top']} style={{ backgroundColor: '#FEF3C7' }}>
      {!paired && <TVFocusable onPress={() => router.push('/connection' as any)} style={{ padding: 14, backgroundColor: '#FEF3C7' }}><Text>Pair this device to sync your library and reviews</Text></TVFocusable>}
      {syncError && (
        <View style={[styles.banner, isDark && { backgroundColor: '#78350F' }]}>
          <TVFocusable onPress={() => router.push('/connection' as any)}><Text style={[styles.bannerText, isDark && { color: '#FDE68A' }]}>Could not sync — open connection and retry</Text></TVFocusable>
          <TVFocusable onPress={() => setSyncError(false)}>
            <Text style={[styles.bannerDismiss, isDark && { color: '#FDE68A' }]}>✕</Text>
          </TVFocusable>
        </View>
      )}
      </SafeAreaView>}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="ingest" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="crop" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="add-word" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="review" options={{ headerShown: false }} />
        <Stack.Screen name="words/[id]" options={{ title: '', headerBackTitle: 'Library', animation: 'none' }} />
        <Stack.Screen name="recall-setup" options={{ title: 'Start Review', headerShown: true }} />
        <Stack.Screen name="recall" options={{ title: 'Recall', headerShown: true }} />
        <Stack.Screen name="recall-summary" options={{ title: 'Session Complete', headerShown: false }} />
        <Stack.Screen name="story-setup" options={{ headerShown: false }} />
        <Stack.Screen name="story-view" options={{ headerShown: false }} />
        <Stack.Screen name="llm-stats" options={{ title: 'AI Usage', headerBackTitle: 'Settings' }} />
        <Stack.Screen name="settings-url" options={{ title: 'Backend URL', headerBackTitle: 'Settings' }} />
        <Stack.Screen name="export-words" options={{ title: 'Export Words', headerBackTitle: 'Settings' }} />
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
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
