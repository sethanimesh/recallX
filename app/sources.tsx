import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Directory, File } from 'expo-file-system';
import { getItemSources } from '@/src/api/ingestionClient';
import type { ItemSource as Source } from '@/src/api/types';
import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';
import { TVFocusable } from '@/src/components/TVFocusable';
import { useThemeColors } from '@/src/utils/theme';

const sourceUrl = (path: string) => `${getBackendUrl().replace(/\/$/, '')}${path}`;

function SourcePreview({ page }: { page: Source['pages'][number] }) {
  const [uri, setUri] = useState<string | null>(null); const [error, setError] = useState('');
  useEffect(() => {
    if (!page.preview_path) return;
    if (Platform.OS !== 'web') { setUri(sourceUrl(page.preview_path)); return; }
    let mounted = true; let objectUrl: string | undefined; const controller = new AbortController();
    fetch(sourceUrl(page.preview_path), { headers: getCommonHeaders(), signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Source preview unavailable. Reconnect and try again.');
      objectUrl = URL.createObjectURL(await response.blob()); if (mounted) setUri(objectUrl);
    }).catch(error => { if (mounted) setError(error.message); });
    return () => { mounted = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [page.preview_path]);
  if (error) return <Text>{error}</Text>;
  return uri ? <Image accessibilityLabel={`Source page ${page.page_number}`} source={{ uri, headers: getCommonHeaders() }} style={{ width: '100%', aspectRatio: page.width / page.height || 1 }} resizeMode="contain" onError={() => setError('Source preview unavailable. Reconnect and try again.')} /> : <ActivityIndicator />;
}

export default function SourcesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const colors = useThemeColors();
  const [sources, setSources] = useState<Source[]>([]); const [ready, setReady] = useState(false); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { getItemSources(id).then(result => setSources(result.sources)).catch(error => setMessage(error.message)).finally(() => setReady(true)); }, [id]);
  async function download(source: Source) {
    if (busy) return; setBusy(true); setMessage('');
    try {
      if (Platform.OS === 'web') {
        const response = await fetch(sourceUrl(source.source_path), { headers: getCommonHeaders() });
        if (!response.ok) throw new Error('Could not download the source. Check your connection.');
        const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
        link.href = url; link.download = source.filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage('Original source saved to Downloads.');
      } else {
        const directory = await Directory.pickDirectoryAsync();
        await File.downloadFileAsync(sourceUrl(source.source_path), new File(directory.uri, `${source.source_id}-${source.filename.replace(/[^\w. -]/g, '_')}`), { headers: getCommonHeaders() });
        setMessage('Original source saved to the folder you selected.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the source.'); }
    finally { setBusy(false); }
  }
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
    <Text style={[styles.heading, { color: colors.text }]}>Source evidence</Text>
    <Text style={{ color: colors.textSecondary }}>Original documents and cited passages are retained on your server after import approval.</Text>
    {!ready && <ActivityIndicator />}
    {ready && sources.length === 0 && !message && <Text style={{ color: colors.text }}>This item has no retained import source. It may have been added manually or imported before source retention was available.</Text>}
    {!!message && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text>}
    {sources.map(source => <View key={source.source_id} style={[styles.card, { borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>{source.filename}</Text>
      <Text style={{ color: colors.textSecondary }}>{source.extraction_mode} · {source.mime_type} · {source.size_bytes.toLocaleString()} bytes</Text>
      {source.citations.map((citation, index) => <View key={index} style={styles.citation}><Text style={{ color: colors.textSecondary }}>Page {citation.page_number}{citation.block_id ? ` · ${citation.block_id}` : ''}</Text><Text selectable style={{ color: colors.text }}>{citation.excerpt ?? 'See the cited source page.'}</Text></View>)}
      {source.pages.filter(page => !!page.preview_path && page.width > 0 && page.height > 0).map(page => <View key={page.page_number}><TVFocusable onPress={() => setPreview(preview === `${source.source_id}:${page.page_number}` ? null : `${source.source_id}:${page.page_number}`)} style={styles.button}><Text style={{ color: colors.primary }}>View page {page.page_number} · {page.method}</Text></TVFocusable>{preview === `${source.source_id}:${page.page_number}` && <SourcePreview page={page} />}</View>)}
      {!Platform.isTV && <TVFocusable disabled={busy} onPress={() => void download(source)} style={styles.button}><Text style={{ color: colors.primary }}>Save original source</Text></TVFocusable>}
      <Text selectable style={{ color: colors.textSecondary }}>Source fingerprint: {source.sha256}</Text>
    </View>)}
  </ScrollView>;
}
const styles = StyleSheet.create({ container: { padding: 24, gap: 20 }, heading: { fontSize: 28, fontWeight: '700' }, title: { fontSize: 22, fontWeight: '600' }, card: { borderWidth: 1, borderRadius: 12, padding: 18, gap: 16 }, citation: { gap: 6 }, button: { paddingVertical: 14, minHeight: 48 } });
