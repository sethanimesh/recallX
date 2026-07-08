import { useEffect } from 'react';

/**
 * Safe wrapper around useTVEventHandler that no-ops when the function
 * is not available (i.e. on standard react-native builds).
 *
 * The real useTVEventHandler is only exported by react-native-tvos.
 * Importing it from standard react-native gives `undefined`, which
 * causes a runtime crash. This wrapper detects that and skips the call.
 */

type TVEventType = {
  eventType: string;
  [key: string]: any;
};

let _useTVEventHandler: ((handler: (evt: TVEventType) => void) => void) | undefined;

try {
  // Dynamically check if react-native exports useTVEventHandler
  const RN = require('react-native');
  if (typeof RN.useTVEventHandler === 'function') {
    _useTVEventHandler = RN.useTVEventHandler;
  }
} catch {
  // Not available — will no-op
}

export function useTVEventHandlerSafe(handler: (evt: TVEventType) => void): void {
  if (_useTVEventHandler) {
    _useTVEventHandler(handler);
  }
}

export type { TVEventType };
