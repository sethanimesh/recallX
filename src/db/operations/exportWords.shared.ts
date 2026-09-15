import { db } from '@/src/db/client';
import { sources, tags, words, wordTags } from '@/src/db/schema';
import { asc, eq, isNull } from 'drizzle-orm';
import { api } from '@/src/api/centralClient';

export type ExportFormat = 'json' | 'csv';

export interface ExportWordRecord {
  id: string;
  word: string;
  definition: string;
  example_sentence: string;
  created_at: string;
  updated_at: string;
  source_id: string | null;
  source_type: 'image' | 'pdf' | 'video' | null;
  tags: string[];
}

export interface ExportResult {
  uri: string;
  filename: string;
  count: number;
  format: ExportFormat;
}

interface ExportWordRow {
  id: string;
  word: string;
  definition: string;
  example_sentence: string;
  created_at: Date;
  updated_at: Date;
  source_id: string | null;
  source_type: 'image' | 'pdf' | 'video' | null;
  tag_name: string | null;
}

function normalizeTagIds(tagIds?: string[]): string[] {
  if (!tagIds || tagIds.length === 0) return [];
  return Array.from(new Set(tagIds.filter(Boolean)));
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

function buildExportWords(rows: ExportWordRow[]): ExportWordRecord[] {
  const wordsById = new Map<string, ExportWordRecord>();

  for (const row of rows) {
    const existing = wordsById.get(row.id);
    if (existing) {
      if (row.tag_name && !existing.tags.includes(row.tag_name)) {
        existing.tags.push(row.tag_name);
      }
      continue;
    }

    wordsById.set(row.id, {
      id: row.id,
      word: row.word,
      definition: row.definition,
      example_sentence: row.example_sentence,
      created_at: toIsoString(row.created_at),
      updated_at: toIsoString(row.updated_at),
      source_id: row.source_id,
      source_type: row.source_type,
      tags: row.tag_name ? [row.tag_name] : [],
    });
  }

  return Array.from(wordsById.values());
}

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeWordsToJson(exportWords: ExportWordRecord[]): string {
  return `${JSON.stringify(exportWords, null, 2)}\n`;
}

export function serializeWordsToCsv(exportWords: ExportWordRecord[]): string {
  const header = [
    'id',
    'word',
    'definition',
    'example_sentence',
    'created_at',
    'updated_at',
    'source_id',
    'source_type',
    'tags',
  ];

  const lines = exportWords.map((record) =>
    [
      record.id,
      record.word,
      record.definition,
      record.example_sentence,
      record.created_at,
      record.updated_at,
      record.source_id ?? '',
      record.source_type ?? '',
      record.tags.join('|'),
    ]
      .map((field) => escapeCsvField(field))
      .join(','),
  );

  return `${header.join(',')}\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`;
}

export function buildFilename(format: ExportFormat): string {
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  return `recallx-${format === 'json' ? 'learning-history' : 'words'}-${now}.${format}`;
}

/** JSON is an authenticated server archive; CSV remains a filtered vocabulary table. */
export async function prepareExport(format: ExportFormat, tagIds?: string[], sortOrder?: 'alphabetical' | 'newest' | 'oldest'): Promise<{ content: string; count: number }> {
  if (format === 'json') {
    const archive = await api<{ words: unknown[] }>('/export');
    return { content: `${JSON.stringify(archive, null, 2)}\n`, count: archive.words.length };
  }
  const records = await fetchWordsForExport(tagIds, sortOrder);
  return { content: serializeWordsToCsv(records), count: records.length };
}

async function fetchAllExportWordRows(): Promise<ExportWordRow[]> {
  return db
    .select({
      id: words.id,
      word: words.word,
      definition: words.definition,
      example_sentence: words.example_sentence,
      created_at: words.created_at,
      updated_at: words.updated_at,
      source_id: words.source_id,
      source_type: sources.type,
      tag_name: tags.name,
    })
    .from(words)
    .leftJoin(sources, eq(words.source_id, sources.id))
    .leftJoin(wordTags, eq(wordTags.word_id, words.id))
    .leftJoin(tags, eq(wordTags.tag_id, tags.id))
    .where(isNull(words.deleted_at))
    .orderBy(asc(words.word), asc(tags.name));
}

export async function fetchWordsForExport(
  tagIds?: string[],
  sortOrder?: 'alphabetical' | 'newest' | 'oldest',
): Promise<ExportWordRecord[]> {
  const rows = await fetchAllExportWordRows();
  let exportWords = buildExportWords(rows);

  if (tagIds && tagIds.length > 0) {
    const tagNameById = new Map(
      (await db.select({ id: tags.id, name: tags.name }).from(tags)).map((tag) => [tag.id, tag.name]),
    );
    const selectedTagNames = normalizeTagIds(tagIds)
      .map((tagId) => tagNameById.get(tagId))
      .filter((tagName): tagName is string => Boolean(tagName));

    exportWords = exportWords.filter((wordRecord) =>
      wordRecord.tags.some((tagName) => selectedTagNames.includes(tagName)),
    );
  }

  if (sortOrder === 'newest') {
    exportWords.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (sortOrder === 'oldest') {
    exportWords.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  } else {
    // default to alphabetical
    exportWords.sort((a, b) => a.word.localeCompare(b.word));
  }

  return exportWords;
}
