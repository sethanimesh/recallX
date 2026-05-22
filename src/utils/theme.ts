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
    primary: '#5E99F7',       // Desaturated soft blue (prevents glowing/vibration)
    background: '#12141C',    // Soft midnight charcoal (eye-friendly neutral dark)
    card: '#1E2230',          // Muted card background
    text: '#E2E8F0',          // Slate-200 (soft off-white to eliminate high-contrast glare)
    textSecondary: '#94A3B8', // Slate-400
    border: '#2E3347',        // Subtle border
    inputBackground: '#151822', // Muted dark input field background
    shadow: '#000000',
    tint: '#60A5FA',
    error: '#F87171',
    success: '#4ADE80',       // Desaturated success green
    accent: '#1D2436',        // Soft navy-charcoal accent tint
    separator: '#2E3347',
  },
};

export type ThemeColors = typeof palette.light;

export function useThemeColors(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? palette.dark : palette.light;
}
