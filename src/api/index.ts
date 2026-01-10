export { StubExtractionClient } from './stub';
export { HttpExtractionClient, ExtractionError } from './http';
export type { ExtractionClient, ExtractedWord, ImageInput, TextInput } from './types';

import { HttpExtractionClient } from './http';

export const activeExtractionClient = new HttpExtractionClient();
