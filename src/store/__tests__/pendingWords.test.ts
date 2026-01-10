import { setPendingExtraction, takePendingExtraction } from '../pendingWords';
import type { PendingExtraction } from '../pendingWords';

function makeExtraction(sourceType: 'image' | 'pdf'): PendingExtraction {
  return {
    words: [
      { word: 'ephemeral', definition: 'Lasting briefly.', example_sentence: 'The joy was ephemeral.' },
    ],
    sourceUri: `file://source.${sourceType === 'pdf' ? 'pdf' : 'jpg'}`,
    sourceType,
  };
}

const sampleExtraction: PendingExtraction = {
  words: [
    { word: 'ephemeral', definition: 'Lasting briefly.', example_sentence: 'The joy was ephemeral.' },
  ],
  sourceUri: 'file://photo.jpg',
  sourceType: 'image',
};

describe('pendingWords store', () => {
  beforeEach(() => {
    // Drain any leftover state between tests
    takePendingExtraction();
  });

  it('returns null when nothing has been set', () => {
    expect(takePendingExtraction()).toBeNull();
  });

  it('returns the stored extraction after setPendingExtraction', () => {
    setPendingExtraction(sampleExtraction);
    expect(takePendingExtraction()).toEqual(sampleExtraction);
  });

  it('clears the store after take (subsequent take returns null)', () => {
    setPendingExtraction(sampleExtraction);
    takePendingExtraction();
    expect(takePendingExtraction()).toBeNull();
  });

  it('overwrites previous value when set is called twice', () => {
    const first: PendingExtraction = { ...sampleExtraction, sourceUri: 'file://first.jpg' };
    const second: PendingExtraction = { ...sampleExtraction, sourceUri: 'file://second.jpg' };
    setPendingExtraction(first);
    setPendingExtraction(second);
    expect(takePendingExtraction()).toEqual(second);
  });

  it('is reusable: set → take → set → take returns second value', () => {
    const a = makeExtraction('image');
    const b = makeExtraction('pdf');
    setPendingExtraction(a);
    takePendingExtraction();
    setPendingExtraction(b);
    expect(takePendingExtraction()).toEqual(b);
  });

  it('preserves sourceType for pdf sources', () => {
    const pdfExtraction: PendingExtraction = {
      words: sampleExtraction.words,
      sourceUri: 'file://doc.pdf',
      sourceType: 'pdf',
    };
    setPendingExtraction(pdfExtraction);
    const result = takePendingExtraction();
    expect(result?.sourceType).toBe('pdf');
  });
});
