declare const __DEV__: boolean;

let _uri: string | null = null;

export function setPendingCropUri(uri: string): void {
  if (__DEV__ && _uri !== null) {
    console.warn('[pendingCropUri] overwriting an unconsumed URI');
  }
  _uri = uri;
}

export function takePendingCropUri(): string | null {
  const uri = _uri;
  _uri = null;
  return uri;
}
