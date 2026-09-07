import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, ApiError } from '@/src/api/centralClient';
import { TVFocusable } from '@/src/components/TVFocusable';
import { fetchWordWithSource } from '@/src/db/operations/wordDetail';
import { preparePendingRequest, completePendingRequest, failPendingRequest, readCache } from '@/src/db/operations/central';
import { useThemeColors } from '@/src/utils/theme';
type Concept = { id: string; text: string; weight: number; required: boolean; accepted_alternatives: string[]; qualifiers: string[]; misconceptions: string[] };
type Rubric = { revision: number; content_revision: number; status?: string; approval_status?: string; concepts: Concept[]; reference_language: string };
type ApprovalOperation = { id: string; body: { revision: number; content_revision: number } };
type DraftOperation = { id: string; body: { concepts: Concept[]; reference_language: string; content_revision: number } };
export default function RubricScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const colors = useThemeColors();
  const [word, setWord] = useState(''); const [definition, setDefinition] = useState(''); const [contentRevision, setContentRevision] = useState(1);
  const [concepts, setConcepts] = useState<Concept[]>([]); const [language, setLanguage] = useState('en'); const [rubric, setRubric] = useState<Rubric | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [dirty, setDirty] = useState(false);
  const [pendingDraft, setPendingDraft] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalOperation | null>(null);
  const [previousDraft, setPreviousDraft] = useState<DraftOperation | null>(null);
  useEffect(() => { (async () => {
    const item = await fetchWordWithSource(id); if (!item) throw new Error('Item is unavailable.');
    setWord(item.word); setDefinition(item.definition); setContentRevision(item.content_revision ?? 1);
    const pending = await readCache<DraftOperation>(`pending_rubric:${id}`);
    setPendingApproval(await readCache<ApprovalOperation>(`pending_rubric_approval:${id}`));
    const restore = pending?.body.content_revision === (item.content_revision ?? 1);
    if (pending && !restore) setPreviousDraft(pending);
    if (restore) { setConcepts(pending.body.concepts); setLanguage(pending.body.reference_language); setPendingDraft(true); setDirty(true); setMessage('Restored an unconfirmed draft. Save retries the same request.'); }
    const versions = await api<Rubric[]>(`/items/${id}/rubrics`);
    const latest = versions.find(version => version.content_revision === (item.content_revision ?? 1));
    if (latest) { setRubric(latest); if (!restore) { setConcepts(latest.concepts); setLanguage(latest.reference_language); } }
    else if (!restore) setConcepts([{ id: 'concept-1', text: item.definition, weight: 1, required: true, accepted_alternatives: [], qualifiers: [], misconceptions: [] }]);
  })().catch(error => setMessage(error.message)); }, [id]);
  const update = (index: number, values: Partial<Concept>) => { setConcepts(previous => previous.map((concept, i) => i === index ? { ...concept, ...values } : concept)); setDirty(true); };
  async function resolvePreviousDraft() { if (!previousDraft) return; setBusy(true); try {
    await api(`/items/${id}/rubric`, { ...previousDraft.body, operation_id: previousDraft.id }, 'PUT');
    await completePendingRequest(`pending_rubric:${id}`, previousDraft.id); setPreviousDraft(null); setMessage('Previous draft request confirmed. You can now save a draft for the current definition.');
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404, 409, 410, 422].includes(error.status)) { await failPendingRequest(`pending_rubric:${id}`, previousDraft.id, error.message); setPreviousDraft(null); }
    setMessage(error instanceof Error ? error.message : 'Previous draft is still pending.');
  } finally { setBusy(false); } }
  async function save() { setBusy(true); try { const key = `pending_rubric:${id}`; const operation = await preparePendingRequest(key, { concepts, reference_language: language, content_revision: contentRevision }); setPendingDraft(true); const saved = await api<Rubric>(`/items/${id}/rubric`, { ...operation.body, operation_id: operation.id }, 'PUT'); await completePendingRequest(key, operation.id); setPendingDraft(false); setRubric(saved); setDirty(false); setMessage('Draft saved. Review it before approval.'); } catch (error) {
    if (error instanceof ApiError && [400, 403, 404, 409, 410, 422].includes(error.status)) { const pending = await readCache<{ id: string }>(`pending_rubric:${id}`); if (pending) await failPendingRequest(`pending_rubric:${id}`, pending.id, error.message); setPendingDraft(false); }
    setMessage(error instanceof Error ? error.message : 'Could not save rubric.');
  } finally { setBusy(false); } }
  async function approve(retrySaved = false) { if ((!rubric || dirty) && !retrySaved) return; setBusy(true); try {
    const key = `pending_rubric_approval:${id}`; const operation = retrySaved && pendingApproval ? pendingApproval : await preparePendingRequest(key, { revision: rubric!.revision, content_revision: contentRevision }); setPendingApproval(operation);
    await api(`/items/${id}/rubrics/${operation.body.revision}/approve`, { content_revision: operation.body.content_revision, operation_id: operation.id }); await completePendingRequest(key, operation.id);
    setPendingApproval(null); setMessage(`Rubric revision ${operation.body.revision} approved for its saved definition.`);
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404, 409, 410, 422].includes(error.status)) { const pending = await readCache<{ id: string }>(`pending_rubric_approval:${id}`); if (pending) await failPendingRequest(`pending_rubric_approval:${id}`, pending.id, error.message); setPendingApproval(null); }
    setMessage(error instanceof Error ? error.message : 'Could not approve rubric.');
  } finally { setBusy(false); } }
  const field = (label: string, value: string, change: (value: string) => void) => <View style={{ gap: 6 }}><Text style={{ color: colors.text }}>{label}</Text><TextInput multiline accessibilityLabel={label} value={value} onChangeText={change} editable={!busy && !pendingDraft && !Platform.isTV} style={[styles.input, { color: colors.text, borderColor: colors.border }]} /></View>;
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled"><Text style={[styles.title, { color: colors.text }]}>Grading rubric · {word}</Text><Text style={{ color: colors.text }}>{definition}</Text><Text style={{ color: colors.textSecondary }}>Identify the concepts a correct answer must express. Separate alternatives, qualifiers and misconceptions with semicolons. Edits need a new approval.</Text>
    {field('Reference language', language, value => { setLanguage(value); setDirty(true); })}
    {previousDraft && <><Text style={{ color: colors.text }}>An earlier draft for definition revision {previousDraft.body.content_revision} is awaiting confirmation.</Text><TVFocusable disabled={busy} onPress={() => void resolvePreviousDraft()} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.label}>Resolve previous draft request</Text></TVFocusable></>}
    {concepts.map((concept, index) => <View key={concept.id} style={[styles.concept, { borderColor: colors.border }]}>
      {field(`Concept ${index + 1}`, concept.text, text => update(index, { text }))}
      {field(`Weight ${index + 1}`, String(concept.weight), value => update(index, { weight: Number(value) }))}
      {field(`Accepted alternatives ${index + 1}`, concept.accepted_alternatives.join('; '), value => update(index, { accepted_alternatives: value.split(';').map(s => s.trim()).filter(Boolean) }))}
      {field(`Required qualifiers ${index + 1}`, concept.qualifiers.join('; '), value => update(index, { qualifiers: value.split(';').map(s => s.trim()).filter(Boolean) }))}
      {field(`Misconceptions ${index + 1}`, concept.misconceptions.join('; '), value => update(index, { misconceptions: value.split(';').map(s => s.trim()).filter(Boolean) }))}
      {!Platform.isTV && <TVFocusable disabled={busy || pendingDraft} onPress={() => update(index, { required: !concept.required })}><Text style={{ color: colors.primary }}>{concept.required ? 'Required concept' : 'Optional concept'} — toggle</Text></TVFocusable>}
    </View>)}
    {!Platform.isTV && <><TVFocusable disabled={busy || pendingDraft} onPress={() => { setConcepts(previous => [...previous, { id: `concept-${Date.now()}`, text: '', weight: 1, required: true, accepted_alternatives: [], qualifiers: [], misconceptions: [] }]); setDirty(true); }}><Text style={{ color: colors.primary }}>Add concept</Text></TVFocusable>
      <TVFocusable disabled={busy || (!dirty && !!rubric) || concepts.some(concept => !concept.text.trim() || !Number.isFinite(concept.weight) || concept.weight <= 0)} onPress={() => void save()} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.label}>Save draft</Text></TVFocusable>
      <TVFocusable disabled={busy || dirty || !rubric || !!pendingApproval} onPress={() => void approve()} style={[styles.button, { backgroundColor: colors.primary, opacity: dirty || !rubric ? 0.5 : 1 }]}><Text style={styles.label}>Approve saved rubric</Text></TVFocusable>
      {pendingApproval && <><Text style={{ color: colors.text }}>Pending approval: rubric revision {pendingApproval.body.revision}, definition revision {pendingApproval.body.content_revision}.</Text><TVFocusable disabled={busy} onPress={() => void approve(true)} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.label}>Retry saved rubric approval</Text></TVFocusable></>}
    </>}
    <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({ container: { padding: 24, gap: 18 }, title: { fontSize: 27, fontWeight: '700' }, input: { padding: 12, borderWidth: 1, borderRadius: 8, fontSize: 18 }, concept: { padding: 16, borderWidth: 1, borderRadius: 12, gap: 14 }, button: { padding: 16, borderRadius: 10 }, label: { color: '#fff', fontSize: 19 } });
