import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { api } from '@/src/api/centralClient';
import { readCache, writeCache } from '@/src/db/operations/central';
import { syncFromServer } from '@/src/db/operations/sync';
import { TVFocusable } from '@/src/components/TVFocusable';
import { useThemeColors } from '@/src/utils/theme';
type Status = { eligibility: Record<'recall' | 'flashcard', { eligible: boolean; outcomes: number; cards: number; successes: number; failures: number }>; jobs: Array<{ id: string; mode: string; status: string }>; parameters: Array<{ id: string; mode: string; status: string; created_at: string }> };
export default function OptimizationScreen() {
 const colors = useThemeColors(); const [status, setStatus] = useState<Status | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
 async function refresh() { try { setStatus(await api<Status>('/optimizations')); } catch (error) { setMessage(error instanceof Error ? error.message : 'Connect to view fitting status.'); } }
 useEffect(() => { void refresh(); }, []);
 async function mutate(path: string, data: Record<string, string>) { setBusy(true); try {
  const key = `fit:${path}:${JSON.stringify(data)}`; let operation = await readCache<Record<string, string>>(key);
  if (!operation) { operation = { id: Crypto.randomUUID(), ...data }; await writeCache(key, operation); }
  await api(path, operation); await writeCache(key, null); await refresh(); await syncFromServer(); setMessage('Request saved. Existing due dates remain until the next review.');
 } catch (error) { setMessage(error instanceof Error ? error.message : 'Request pending. Retry to recover its result.'); } finally { setBusy(false); } }
 return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}><Text style={[styles.title, { color: colors.text }]}>Personal scheduling parameters</Text><Text style={{ color: colors.text }}>FSRS defaults remain active until enough eligible personal history exists and a fitted candidate passes later validation.</Text><TVFocusable disabled={busy} onPress={() => void refresh()}><Text style={{ color: colors.primary }}>Refresh status</Text></TVFocusable>
  {status && (['recall', 'flashcard'] as const).map(mode => <View key={mode} style={[styles.card, { borderColor: colors.border }]}><Text style={[styles.title, { color: colors.text }]}>{mode}</Text><Text style={{ color: colors.text }}>{status.eligibility[mode].outcomes} eligible outcomes · {status.eligibility[mode].cards} cards · {status.eligibility[mode].successes} successes · {status.eligibility[mode].failures} failures</Text><Text style={{ color: colors.textSecondary }}>{status.eligibility[mode].eligible ? 'Eligible to request a fit.' : 'Insufficient data: collect at least 512 outcomes across 30 cards, including 20 successes and 20 failures.'}</Text>
  <TVFocusable disabled={busy || !status.eligibility[mode].eligible} onPress={() => void mutate('/optimizations', { mode })} style={[styles.button, { backgroundColor: colors.primary, opacity: status.eligibility[mode].eligible ? 1 : 0.5 }]}><Text style={styles.label}>Request personal fit</Text></TVFocusable>
  {status.jobs.filter(job => job.mode === mode).slice(0, 3).map(job => <Text key={job.id} style={{ color: colors.text }}>Fit: {job.status.replaceAll('_', ' ')}</Text>)}
  {status.parameters.filter(parameter => parameter.mode === mode).map(parameter => <View key={parameter.id} style={{ gap: 10 }}><Text style={{ color: colors.text }}>{parameter.id.includes('default') ? 'Default parameters' : 'Personal parameter version'} · {parameter.status}</Text>{['validated', 'previous'].includes(parameter.status) && <TVFocusable disabled={busy} onPress={() => void mutate('/optimizations/activate', { parameter_version: parameter.id })} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.label}>{parameter.status === 'previous' ? 'Restore previous parameters' : 'Activate validated parameters'}</Text></TVFocusable>}</View>)}
  </View>)}<Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text>
 </ScrollView>;
}
const styles = StyleSheet.create({ container: { padding: 28, gap: 20 }, title: { fontSize: 27, fontWeight: '700' }, card: { padding: 18, borderRadius: 12, borderWidth: 1, gap: 16 }, button: { padding: 16, borderRadius: 10 }, label: { color: '#fff', fontSize: 19 } });
