import { useRef, useState, useCallback } from 'react';
import { getWhisperContext } from './whisperClient';
import type { TranscribeRealtimeEvent } from 'whisper.rn';

export type VoiceState =
  | 'idle'
  | 'initializing'
  | 'listening'
  | 'speech_detected'
  | 'done'
  | 'error';

export function useVoiceInput() {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const stopRef = useRef<(() => void) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTextRef = useRef('');
  const isStartingRef = useRef(false);

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearDebounce();
    isStartingRef.current = false;
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
  }, [clearDebounce]);

  const reset = useCallback(() => {
    stop();
    setState('idle');
    setTranscript('');
    lastTextRef.current = '';
  }, [stop]);

  const start = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    try {
      setState('initializing');
      setTranscript('');
      lastTextRef.current = '';

      const ctx = await getWhisperContext();
      const { stop: stopFn, subscribe } = await ctx.transcribeRealtime({
        language: 'en',
        realtimeAudioSec: 30,
        realtimeAudioSliceSec: 10,
      });

      stopRef.current = stopFn;
      setState('listening');

      subscribe((evt: TranscribeRealtimeEvent) => {
        const text = (evt.data?.result ?? '').trim();

        if (text && text !== lastTextRef.current) {
          lastTextRef.current = text;
          setTranscript(text);
          setState('speech_detected');

          clearDebounce();
          debounceRef.current = setTimeout(() => {
            stopFn();
            stopRef.current = null;
            setState('done');
          }, 1500);
        }

        if (!evt.isCapturing) {
          clearDebounce();
          setState((prev) =>
            prev === 'listening' || prev === 'speech_detected' ? 'done' : prev,
          );
        }
      });
    } catch {
      isStartingRef.current = false;
      setState('error');
    }
  }, [clearDebounce]);

  return { state, transcript, start, stop, reset };
}
