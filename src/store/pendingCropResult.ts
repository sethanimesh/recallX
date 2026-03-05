declare const __DEV__: boolean;

export interface CropResult {
  uri: string;
  base64: string;
  mimeType: 'image/jpeg';
}

let _result: CropResult | null = null;

export function setPendingCropResult(result: CropResult): void {
  if (__DEV__ && _result !== null) {
    console.warn('[pendingCropResult] overwriting an unconsumed CropResult');
  }
  _result = result;
}

export function takePendingCropResult(): CropResult | null {
  const result = _result;
  _result = null;
  return result;
}
