import type { ExtractedWord } from '@/src/api/types';
import type { Tag } from '@/src/db/operations/tags';

declare const __DEV__: boolean;

export interface PendingExtraction {
  words: ExtractedWord[];
  sourceUri: string;
  sourceType: 'image' | 'pdf';
  defaultTags?: Tag[];
}

let _pending: PendingExtraction | null = null;

export function setPendingExtraction(p: PendingExtraction): void {
  if (__DEV__ && _pending !== null) {
    console.warn('[pendingWords] overwriting an unconsumed PendingExtraction');
  }
  _pending = p;
}

export function takePendingExtraction(): PendingExtraction | null {
  const p = _pending;
  _pending = null;
  return p;
}
