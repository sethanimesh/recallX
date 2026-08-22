import { useRef } from 'react';
import { Platform } from 'react-native';
import { useTVEventHandlerSafe } from './useTVEventHandlerSafe';
export type DpadEventType = 'left' | 'right' | 'up' | 'down' | 'select';
export interface DpadEvent { eventType: DpadEventType; keyCode?: number }
/** Select remains owned by focused Pressables. The official TV runtime is the
 * only native event source, avoiding custom dispatch plus native double actions. */
export function useDpadNavigation(handler: (event: DpadEvent) => void): void {
  const callback = useRef(handler); callback.current = handler;
  useTVEventHandlerSafe(event => {
    if (!Platform.isTV || event.eventType === 'select') return;
    if (event.eventKeyAction !== undefined && event.eventKeyAction !== 1) return;
    if (['left', 'right', 'up', 'down'].includes(event.eventType)) callback.current({ eventType: event.eventType as DpadEventType });
  });
}
