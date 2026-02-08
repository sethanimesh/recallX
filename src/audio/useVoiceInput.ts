import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

export type VoiceState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speech_detected'
  | 'transcribing'
  | 'done'
  | 'error';

const WS_URL = 'ws://localhost:8000/ws/transcribe';
const SILENCE_THRESHOLD_DBFS = -40;
const SILENCE_DEBOUNCE_MS = 1500;

export function useVoiceInput() {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechStartedRef = useRef(false);
  const isStartingRef = useRef(false);

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearDebounce();
    isStartingRef.current = false;
    speechStartedRef.current = false;
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
  }, [clearDebounce]);

  const reset = useCallback(() => {
    cleanup();
    setState('idle');
    setTranscript('');
  }, [cleanup]);

  const stop = useCallback(() => {
    cleanup();
    setState('idle');
  }, [cleanup]);

  const start = useCallback(() => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    setState('connecting');
    setTranscript('');

    (async () => {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        isStartingRef.current = false;
        setState('error');
        return;
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onerror = () => {
        cleanup();
        setState('error');
      };

      ws.onclose = () => {
        if (recordingRef.current) {
          cleanup();
          setState('error');
        }
      };

      ws.onmessage = (e: MessageEvent) => {
        const payload = JSON.parse(e.data as string) as
          | { transcript: string }
          | { error: string };
        if ('error' in payload) {
          cleanup();
          setState('error');
        } else {
          setTranscript((payload as { transcript: string }).transcript);
          cleanup();
          setState('done');
        }
      };

      ws.onopen = async () => {
        const recording = new Audio.Recording();
        recordingRef.current = recording;

        await recording.prepareToRecordAsync({
          android: {
            extension: '.m4a',
            outputFormat: 2,   // MPEG_4
            audioEncoder: 3,   // AAC
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 64000,
          },
          ios: {
            extension: '.m4a',
            audioQuality: 127, // MAX
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 64000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          isMeteringEnabled: true,
          web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
        });

        recording.setOnRecordingStatusUpdate((status) => {
          if (!status.isRecording) return;
          const db = status.metering ?? -160;

          if (db > SILENCE_THRESHOLD_DBFS) {
            if (!speechStartedRef.current) {
              speechStartedRef.current = true;
              setState('speech_detected');
            }
            clearDebounce();
            debounceRef.current = setTimeout(async () => {
              setState('transcribing');
              await recording.stopAndUnloadAsync();
              recordingRef.current = null;
              const uri = recording.getURI();
              if (!uri) {
                cleanup();
                setState('error');
                return;
              }
              const b64 = await FileSystem.readAsStringAsync(uri, {
                encoding: 'base64',
              });
              wsRef.current?.send(b64);
              wsRef.current?.send('END');
            }, SILENCE_DEBOUNCE_MS);
          }
        });

        await recording.startAsync();
        isStartingRef.current = false;
        setState('listening');
      };
    })();
  }, [clearDebounce, cleanup]);

  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  return { state, transcript, start, stop, reset };
}
