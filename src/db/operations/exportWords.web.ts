import {
  buildFilename,
  prepareExport,
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

// On the web, users don't need to select directories. We return a mock object.
export async function pickExportDirectory(): Promise<any> {
  return { uri: 'downloads' };
}

export async function saveWordsExport(
  format: ExportFormat,
  tagIds: string[] | undefined,
  directory: any, // Ignored on Web
  sortOrder?: 'alphabetical' | 'newest' | 'oldest',
): Promise<ExportResult> {
  const { content, count } = await prepareExport(format, tagIds, sortOrder);
  const filename = buildFilename(format);

  // Create standard browser blob and download link
  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return {
    uri: 'Browser Downloads',
    filename,
    count,
    format,
  };
}
