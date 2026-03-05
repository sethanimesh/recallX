export interface CropResult {
  uri: string;
  base64: string;
  mimeType: 'image/jpeg';
}

let _result: CropResult | null = null;

export function setPendingCropResult(result: CropResult): void {
  _result = result;
}

export function takePendingCropResult(): CropResult | null {
  const result = _result;
  _result = null;
  return result;
}
