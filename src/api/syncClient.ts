import { getWords, getTags, type ServerWordRecord, type ServerTagRecord } from './wordServerClient';

export function fetchWordsFromServer(): Promise<ServerWordRecord[]> {
  return getWords();
}

export function fetchTagsFromServer(): Promise<ServerTagRecord[]> {
  return getTags();
}
