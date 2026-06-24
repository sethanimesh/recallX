import React, { forwardRef, useState, useCallback } from 'react';
import {
  Platform,
  Pressable,
  PressableProps,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
  StyleProp,
  View,
} from 'react-native';

export interface TVFocusableProps extends Omit<PressableProps, 'children' | 'style' | 'delayLongPress'> {
  children?: React.ReactNode | ((state: { pressed: boolean; focused: boolean }) => React.ReactNode);
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean; focused: boolean }) => StyleProp<ViewStyle>);
  activeOpacity?: number;
  delayLongPress?: number;
  hasTVPreferredFocus?: boolean;
  nextFocusUp?: number | undefined;
  nextFocusDown?: number | undefined;
  nextFocusLeft?: number | undefined;
  nextFocusRight?: number | undefined;
}

/**
 * TVFocusable
 * 
 * On mobile devices, this component behaves exactly like a `TouchableOpacity`.
 * On Android TV / Apple TV, it uses `Pressable` with `hasTVPreferredFocus` 
 * and applies a subtle focus scale/highlight automatically so D-Pad navigation is visible.
 */
export const TVFocusable = forwardRef<View, TVFocusableProps>(
  ({ children, style, activeOpacity = 0.7, hasTVPreferredFocus, nextFocusUp, nextFocusDown, nextFocusLeft, nextFocusRight, onFocus, onBlur, ...props }, ref) => {
    const [isTVFocused, setIsTVFocused] = useState(false);

    const handleFocus = useCallback((e: any) => {
      setIsTVFocused(true);
      onFocus?.(e);
    }, [onFocus]);

    const handleBlur = useCallback((e: any) => {
      setIsTVFocused(false);
      onBlur?.(e);
    }, [onBlur]);

    if (!Platform.isTV) {
      // For mobile, fallback to standard TouchableOpacity for exact same behavior
      return (
        <TouchableOpacity
          ref={ref as any}
          activeOpacity={activeOpacity}
          style={style as StyleProp<ViewStyle>}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...(props as any)}
        >
          {typeof children === 'function' ? children({ pressed: false, focused: false }) : children}
        </TouchableOpacity>
      );
    }

    // For TV, use Pressable to handle `focused` state
    return (
      <Pressable
        ref={ref}
        {...props}
        focusable={true}
        accessible={true}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...(() => {
          const tvProps: any = {};
          if (hasTVPreferredFocus !== undefined) tvProps.hasTVPreferredFocus = hasTVPreferredFocus;
          if (nextFocusUp !== undefined) tvProps.nextFocusUp = nextFocusUp;
          if (nextFocusDown !== undefined) tvProps.nextFocusDown = nextFocusDown;
          if (nextFocusLeft !== undefined) tvProps.nextFocusLeft = nextFocusLeft;
          if (nextFocusRight !== undefined) tvProps.nextFocusRight = nextFocusRight;
          return tvProps;
        })()}
        style={(state: any) => {
          const focused = state.focused || isTVFocused;
          return [
            { borderWidth: 3, borderColor: 'transparent', borderRadius: 8 }, // Base style to prevent layout shift
            typeof style === 'function' ? style({ ...state, focused }) : style,
            focused && styles.focusedStyle,
            state.pressed && { opacity: activeOpacity },
          ];
        }}
      >
        {(state: any) => {
          const focused = state.focused || isTVFocused;
          return typeof children === 'function' ? children({ ...state, focused }) : children;
        }}
      </Pressable>
    );
  }
);

TVFocusable.displayName = 'TVFocusable';

const styles = StyleSheet.create({
  focusedStyle: {
    // A visible border + glow highlight for D-Pad focus at 10ft viewing distance
    borderColor: '#60A5FA',
    borderWidth: 3,
    borderRadius: 8,
    transform: [{ scale: 1.06 }],
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
});
