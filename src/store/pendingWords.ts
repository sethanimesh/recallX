import type { ExtractedWord } from '@/src/api/types';

export interface PendingExtraction {
  words: ExtractedWord[];
  sourceUri: string;
  sourceType: 'image' | 'pdf';
}

let _pending: PendingExtraction | null = null;

export function setPendingExtraction(p: PendingExtraction): void {
  _pending = p;
}

export function takePendingExtraction(): PendingExtraction | null {
  const p = _pending;
  _pending = null;
  return p;
}
