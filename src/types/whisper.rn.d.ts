declare module 'whisper.rn' {
  export {
    WhisperContext,
    initWhisper,
    initWhisperVad,
    WhisperVadContext,
    type TranscribeOptions,
    type TranscribeResult,
    type TranscribeRealtimeEvent,
    type VadOptions,
    type VadSegment,
    type AudioSessionCategoryIos,
    type AudioSessionCategoryOptionIos,
    type AudioSessionModeIos,
  } from '../../node_modules/whisper.rn/lib/typescript/index';
}
