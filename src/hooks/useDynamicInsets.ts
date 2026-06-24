import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * A custom hook that normalizes safe area insets across platforms.
 * On Android, the status bar is often much shorter than the iOS notch.
 * This adds extra padding on Android to give headers consistent visual breathing room.
 */
export function useDynamicInsets() {
  const insets = useSafeAreaInsets();
  
  return {
    ...insets,
    // Add extra padding to Android to match iOS notch height visually.
    // iOS notch is typically ~44-59. Android status bar is ~24.
    // We ensure the top is at least 44 on Android to prevent cramped headers.
    top: Platform.OS === 'android' ? Math.max(insets.top + 16, 44) : insets.top,
  };
}
