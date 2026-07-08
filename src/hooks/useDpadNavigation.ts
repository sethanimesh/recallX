import { useEffect, useRef } from 'react';
import { Platform, DeviceEventEmitter } from 'react-native';

/**
 * D-pad event types emitted by the native withTVKeyEvents config plugin.
 * Maps to Android KeyEvent codes:
 *   left   → KEYCODE_DPAD_LEFT
 *   right  → KEYCODE_DPAD_RIGHT
 *   up     → KEYCODE_DPAD_UP
 *   down   → KEYCODE_DPAD_DOWN
 *   select → KEYCODE_DPAD_CENTER / KEYCODE_ENTER
 */
export type DpadEventType = 'left' | 'right' | 'up' | 'down' | 'select';

export interface DpadEvent {
  eventType: DpadEventType;
  keyCode: number;
}

/**
 * Hook to listen for global D-pad key events on Android TV.
 *
 * On non-TV platforms (iPhone, Android phone) this is a complete no-op —
 * no listeners are registered and no native code runs.
 *
 * Usage:
 * ```ts
 * useDpadNavigation((evt) => {
 *   if (evt.eventType === 'right') goNext();
 *   if (evt.eventType === 'left')  goPrev();
 * });
 * ```
 */
export function useDpadNavigation(
  handler: (event: DpadEvent) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    // Only subscribe on TV platforms — complete no-op on phones
    if (!Platform.isTV) return;

    const subscription = DeviceEventEmitter.addListener(
      'onTVKeyEvent',
      (event: DpadEvent) => {
        handlerRef.current(event);
      },
    );

    return () => {
      subscription.remove();
    };
  }, []);
}
