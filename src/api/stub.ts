import type { ExtractionClient, ExtractedWord, ImageInput, TextInput } from './types';

const SAMPLE_WORDS: ExtractedWord[] = [
  {
    word: 'ephemeral',
    definition: 'Lasting for a very short time.',
    example_sentence: 'The ephemeral beauty of cherry blossoms draws thousands of visitors each spring.',
  },
  {
    word: 'perspicacious',
    definition: 'Having a ready insight into things; shrewd.',
    example_sentence: 'Her perspicacious analysis caught the flaw in the argument immediately.',
  },
  {
    word: 'laconic',
    definition: 'Using very few words; brief and concise.',
    example_sentence: "His laconic reply of 'no' ended the discussion.",
  },
  {
    word: 'sanguine',
    definition: 'Optimistic, especially in a difficult situation.',
    example_sentence: "Despite the setbacks, she remained sanguine about the project's success.",
  },
  {
    word: 'tenacious',
    definition: 'Not readily letting go; persistent and determined.',
    example_sentence: 'His tenacious grip on the rope saved him from falling.',
  },
];

export class StubExtractionClient implements ExtractionClient {
  async extractWords(_input: ImageInput | TextInput): Promise<ExtractedWord[]> {
    await new Promise(resolve => setTimeout(resolve, 400));
    return SAMPLE_WORDS;
  }
}
