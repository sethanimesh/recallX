export interface ImageInput {
  type: 'image';
  uri: string;
  base64: string;
  mimeType: string;
  instructions?: string;
  originalUri?: string;
  crop?: CropMetadata;
}

export interface CropMetadata {
  originX: number; originY: number; width: number; height: number;
  originalWidth: number; originalHeight: number;
}

export interface DocumentUpload {
  type: 'image' | 'pdf';
  uri: string;
  name: string;
  mimeType: string;
  file?: Blob;
  crop?: CropMetadata;
  instructions?: string;
  extractionMode?: 'general_document' | 'vocabulary_mcq';
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
  mnemonic?: string | null;
  etymology?: string | null;
}

export interface SourceCitation {
  page_id: string; page_number: number; block_id: string;
  bbox: number[] | null; excerpt: string;
}

export interface ItemSource {
  source_id: string; filename: string; mime_type: string; sha256: string;
  size_bytes: number; created_at: number; job_id: string; candidate_id: string;
  extraction_mode: 'general_document' | 'vocabulary_mcq'; crop: CropMetadata | null;
  citations: SourceCitation[]; source_path: string;
  pages: { page_number: number; width: number; height: number; method: string;
    preview_path: string | null; metadata: Record<string, unknown> }[];
}

export interface IngestionCandidate extends ExtractedWord {
  id: string; status: 'pending' | 'accepted' | 'rejected';
  item_id: string | null; citations: SourceCitation[];
}

export interface IngestionJob {
  id: string; source_id: string; filename: string; mime_type: string;
  status: 'queued' | 'parsing' | 'extracting' | 'ready' | 'completed' | 'failed' | 'cancelled';
  stage: string; pages_done: number; pages_total: number;
  control_revision: number;
  error_code?: string | null; error_message?: string | null;
  candidates: IngestionCandidate[];
}

export interface CandidateDecision extends ExtractedWord {
  id: string; accept: boolean; tag_ids: string[]; reference_language?: string;
  reviewed?: boolean;
}

export interface ExtractionClient {
  extractWords(input: ImageInput | TextInput): Promise<ExtractedWord[]>;
}
