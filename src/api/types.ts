export interface ImageInput {
  type: 'image';
  uri: string;
  base64: string;
  mimeType: string;
  instructions?: string;
}

export interface TextInput {
  type: 'text';
  content: string;
  instructions?: string;
}

export interface ExtractedWord {
  word: string;
  definition: string;
  example_sentence: string;
}

export interface ExtractionClient {
  extractWords(input: ImageInput | TextInput): Promise<ExtractedWord[]>;
}
