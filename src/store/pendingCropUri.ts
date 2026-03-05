let _uri: string | null = null;

export function setPendingCropUri(uri: string): void {
  _uri = uri;
}

export function takePendingCropUri(): string | null {
  const uri = _uri;
  _uri = null;
  return uri;
}
