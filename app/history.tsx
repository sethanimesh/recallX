import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, TextInput, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { api, type Snapshot } from '@/src/api/centralClient';
import { getSnapshot, readCache, writeCache } from '@/src/db/operations/central';
import { syncFromServer } from '@/src/db/operations/sync';
import { TVFocusable } from '@/src/components/TVFocusable';
import { useThemeColors } from '@/src/utils/theme';
export default function HistoryScreen() {
 const colors = useThemeColors(); const { id } = useLocalSearchParams<{ id?: string }>();
 const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [message, setMessage] = useState(''); const [selected, setSelected] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
 const [pendingCorrection, setPendingCorrection] = useState<{ id: string; rating: 1 | 3 | null; reason: string } | null>(null);
 const selectedRef = useRef('');
 const actionLock = useRef(false);
 async function refresh() { try { await syncFromServer(); } catch { setMessage('Showing the last confirmed history.'); } setSnapshot(await getSnapshot()); }
 useEffect(() => { void refresh(); }, []);
 async function correct(rating: 1 | 3 | null) {
  if (!selected || !reason.trim() || actionLock.current) return; actionLock.current = true; setBusy(true);
  try {
   const key = `correction:${selected}`;
   let operation = await readCache<{ id: string; rating: 1 | 3 | null; reason: string }>(key);
   if (!operation) { operation = { id: Crypto.randomUUID(), rating, reason: reason.trim() }; await writeCache(key, operation); }
   setPendingCorrection(operation);
   if (operation.rating !== rating || operation.reason !== reason.trim()) { setReason(operation.reason); throw new Error('A different correction is already pending. Review the saved rating and reason below, then retry that correction.'); }
   await api(`/reviews/${selected}/corrections`, operation); await writeCache(key, null); setPendingCorrection(null); setSelected(''); setReason(''); await refresh(); setMessage('Correction saved. The server replayed the affected schedule.');
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Correction pending. Retry with the same choice.'); } finally { actionLock.current = false; setBusy(false); }
 }
 const reviews = [...(snapshot?.reviews ?? [])].filter(review => !id || review.item_id === id).sort((a, b) => b.answered_at.localeCompare(a.answered_at));
 return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}><Text style={[styles.title, { color: colors.text }]}>Shared review history</Text><Text style={{ color: colors.textSecondary }}>{reviews.length} confirmed attempts · schedules and corrections are managed by your server.</Text><TVFocusable onPress={() => void refresh()}><Text style={{ color: colors.primary }}>Refresh history</Text></TVFocusable><Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text>
  {reviews.map(review => <View key={review.id} style={[styles.card, { borderColor: colors.border }]}><Text style={[styles.name, { color: colors.text }]}>{snapshot?.words.find(word => word.id === review.item_id)?.word ?? 'Archived item'}</Text><Text style={{ color: colors.text }}>{review.mode} · {review.status === 'practice' ? 'practice' : review.rating === 1 ? 'Again' : review.rating === 3 ? 'Good' : 'Unrated'} · {new Date(review.answered_at).toLocaleString()}</Text>{review.reason && <Text style={{ color: colors.textSecondary }}>{review.reason}</Text>}
   {!Platform.isTV && review.status === 'acknowledged' && <TVFocusable onPress={() => { selectedRef.current = review.id; setSelected(review.id); setPendingCorrection(null); setReason(''); void readCache<{ id: string; rating: 1 | 3 | null; reason: string }>(`correction:${review.id}`).then(pending => { if (selectedRef.current !== review.id) return; setPendingCorrection(pending); if (pending) setReason(pending.reason); }).catch(error => setMessage(error.message)); }}><Text style={{ color: colors.primary }}>Correct this review</Text></TVFocusable>}
   {selected === review.id && <><TextInput accessibilityLabel="Correction reason" value={reason} onChangeText={setReason} editable={!busy && !pendingCorrection} placeholder="Why should this review change?" placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
   <Text style={{ color: colors.textSecondary }}>The original event stays in history; the correction changes its scheduling effect.</Text>
   {pendingCorrection ? <><Text style={{ color: colors.text }}>Saved correction: {pendingCorrection.rating === 1 ? 'Again' : pendingCorrection.rating === 3 ? 'Good' : 'Exclude from scheduling'} · {pendingCorrection.reason}</Text><TVFocusable disabled={busy} onPress={() => void correct(pendingCorrection.rating)} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={{ color: '#fff', fontSize: 18 }}>Retry saved correction</Text></TVFocusable></> : ([[1, 'Again'], [3, 'Good'], [null, 'Exclude from scheduling']] as const).map(([rating, label]) => <TVFocusable key={label} disabled={busy || !reason.trim()} onPress={() => void correct(rating)} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={{ color: '#fff', fontSize: 18 }}>{label}</Text></TVFocusable>)}</>}
  </View>)}
 </ScrollView>;
}
const styles = StyleSheet.create({ container: { padding: 28, gap: 18 }, title: { fontSize: 28, fontWeight: '700' }, name: { fontSize: 23, fontWeight: '600' }, card: { borderWidth: 1, borderRadius: 12, padding: 18, gap: 12 }, input: { padding: 12, borderWidth: 1, borderRadius: 8 }, button: { padding: 14, borderRadius: 8 } });
