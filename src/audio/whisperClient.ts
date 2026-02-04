import { initWhisper, type WhisperContext } from 'whisper.rn';
import * as FileSystem from 'expo-file-system/legacy';

const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
const MODEL_FILENAME = 'ggml-base.en.bin';

let _context: WhisperContext | null = null;

export async function getWhisperContext(
  onProgress?: (ratio: number) => void,
): Promise<WhisperContext> {
  if (_context) return _context;

  if (!FileSystem.documentDirectory) {
    throw new Error('FileSystem.documentDirectory is not available on this platform');
  }

  const modelPath = `${FileSystem.documentDirectory}${MODEL_FILENAME}`;
  const { exists } = await FileSystem.getInfoAsync(modelPath);

  if (!exists) {
    const download = FileSystem.createDownloadResumable(
      MODEL_URL,
      modelPath,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        if (onProgress && totalBytesExpectedToWrite > 0) {
          onProgress(totalBytesWritten / totalBytesExpectedToWrite);
        }
      },
    );
    const result = await download.downloadAsync();
    if (!result) {
      throw new Error('Model download was cancelled or failed');
    }
  }

  _context = await initWhisper({ filePath: modelPath });
  return _context;
}

export async function releaseWhisper(): Promise<void> {
  if (_context) {
    await _context.release();
    _context = null;
  }
}
