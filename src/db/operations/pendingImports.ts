import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { like } from 'drizzle-orm';
import { db } from '@/src/db/client';
import { cacheRecords } from '@/src/db/schema';
import { readCache, writeCache } from './central';
import { getBackendUrl } from '@/src/config/settings';
import { uploadDocument, uploadText } from '@/src/api/ingestionClient';
import type { DocumentUpload, IngestionJob } from '@/src/api/types';

const prefix = 'pending-import:';
type DocumentPayload = Omit<DocumentUpload, 'file' | 'uri'> & { base64: string };
export type PendingImport = {
  id: string; server: string; name: string; created_at: number;
  status: 'pending' | 'acknowledged'; error?: string; job?: IngestionJob;
  document?: DocumentPayload;
  passage?: { text: string; instructions: string; extractionMode: string };
};

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not preserve the selected file.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
}
export async function queueDocumentImport(input: DocumentUpload): Promise<string> {
  let base64: string;
  if (Platform.OS === 'web') {
    const blob = input.file ?? await (await fetch(input.uri)).blob();
    if (blob.size > 20 * 1024 * 1024) throw new Error('Upload exceeds 20 MB');
    base64 = await blobBase64(blob);
  } else {
    const fs = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
    const info = await fs.getInfoAsync(input.uri);
    if (info.exists && info.size > 20 * 1024 * 1024) throw new Error('Upload exceeds 20 MB');
    base64 = await fs.readAsStringAsync(input.uri, { encoding: fs.EncodingType.Base64 });
  }
  const { file: _file, uri: _uri, ...metadata } = input;
  const operation: PendingImport = { id: Crypto.randomUUID(), server: getBackendUrl(), name: input.name, created_at: Date.now(), status: 'pending', document: { ...metadata, base64 } };
  // Keep bytes, metadata and UUID in the same durable database commit. Picker
  // cache files and browser blob URLs can disappear before a delivery retry.
  await writeCache(prefix + operation.id, operation);
  return operation.id;
}
export async function queueTextImport(text: string, instructions: string, extractionMode: string): Promise<string> {
  const operation: PendingImport = { id: Crypto.randomUUID(), server: getBackendUrl(), name: 'Pasted passage', created_at: Date.now(), status: 'pending', passage: { text, instructions, extractionMode } };
  await writeCache(prefix + operation.id, operation);
  return operation.id;
}
export async function pendingImports(): Promise<PendingImport[]> {
  return (await db.select().from(cacheRecords).where(like(cacheRecords.key, `${prefix}%`)))
    .map(row => JSON.parse(row.payload) as PendingImport)
    .filter(row => row.status === 'pending' && row.server === getBackendUrl())
    .sort((a, b) => a.created_at - b.created_at);
}
const inFlight = new Map<string, Promise<IngestionJob>>();
export function retryPendingImport(id: string): Promise<IngestionJob> {
  const existing = inFlight.get(id);
  if (existing) return existing;
  const attempt = send(id).finally(() => { inFlight.delete(id); });
  inFlight.set(id, attempt);
  return attempt;
}
async function send(id: string): Promise<IngestionJob> {
  const operation = await readCache<PendingImport>(prefix + id);
  if (!operation) throw new Error('This pending import is unavailable.');
  if (operation.server !== getBackendUrl()) throw new Error('Reconnect to the original server to retry this import.');
  if (operation.status === 'acknowledged' && operation.job) return operation.job;
  try {
    let job: IngestionJob;
    if (operation.passage) {
      const p = operation.passage;
      job = await uploadText(p.text, p.instructions, p.extractionMode, operation.id);
    } else if (operation.document) {
      const { base64, ...metadata } = operation.document;
      if (Platform.OS === 'web') {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        job = await uploadDocument({ ...metadata, uri: '', file: new Blob([bytes], { type: metadata.mimeType }) }, operation.id);
      } else {
        const fs = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
        const uri = `${fs.documentDirectory}recallx-upload-${operation.id}`;
        await fs.writeAsStringAsync(uri, base64, { encoding: fs.EncodingType.Base64 });
        try { job = await uploadDocument({ ...metadata, uri }, operation.id); }
        finally { await fs.deleteAsync(uri, { idempotent: true }).catch(() => {}); }
      }
    } else throw new Error('This pending import has no preserved content.');
    await writeCache(prefix + id, { ...operation, status: 'acknowledged', job, error: undefined, document: undefined, passage: undefined });
    return job;
  } catch (error) {
    await writeCache(prefix + id, { ...operation, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
