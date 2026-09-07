import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, Platform, StyleSheet } from 'react-native';
import { TVFocusable } from '@/src/components/TVFocusable';
import { useThemeColors } from '@/src/utils/theme';
import { api, ApiError, type LearnerSettings } from '@/src/api/centralClient';
import { getSnapshot, preparePendingRequest, completePendingRequest, failPendingRequest, readCache } from '@/src/db/operations/central';
import { syncFromServer } from '@/src/db/operations/sync';
export default function LearningSettingsScreen() {
  const colors = useThemeColors(); const [settings, setSettings] = useState<LearnerSettings | null>(null); const [retention, setRetention] = useState('0.9'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ intent: Record<string, unknown> } | null>(null);
  useEffect(() => { void Promise.all([getSnapshot(), readCache<{ intent: Record<string, unknown> }>('pending_settings')]).then(([snapshot, pending]) => { setPending(pending); if (snapshot) { setSettings(snapshot.settings); setRetention(String(pending?.intent.desired_retention ?? snapshot.settings.desired_retention)); } }).catch(error => setMessage(error.message)); }, []);
  async function save(updates: Record<string, unknown>) { if (!settings || busy) return; setBusy(true); try { const operation = await preparePendingRequest('pending_settings', { ...updates, expected_revision: settings.revision }, updates); setPending({ intent: updates }); const saved = await api<LearnerSettings>('/settings', { ...operation.body, id: operation.id }, 'PATCH'); await completePendingRequest('pending_settings', operation.id); setPending(null); setSettings(saved); await syncFromServer(); setMessage('Settings saved across your devices.'); } catch (error) {
    if (error instanceof ApiError && [400, 403, 404, 409, 410, 422].includes(error.status)) { const saved = await readCache<{ id: string }>('pending_settings'); if (saved) await failPendingRequest('pending_settings', saved.id, error.message); setPending(null); }
    setMessage(error instanceof Error ? error.message : 'Could not save.');
  } finally { setBusy(false); } }
  return <ScrollView contentContainerStyle={styles.container} style={{ backgroundColor: colors.background }}><Text style={[styles.title, { color: colors.text }]}>Learning settings</Text>
    <Text style={{ color: colors.text }}>Desired retention controls future FSRS review intervals. It is a scheduling target, not a measured improvement in retention.</Text>
    <TextInput accessibilityLabel="Desired retention" keyboardType="decimal-pad" value={retention} onChangeText={setRetention} editable={!busy && !pending} style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
    <TVFocusable disabled={busy || !!pending} onPress={() => { const value = Number(retention); if (!Number.isFinite(value) || value < 0.7 || value > 0.99) setMessage('Choose a value from 0.70 to 0.99.'); else void save({ desired_retention: value }); }} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.label}>Save retention target</Text></TVFocusable>
    <Text style={{ color: colors.text }}>Experimental grading: {settings?.experimental_grading ? 'enabled' : 'disabled'}. Uncalibrated assessments are practice until explicitly enabled.</Text>
    {!Platform.isTV && <TVFocusable disabled={busy || !!pending} onPress={() => void save({ experimental_grading: !settings?.experimental_grading })} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.label}>{settings?.experimental_grading ? 'Disable' : 'Enable'} experimental grading</Text></TVFocusable>}
    {pending && <><Text style={{ color: colors.text }}>Pending change: {pending.intent.desired_retention !== undefined ? `retention target ${pending.intent.desired_retention}` : `experimental grading ${pending.intent.experimental_grading ? 'enabled' : 'disabled'}`}</Text><TVFocusable disabled={busy} onPress={() => void save(pending.intent)} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.label}>Retry saved settings change</Text></TVFocusable></>}
    <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({ container: { padding: 28, gap: 20 }, title: { fontSize: 28, fontWeight: '700' }, input: { fontSize: 22, padding: 14, borderWidth: 1, borderRadius: 8 }, button: { padding: 18, borderRadius: 10 }, label: { color: '#fff', fontSize: 20 } });
