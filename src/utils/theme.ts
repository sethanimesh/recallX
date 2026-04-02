import { useColorScheme } from 'react-native';

export const palette = {
  light: {
    primary: '#3B82F6',       // Vibrant Blue
    background: '#F3F4F6',    // Slate-100
    card: '#FFFFFF',          // Pure White
    text: '#111827',          // Slate-900
    textSecondary: '#6B7280', // Slate-500
    border: '#E5E7EB',        // Slate-200
    inputBackground: '#F9FAFB', // Slate-50
    shadow: '#000000',
    tint: '#3B82F6',
    error: '#EF4444',
    success: '#10B981',
    accent: '#EFF6FF',
    separator: '#EEF2F7',
  },
  dark: {
    primary: '#3B82F6',       // Lighter Blue/Vibrant Blue
    background: '#0F172A',    // Slate-900 (deep midnight)
    card: '#1E293B',          // Slate-800
    text: '#F8FAFC',          // Slate-50 (soft white)
    textSecondary: '#94A3B8', // Slate-400 (slate gray)
    border: '#334155',        // Slate-700
    inputBackground: '#0F172A', // Slate-900 (deep dark input)
    shadow: '#000000',
    tint: '#60A5FA',
    error: '#F87171',
    success: '#34D399',
    accent: '#1E293B',
    separator: '#334155',
  },
};

export type ThemeColors = typeof palette.light;

export function useThemeColors(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? palette.dark : palette.light;
}
