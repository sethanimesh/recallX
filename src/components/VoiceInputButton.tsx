import { useEffect } from 'react';
import { TouchableOpacity, View, ActivityIndicator, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { VoiceState } from '@/src/audio/useVoiceInput';

interface Props {
  state: VoiceState;
  onPress: () => void;
}

export function VoiceInputButton({ state, onPress }: Props) {
  const ringScale = useSharedValue(1);

  useEffect(() => {
    if (state === 'listening') {
      ringScale.value = withRepeat(withTiming(1.5, { duration: 800 }), -1, true);
    } else if (state === 'speech_detected') {
      ringScale.value = withRepeat(withTiming(1.5, { duration: 400 }), -1, true);
    } else {
      cancelAnimation(ringScale);
      ringScale.value = withTiming(1, { duration: 150 });
    }
  }, [state, ringScale]);

  const ringAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
  }));

  const isListening = state === 'listening' || state === 'speech_detected';
  const isError = state === 'error';

  if (state === 'initializing') {
    return (
      <View style={styles.wrapper}>
        <ActivityIndicator size="small" color="#3B82F6" />
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.wrapper}
      onPress={onPress}
      disabled={state !== 'idle'}
      activeOpacity={0.8}
      testID="voice-input-button"
    >
      <Animated.View style={[styles.ring, isListening && styles.ringActive, ringAnimStyle]} />
      <View style={[styles.button, isListening && styles.buttonActive, isError && styles.buttonError]}>
        <Ionicons
          name="mic"
          size={24}
          color={isListening ? '#fff' : isError ? '#ef4444' : '#9CA3AF'}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
    alignSelf: 'center',
  },
  ring: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  ringActive: {
    borderColor: '#3B82F6',
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: {
    backgroundColor: '#3B82F6',
  },
  buttonError: {
    backgroundColor: '#FEE2E2',
  },
});
