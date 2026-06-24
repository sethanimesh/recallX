// @ts-nocheck
import { Directory, File } from 'expo-file-system';
import {
  buildFilename,
  fetchWordsForExport,
  serializeWordsToCsv,
  serializeWordsToJson,
  type ExportFormat,
  type ExportResult,
} from './exportWords.shared';

export type { ExportFormat, ExportWordRecord, ExportResult } from './exportWords.shared';
export {
  fetchWordsForExport,
  serializeWordsToJson,
  serializeWordsToCsv,
  buildFilename,
} from './exportWords.shared';

export async function pickExportDirectory(): Promise<Directory> {
  return Directory.pickDirectoryAsync();
}

export async function saveWordsExport(
  format: ExportFormat,
  tagIds: string[] | undefined,
  directory: Directory,
  sortOrder?: 'alphabetical' | 'newest' | 'oldest',
): Promise<ExportResult> {
  const exportWords = await fetchWordsForExport(tagIds, sortOrder);
  const filename = buildFilename(format);
  const file = new File(directory, filename);
  const content = format === 'json' ? serializeWordsToJson(exportWords) : serializeWordsToCsv(exportWords);

  file.create({ overwrite: true, intermediates: true });
  file.write(content);

  return {
    uri: file.uri,
    filename,
    count: exportWords.length,
    format,
  };
}
