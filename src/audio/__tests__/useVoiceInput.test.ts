jest.mock('expo-av', () => ({
  Audio: {
    requestPermissionsAsync: jest.fn(),
    setAudioModeAsync: jest.fn(),
    Recording: jest.fn(),
  },
}));

jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));

import { renderHook, act } from '@testing-library/react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { useVoiceInput } from '../useVoiceInput';

const mockRequestPermissions = Audio.requestPermissionsAsync as jest.Mock;
const mockSetAudioMode = Audio.setAudioModeAsync as jest.Mock;
const MockRecording = Audio.Recording as unknown as jest.Mock;
const mockReadFile = FileSystem.readAsStringAsync as jest.Mock;

// Minimal WebSocket mock
class MockWebSocket {
  static lastInstance: MockWebSocket;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn();
  constructor(_url: string) {
    MockWebSocket.lastInstance = this;
  }
}

function makeRecordingInstance() {
  let _statusCb: ((s: any) => void) | null = null;
  return {
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    startAsync: jest.fn().mockResolvedValue(undefined),
    stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
    getURI: jest.fn().mockReturnValue('file:///tmp/test.m4a'),
    setOnRecordingStatusUpdate: jest.fn((cb) => { _statusCb = cb; }),
    _emitStatus: (metering: number) => _statusCb?.({ isRecording: true, metering }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (global as any).WebSocket = MockWebSocket;
  mockRequestPermissions.mockResolvedValue({ granted: true });
  mockSetAudioMode.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useVoiceInput', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.state).toBe('idle');
    expect(result.current.transcript).toBe('');
  });

  it('transitions idle → connecting → listening on start()', async () => {
    const rec = makeRecordingInstance();
    MockRecording.mockImplementation(() => rec);
    mockReadFile.mockResolvedValue('base64data');

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => { result.current.start(); });
    expect(result.current.state).toBe('connecting');

    await act(async () => { MockWebSocket.lastInstance.onopen?.(); });
    expect(result.current.state).toBe('listening');
  });

  it('transitions to speech_detected when metering rises above threshold', async () => {
    const rec = makeRecordingInstance();
    MockRecording.mockImplementation(() => rec);

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });
    await act(async () => { MockWebSocket.lastInstance.onopen?.(); });

    act(() => { rec._emitStatus(-60); }); // below threshold — still listening
    expect(result.current.state).toBe('listening');

    act(() => { rec._emitStatus(-20); }); // above threshold — speech detected
    expect(result.current.state).toBe('speech_detected');
  });

  it('transitions to transcribing after 1.5s silence post-speech', async () => {
    const rec = makeRecordingInstance();
    MockRecording.mockImplementation(() => rec);
    mockReadFile.mockResolvedValue('base64data');

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });
    await act(async () => { MockWebSocket.lastInstance.onopen?.(); });

    act(() => { rec._emitStatus(-20); }); // speech
    await act(async () => { jest.advanceTimersByTime(1500); });

    expect(result.current.state).toBe('transcribing');
    expect(MockWebSocket.lastInstance.send).toHaveBeenCalledWith('base64data');
    expect(MockWebSocket.lastInstance.send).toHaveBeenCalledWith('END');
  });

  it('transitions to done when server returns transcript', async () => {
    const rec = makeRecordingInstance();
    MockRecording.mockImplementation(() => rec);
    mockReadFile.mockResolvedValue('base64data');

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });
    await act(async () => { MockWebSocket.lastInstance.onopen?.(); });
    act(() => { rec._emitStatus(-20); });
    await act(async () => { jest.advanceTimersByTime(1500); });

    await act(async () => {
      MockWebSocket.lastInstance.onmessage?.({ data: JSON.stringify({ transcript: 'eloquent' }) });
    });

    expect(result.current.state).toBe('done');
    expect(result.current.transcript).toBe('eloquent');
  });

  it('transitions to error when server returns error payload', async () => {
    const rec = makeRecordingInstance();
    MockRecording.mockImplementation(() => rec);
    mockReadFile.mockResolvedValue('base64data');

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });
    await act(async () => { MockWebSocket.lastInstance.onopen?.(); });
    act(() => { rec._emitStatus(-20); });
    await act(async () => { jest.advanceTimersByTime(1500); });

    await act(async () => {
      MockWebSocket.lastInstance.onmessage?.({ data: JSON.stringify({ error: 'transcription_failed' }) });
    });

    expect(result.current.state).toBe('error');
  });

  it('transitions to error on WebSocket open failure', async () => {
    const rec = makeRecordingInstance();
    MockRecording.mockImplementation(() => rec);

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });

    await act(async () => {
      MockWebSocket.lastInstance.onerror?.(new Event('error'));
    });

    expect(result.current.state).toBe('error');
  });

  it('transitions to error when mic permission denied', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: false });

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });

    expect(result.current.state).toBe('error');
  });

  it('reset() returns to idle from any state', async () => {
    const rec = makeRecordingInstance();
    MockRecording.mockImplementation(() => rec);
    mockReadFile.mockResolvedValue('base64data');

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });
    await act(async () => { MockWebSocket.lastInstance.onopen?.(); });
    act(() => { rec._emitStatus(-20); });
    await act(async () => { jest.advanceTimersByTime(1500); });
    await act(async () => {
      MockWebSocket.lastInstance.onmessage?.({ data: JSON.stringify({ transcript: 'hello' }) });
    });
    expect(result.current.state).toBe('done');

    act(() => { result.current.reset(); });
    expect(result.current.state).toBe('idle');
    expect(result.current.transcript).toBe('');
  });
});
