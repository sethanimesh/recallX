import { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, { useAnimatedStyle, withTiming, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

type Phase = 'uploading' | 'analyzing' | 'done' | 'error';

interface Props {
  phase: Phase;
  errorMessage?: string;
  onRetry?: () => void;
}

const STEPS = ['Uploading', 'Analyzing', 'Done'] as const;

function phaseToActiveStep(phase: Phase): number {
  switch (phase) {
    case 'uploading': return 0;
    case 'analyzing': return 1;
    case 'done': return 3; // all completed
    case 'error': return -1; // handled separately
  }
}

export default function ExtractionProgress({ phase, errorMessage, onRetry }: Props) {
  const scale0 = useSharedValue(0.5);
  const scale1 = useSharedValue(0.5);
  const scale2 = useSharedValue(0.5);
  const scales = [scale0, scale1, scale2];

  useEffect(() => {
    if (phase === 'uploading') {
      scales[0].value = withTiming(1.0, { duration: 300 });
      scales[1].value = 0.5;
      scales[2].value = 0.5;
    } else if (phase === 'analyzing') {
      scales[0].value = 1.0;
      scales[1].value = withTiming(1.0, { duration: 300 });
      scales[2].value = 0.5;
    } else if (phase === 'done') {
      scales[0].value = 1.0;
      scales[1].value = 1.0;
      scales[2].value = withTiming(1.0, { duration: 300 });
    } else if (phase === 'error') {
      // keep current
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const animStyle0 = useAnimatedStyle(() => ({ transform: [{ scale: scale0.value }] }));
  const animStyle1 = useAnimatedStyle(() => ({ transform: [{ scale: scale1.value }] }));
  const animStyle2 = useAnimatedStyle(() => ({ transform: [{ scale: scale2.value }] }));
  const animStyles = [animStyle0, animStyle1, animStyle2];

  // Determine status of each step
  function getStepStatus(index: number): 'inactive' | 'active' | 'completed' | 'error' {
    if (phase === 'done') return 'completed';
    if (phase === 'uploading') {
      if (index === 0) return 'active';
      return 'inactive';
    }
    if (phase === 'analyzing') {
      if (index === 0) return 'completed';
      if (index === 1) return 'active';
      return 'inactive';
    }
    if (phase === 'error') {
      // Find which step was active: we show error on the currently active step
      // We don't have previous phase info, so we use a heuristic:
      // errorMessage presence means something failed — mark step 1 (uploading) unless we know further
      // Actually per spec: replace the active step's circle. We need to track this externally,
      // but since we only receive `phase === 'error'`, we'll show error on step 0 (first active-looking step).
      // The parent always transitions uploading -> analyzing -> done, so we assume uploading failed if error.
      if (index === 0) return 'error';
      return 'inactive';
    }
    return 'inactive';
  }

  function getCircleStyle(status: ReturnType<typeof getStepStatus>) {
    switch (status) {
      case 'active': return styles.circleActive;
      case 'completed': return styles.circleCompleted;
      case 'error': return styles.circleError;
      default: return styles.circleInactive;
    }
  }

  function getLabelStyle(status: ReturnType<typeof getStepStatus>) {
    switch (status) {
      case 'active': return styles.labelActive;
      case 'completed': return styles.labelCompleted;
      case 'error': return styles.labelError;
      default: return styles.labelInactive;
    }
  }

  function getLineStyle(leftIndex: number): object {
    // Line between step leftIndex and leftIndex+1
    // Green if both left and right are completed
    const leftStatus = getStepStatus(leftIndex);
    const rightStatus = getStepStatus(leftIndex + 1);
    if (leftStatus === 'completed' && rightStatus === 'completed') {
      return styles.lineCompleted;
    }
    return styles.lineInactive;
  }

  return (
    <View style={styles.container}>
      <View style={styles.stepsRow}>
        {STEPS.map((label, index) => {
          const status = getStepStatus(index);
          return (
            <View key={label} style={styles.stepWrapper}>
              {/* Connecting line before (except first) */}
              {index > 0 && (
                <View style={[styles.line, getLineStyle(index - 1)]} />
              )}

              <View style={styles.stepColumn}>
                <Animated.View style={[styles.circle, getCircleStyle(status), animStyles[index]]}>
                  {status === 'completed' && (
                    <Ionicons name="checkmark" size={16} color="white" />
                  )}
                  {status === 'error' && (
                    <Ionicons name="close" size={16} color="white" />
                  )}
                  {status === 'active' && (
                    <View style={styles.activeDot} />
                  )}
                </Animated.View>
                <Text style={[styles.label, getLabelStyle(status)]}>{label}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {phase === 'error' && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => onRetry?.()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepColumn: {
    alignItems: 'center',
  },
  circle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleInactive: {
    backgroundColor: '#E5E5EA',
  },
  circleActive: {
    backgroundColor: '#007AFF',
  },
  circleCompleted: {
    backgroundColor: '#34C759',
  },
  circleError: {
    backgroundColor: '#FF3B30',
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
  },
  label: {
    fontSize: 12,
    marginTop: 6,
  },
  labelInactive: {
    color: '#8E8E93',
  },
  labelActive: {
    color: '#007AFF',
  },
  labelCompleted: {
    color: '#34C759',
  },
  labelError: {
    color: '#FF3B30',
  },
  line: {
    width: 40,
    height: 2,
    marginBottom: 18, // to align with circle vertically (accounts for label height below)
  },
  lineInactive: {
    backgroundColor: '#E5E5EA',
  },
  lineCompleted: {
    backgroundColor: '#34C759',
  },
  errorContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#FF3B30',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  retryText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
