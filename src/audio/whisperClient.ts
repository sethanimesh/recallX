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
    await download.downloadAsync();
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
