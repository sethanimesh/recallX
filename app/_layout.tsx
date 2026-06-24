import 'react-native-reanimated';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useColorScheme, View, Text, StyleSheet } from 'react-native';
import { runMigrations } from '@/src/db/client';
import { syncFromServer } from '@/src/db/operations/sync';
import { initSettings } from '@/src/config/settings';
import { LoadingScreen } from '@/src/components/LoadingScreen';
import { palette } from '@/src/utils/theme';
import { TVFocusable } from '@/src/components/TVFocusable';
import { scaleSize, scaleFont } from '@/src/utils/tvConfig';

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

  useEffect(() => {
    async function init() {
      const minDelay = new Promise<void>((r) => setTimeout(r, 2800));
      try {
        await initSettings();
      } catch (err) {
        console.warn('[Settings] Init error:', err);
      }
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
      await minDelay;
      setReady(true);
    }
    init();
  }, []);

  const isDark = colorScheme === 'dark';

  if (!ready) {
    return <LoadingScreen />;
  }

  return (
    <ThemeProvider value={isDark ? CustomDarkTheme : CustomLightTheme}>
      {syncError && (
        <View style={[styles.banner, isDark && { backgroundColor: '#78350F' }]}>
          <Text style={[styles.bannerText, isDark && { color: '#FDE68A' }]}>Could not sync — showing cached data</Text>
          <TVFocusable onPress={() => setSyncError(false)}>
            <Text style={[styles.bannerDismiss, isDark && { color: '#FDE68A' }]}>✕</Text>
          </TVFocusable>
        </View>
      )}
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
