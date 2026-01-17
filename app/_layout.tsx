// Required: must be first import for Reanimated Babel plugin
import 'react-native-reanimated';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { runMigrations } from '@/src/db/client';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    runMigrations().catch((error) => {
      console.error('[DB] Migration error:', error);
    });
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="ingest" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="add-word" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="review" options={{ headerShown: false }} />
        <Stack.Screen name="words/[id]" options={{ title: '', headerBackTitle: 'Library' }} />
      </Stack>
    </ThemeProvider>
  );
}
