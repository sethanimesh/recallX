export { StubExtractionClient } from './stub';
export { HttpExtractionClient } from './http';
export type { ExtractionClient, ExtractedWord, ImageInput, TextInput } from './types';

import { StubExtractionClient } from './stub';

export const activeExtractionClient = new StubExtractionClient();
