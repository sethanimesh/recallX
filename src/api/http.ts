import type { ExtractionClient, ExtractedWord, ImageInput, TextInput } from './types';

export class HttpExtractionClient implements ExtractionClient {
  constructor(private readonly baseUrl: string) {}

  async extractWords(_input: ImageInput | TextInput): Promise<ExtractedWord[]> {
    throw new Error('not implemented');
  }
}
