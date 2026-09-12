import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { getBackendUrl, getCommonHeaders } from '@/src/config/settings';
import { approveIngestion, correctSourceBlock, getIngestionDraft, getIngestionJob, getIngestionPage, ingestionUrl, saveIngestionDraft, type ReviewDraft } from '@/src/api/ingestionClient';
import type { CandidateDecision, IngestionJob } from '@/src/api/types';
import { getAllTags, type Tag } from '@/src/db/operations/tags';
import { syncFromServer } from '@/src/db/operations/sync';
import { readCache, writeCache, preparePendingRequest, completePendingRequest } from '@/src/db/operations/central';
import { ExtractionError } from '@/src/api/http';
import TagPickerSheet from '@/src/components/TagPickerSheet';
import { useThemeColors } from '@/src/utils/theme';

export default function IngestionReviewScreen({ jobId, defaultTag }: { jobId: string; defaultTag?: Tag }) {
  const colors = useThemeColors();
  const key = `recallx:import-draft:${getBackendUrl()}:${jobId}`;
  const approvalKey = `import-approval:${getBackendUrl()}:${jobId}`;
  const [submitted, setSubmitted] = useState<{ id: string; body: { candidates: CandidateDecision[]; expected_draft_revision: number } } | null>(null);
  const remoteRevision = useRef(0);
  const [job, setJob] = useState<IngestionJob | null>(null);
  const [draft, setDraft] = useState<ReviewDraft>({ candidates: [] });
  const latest = useRef(draft);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [previewWidth, setPreviewWidth] = useState(300);
  const [sourceCorrection, setSourceCorrection] = useState<string | null>(null);
  const [sourceRevision, setSourceRevision] = useState(1);
  const writes = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    Promise.all([getIngestionJob(jobId), getIngestionDraft(jobId), AsyncStorage.getItem(key), getAllTags(), readCache<{ id: string; body: { candidates: CandidateDecision[]; expected_draft_revision: number } }>(approvalKey)]).then(([loaded, remote, localText, knownTags, pendingApproval]) => {
      if (!active) return;
      setSubmitted(pendingApproval);
      remoteRevision.current = remote.revision ?? 0;
      if (pendingApproval) { setJob(loaded); setTags(knownTags); return; }
      if (loaded.status === 'completed') { router.dismissAll(); return; }
      if (loaded.status !== 'ready') throw new Error('This import is not ready. Resume it from Add Words.');
      setJob(loaded);
      setTags(knownTags);
      const local = localText ? JSON.parse(localText) as ReviewDraft : null;
      const saved = local && (local.revision ?? 0) === (remote.revision ?? 0) && (local.updated_at ?? 0) > (remote.updated_at ?? 0) ? local : remote;
      if (local && (local.revision ?? 0) !== (remote.revision ?? 0)) {
        void AsyncStorage.setItem(`${key}:conflict:${Date.now()}`, localText!);
        setError('This draft changed on another device. The shared draft is shown; your previous draft was preserved locally.');
      }
      const byId = new Map(saved.candidates.map(c => [c.id, c]));
      const loadedDraft: ReviewDraft = {
        request_id: saved.request_id ?? Crypto.randomUUID(),
        revision: remoteRevision.current,
        candidates: loaded.candidates.filter(c => c.status === 'pending').map(c => byId.get(c.id) ?? {
          id: c.id, word: c.word, definition: c.definition, example_sentence: c.example_sentence,
          mnemonic: c.mnemonic, etymology: c.etymology, accept: false, reviewed: false,
          tag_ids: defaultTag ? [defaultTag.id] : [], reference_language: 'en',
        }),
      };
      latest.current = loadedDraft;
      setDraft(loadedDraft);
      const next = loadedDraft.candidates.findIndex(c => !c.reviewed);
      setIndex(next < 0 ? Math.max(0, loadedDraft.candidates.length - 1) : next);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [jobId, key]);

  const current = draft.candidates[index];
  const candidate = job?.candidates.find(c => c.id === current?.id);
  const citation = candidate?.citations[0];
  useEffect(() => { setSourceCorrection(null); }, [current?.id]);
  useEffect(() => {
    setPreview(null);
    if (!citation) return;
    let active = true;
    let objectUrl: string | undefined;
    const path = `/jobs/${jobId}/pages/${citation.page_number}/preview`;
    (async () => {
      const page = await getIngestionPage(jobId, citation.page_number);
      if (page.width <= 0 || page.height <= 0) return;
      let uri = ingestionUrl(path);
      if (Platform.OS === 'web') {
        const response = await fetch(uri, { headers: getCommonHeaders() });
        if (!response.ok) throw new Error('Preview unavailable');
        objectUrl = URL.createObjectURL(await response.blob());
        uri = objectUrl;
      }
      if (active) setPreview({ uri, width: page.width, height: page.height });
    })().catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [jobId, citation?.page_number]);

  function persist(next: ReviewDraft, remote = false) {
    next = { ...next, updated_at: Date.now() };
    latest.current = next;
    setDraft(next);
    // Serialize writes so a slow earlier keystroke cannot overwrite a newer edit.
    writes.current = writes.current.catch(() => {}).then(async () => {
      await AsyncStorage.setItem(key, JSON.stringify({ ...next, revision: remoteRevision.current }));
      if (remote) {
        const result = await saveIngestionDraft(jobId, { ...next, revision: remoteRevision.current });
        remoteRevision.current = result.revision;
        latest.current = { ...latest.current, revision: result.revision };
        await AsyncStorage.setItem(key, JSON.stringify(latest.current));
      }
    });
    return writes.current;
  }

  function edit(field: keyof CandidateDecision, value: unknown) {
    const next = { ...latest.current, candidates: latest.current.candidates.map((c, i) => i === index ? { ...c, [field]: value } : c) };
    void persist(next).catch(e => setError(String(e)));
  }

  async function decide(accept: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    const next = { ...latest.current, candidates: latest.current.candidates.map((c, i) => i === index ? { ...c, accept, reviewed: true } : c) };
    try {
      await persist(next, true);
      const unfinished = next.candidates.findIndex((c, i) => i > index && !c.reviewed);
      if (unfinished >= 0) setIndex(unfinished);
      else if (index < next.candidates.length - 1) setIndex(index + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function finish() {
    setBusy(true);
    setError('');
    let operation = submitted;
    try {
      await writes.current;
      operation = submitted ?? await preparePendingRequest(approvalKey, { candidates: latest.current.candidates, expected_draft_revision: remoteRevision.current });
      setSubmitted(operation);
      await approveIngestion(jobId, operation.id, operation.body.candidates, operation.body.expected_draft_revision);
      await completePendingRequest(approvalKey, operation.id);
      await AsyncStorage.removeItem(key);
      await syncFromServer();
      // Preserve the existing dismiss-all navigation after successful import.
      router.dismissAll();
    } catch (e) {
      if (operation && e instanceof ExtractionError && [400, 404, 409, 422].includes(e.statusCode)) {
        await writeCache(`${approvalKey}:failed:${operation.id}`, { ...operation, status: 'failed', error: e.message });
        await completePendingRequest(approvalKey, operation.id);
        setSubmitted(null);
      }
      setError(e instanceof Error ? e.message : String(e));
    }
    finally { setBusy(false); }
  }

  if (submitted) return <SafeAreaView style={{ flex: 1, padding: 24, backgroundColor: colors.background }}>
    <Text style={{ color: colors.text, fontSize: 22 }}>Approval awaiting acknowledgment</Text>
    <Text style={{ color: colors.textSecondary }}>Your submitted choices are saved. Retry the same approval to confirm the result before editing further.</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text>}
    <TouchableOpacity disabled={busy} onPress={finish} style={{ padding: 16 }}><Text style={{ color: colors.primary }}>{busy ? 'Confirming…' : 'Retry saved approval'}</Text></TouchableOpacity>
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 16 }}><Text style={{ color: colors.primary }}>Back</Text></TouchableOpacity>
  </SafeAreaView>;

  if (!job || !current) return <SafeAreaView style={{ flex: 1, padding: 24, backgroundColor: colors.background }}>
    {error ? <Text style={{ color: colors.error }}>{error}</Text> : <ActivityIndicator />}
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 16 }}><Text style={{ color: colors.primary }}>Back</Text></TouchableOpacity>
  </SafeAreaView>;

  const allReviewed = draft.candidates.every(c => c.reviewed);
  const selectedTags = tags.filter(t => current.tag_ids.includes(t.id));
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: '700' }}>Review imported words</Text>
      <Text style={{ color: colors.textSecondary }}>{index + 1} of {draft.candidates.length} · {job.filename}</Text>
      <Text style={{ color: colors.textSecondary }}>Correct each definition before accepting. Grading rubrics remain drafts until you approve them in the word details.</Text>
      <Text style={{ color: colors.text }}>Definition language</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([{ id: 'en', label: 'English' }, { id: 'hi', label: 'Hindi' }, { id: 'hi-Latn', label: 'Romanized Hindi' }]).map(language => <TouchableOpacity key={language.id} onPress={() => edit('reference_language', language.id)} style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: current.reference_language === language.id ? colors.primary : colors.border }}><Text style={{ color: colors.text }}>{language.label}</Text></TouchableOpacity>)}
      </View>
      {(['word', 'definition', 'example_sentence', 'mnemonic', 'etymology'] as const).map(field => <View key={field}>
        <Text style={{ color: colors.text, marginBottom: 6 }}>{field === 'example_sentence' ? 'Example sentence' : field[0].toUpperCase() + field.slice(1)}</Text>
        <TextInput accessibilityLabel={`Edit ${field}`} value={current[field] ?? ''} multiline={field !== 'word'}
          onChangeText={value => edit(field, value)} onBlur={() => { void persist(latest.current, true).catch(e => setError(String(e))); }}
          style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12, minHeight: field === 'definition' ? 90 : 44 }} />
      </View>)}
      <TouchableOpacity onPress={() => setPicker(true)} style={{ padding: 14, borderColor: colors.border, borderWidth: 1, borderRadius: 8 }}>
        <Text style={{ color: colors.primary }}>{selectedTags.length ? selectedTags.map(t => t.name).join(', ') : 'Add tags'}</Text>
      </TouchableOpacity>
      {citation && <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>Source · page {citation.page_number}</Text>
        <Text selectable style={{ color: colors.textSecondary }}>{citation.excerpt}</Text>
        {preview && <View onLayout={e => setPreviewWidth(e.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: preview.width / preview.height }}>
          <Image source={{ uri: preview.uri, headers: getCommonHeaders() }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
          {citation.bbox && <View pointerEvents="none" style={{ position: 'absolute', borderWidth: 2, borderColor: colors.primary, backgroundColor: `${colors.primary}22`, left: citation.bbox[0] / preview.width * previewWidth, top: citation.bbox[1] / preview.width * previewWidth, width: (citation.bbox[2] - citation.bbox[0]) / preview.width * previewWidth, height: (citation.bbox[3] - citation.bbox[1]) / preview.width * previewWidth }} />}
        </View>}
        <Text style={{ color: colors.textSecondary }}>Highlighted passage supplied the extraction context; verify that it supports the edited definition.</Text>
        {sourceCorrection === null ? <TouchableOpacity onPress={async () => {
          try {
            const response = await fetch(ingestionUrl(`/jobs/${jobId}/pages/${citation.page_number}`), { headers: getCommonHeaders() });
            if (!response.ok) throw new Error('Could not load the full source block');
            const page = await response.json();
            const block = page.blocks.find((b: { id: string }) => b.id === citation.block_id);
            setSourceCorrection(block?.text ?? citation.excerpt);
            setSourceRevision(block?.revision ?? 1);
          } catch (e) { setError(String(e)); }
        }}><Text style={{ color: colors.primary }}>Correct source text</Text></TouchableOpacity> : <>
          <TextInput accessibilityLabel="Correct OCR source text" multiline value={sourceCorrection} onChangeText={setSourceCorrection} style={{ borderColor: colors.border, borderWidth: 1, color: colors.text, padding: 12 }} />
          <Text style={{ color: colors.textSecondary }}>Saving a source correction regenerates this import's candidates. Your current candidate edits will be replaced.</Text>
          <TouchableOpacity disabled={busy} onPress={async () => {
            setBusy(true);
            try { await writes.current; await correctSourceBlock(jobId, citation.block_id, sourceCorrection, sourceRevision); await AsyncStorage.removeItem(key); router.back(); }
            catch (e) { setError(String(e)); }
            finally { setBusy(false); }
          }}><Text style={{ color: colors.primary }}>Save source correction and regenerate</Text></TouchableOpacity>
        </>}
      </View>}
      {!!error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <TouchableOpacity disabled={busy} onPress={() => decide(false)} style={{ flex: 1, padding: 16, backgroundColor: colors.error, borderRadius: 8 }}><Text style={{ color: '#fff', textAlign: 'center' }}>Reject</Text></TouchableOpacity>
        <TouchableOpacity disabled={busy} onPress={() => decide(true)} style={{ flex: 1, padding: 16, backgroundColor: colors.success, borderRadius: 8 }}><Text style={{ color: '#fff', textAlign: 'center' }}>Accept</Text></TouchableOpacity>
      </View>
      {allReviewed && <TouchableOpacity disabled={busy} onPress={finish} style={{ padding: 16, backgroundColor: colors.primary, borderRadius: 8 }}><Text style={{ color: '#fff', textAlign: 'center' }}>{busy ? 'Saving…' : `Save ${draft.candidates.filter(c => c.accept).length} accepted words`}</Text></TouchableOpacity>}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <TouchableOpacity disabled={busy || index === 0} onPress={() => setIndex(i => i - 1)} style={{ padding: 14 }}><Text style={{ color: colors.primary }}>Previous</Text></TouchableOpacity>
        <TouchableOpacity disabled={busy || index === draft.candidates.length - 1} onPress={() => setIndex(i => i + 1)} style={{ padding: 14 }}><Text style={{ color: colors.primary }}>Next</Text></TouchableOpacity>
      </View>
      <TouchableOpacity disabled={busy} onPress={() => { persist(latest.current, true).then(() => router.back()).catch(e => setError(String(e))); }} style={{ padding: 16 }}><Text style={{ color: colors.primary, textAlign: 'center' }}>Save draft and leave</Text></TouchableOpacity>
    </ScrollView>
    <TagPickerSheet currentTags={selectedTags} visible={picker} onClose={() => setPicker(false)} onTagsChanged={next => { setTags(previous => [...previous.filter(t => !next.some(n => n.id === t.id)), ...next]); edit('tag_ids', next.map(t => t.id)); }} />
  </SafeAreaView>;
}
