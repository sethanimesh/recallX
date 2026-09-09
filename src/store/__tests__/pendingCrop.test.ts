import { setPendingCropUri, takePendingCropUri } from '../pendingCropUri';
import { setPendingCropResult, takePendingCropResult } from '../pendingCropResult';
import type { CropResult } from '../pendingCropResult';

const sample: CropResult = {
  uri: 'file://cropped.jpg',
  base64: 'abc123',
  mimeType: 'image/jpeg',
};

describe('pendingCropUri store', () => {
  beforeEach(() => { takePendingCropUri(); });

  it('returns null when nothing set', () => {
    expect(takePendingCropUri()).toBeNull();
  });

  it('returns the stored URI after set', () => {
    setPendingCropUri('file://photo.jpg');
    expect(takePendingCropUri()).toBe('file://photo.jpg');
  });

  it('clears after take', () => {
    setPendingCropUri('file://photo.jpg');
    takePendingCropUri();
    expect(takePendingCropUri()).toBeNull();
  });

  it('overwrites previous value', () => {
    setPendingCropUri('file://a.jpg');
    setPendingCropUri('file://b.jpg');
    expect(takePendingCropUri()).toBe('file://b.jpg');
  });
});

describe('pendingCropResult store', () => {
  beforeEach(() => { takePendingCropResult(); });

  it('returns null when nothing set', () => {
    expect(takePendingCropResult()).toBeNull();
  });

  it('returns the stored result after set', () => {
    setPendingCropResult(sample);
    expect(takePendingCropResult()).toEqual(sample);
  });

  it('clears after take', () => {
    setPendingCropResult(sample);
    takePendingCropResult();
    expect(takePendingCropResult()).toBeNull();
  });

  it('overwrites previous value', () => {
    const first: CropResult = { ...sample, uri: 'file://first.jpg' };
    const second: CropResult = { ...sample, uri: 'file://second.jpg' };
    setPendingCropResult(first);
    setPendingCropResult(second);
    expect(takePendingCropResult()).toEqual(second);
  });
});
