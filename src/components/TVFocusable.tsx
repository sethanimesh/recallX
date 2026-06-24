import React, { forwardRef } from 'react';
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

export interface TVFocusableProps extends PressableProps {
  children?: React.ReactNode | ((state: { pressed: boolean; focused: boolean }) => React.ReactNode);
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean; focused: boolean }) => StyleProp<ViewStyle>);
  activeOpacity?: number;
}

/**
 * TVFocusable
 * 
 * On mobile devices, this component behaves exactly like a `TouchableOpacity`.
 * On Android TV / Apple TV, it uses `Pressable` with `hasTVPreferredFocus` 
 * and applies a subtle focus scale/highlight automatically so D-Pad navigation is visible.
 */
export const TVFocusable = forwardRef<View, TVFocusableProps>(
  ({ children, style, activeOpacity = 0.7, ...props }, ref) => {
    if (!Platform.isTV) {
      // For mobile, fallback to standard TouchableOpacity for exact same behavior
      return (
        <TouchableOpacity
          ref={ref as any}
          activeOpacity={activeOpacity}
          style={style as StyleProp<ViewStyle>}
          {...props}
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
        style={(state) => [
          typeof style === 'function' ? style(state) : style,
          state.focused && styles.focusedStyle,
        ]}
      >
        {(state) => {
          return (
            <View style={[state.pressed && { opacity: activeOpacity }]}>
              {typeof children === 'function' ? children(state) : children}
            </View>
          );
        }}
      </Pressable>
    );
  }
);

TVFocusable.displayName = 'TVFocusable';

const styles = StyleSheet.create({
  focusedStyle: {
    // A subtle border or background highlight for D-Pad focus
    borderColor: '#3B82F6',
    borderWidth: 2,
    transform: [{ scale: 1.05 }],
  },
});
