import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { TVFocusable } from '@/src/components/TVFocusable';
import { useThemeColors } from '@/src/utils/theme';
import { fetchAllWords, fetchWordsByTag, type WordRow } from '@/src/db/operations/tags';
import { allOperations, enqueueReview, flushPendingReviews, getSnapshot, operationResult, readCache, writeCache, reviewContext, type ReviewContext } from '@/src/db/operations/central';
import type { Snapshot } from '@/src/api/centralClient';
import { syncFromServer } from '@/src/db/operations/sync';
import { gradeAnswer, type GradeResult } from '@/src/api/gradeClient';
import { tutorChat } from '@/src/api/tutorClient';

type ReviewKind = 'recall' | 'flashcard' | 'tutor';
type Draft = { language: 'en' | 'hi' | 'hi-Latn'; assisted: boolean; answer: string; attemptId: string | null; result: GradeResult | null; operationId: string | null; revealed: boolean; context?: ReviewContext };
const emptyDraft = (): Draft => ({ language: 'en', assisted: false, answer: '', attemptId: null, result: null, operationId: null, revealed: false });
export function CentralReviewScreen({ kind }: { kind: ReviewKind }) {
  const colors = useThemeColors(); const router = useRouter();
  const params = useLocalSearchParams<{ tagId?: string; fcMode?: string; mode?: string; todayOnly?: string; sortOrder?: string }>();
  const passive = kind === 'flashcard' && params.fcMode !== 'self-rated' && !Platform.isTV;
  const practice = kind === 'tutor' || (kind === 'recall' && params.mode === 'classic') || passive;
  const [deck, setDeck] = useState<WordRow[]>([]); const [index, setIndex] = useState(0);
  const displayedSnapshot = useRef<Snapshot | null>(null);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft()); const [saveState, setSaveState] = useState(''); const [error, setError] = useState('');
  const [due, setDue] = useState(''); const [refreshVersion, setRefreshVersion] = useState(0); const [nextDue, setNextDue] = useState('');
  const [offline, setOffline] = useState(false); const [finished, setFinished] = useState(false);
  const current = deck[index];
  const key = current ? `draft:${kind}:${current.id}:${current.content_revision ?? 1}` : '';
  useEffect(() => {
    let mounted = true; setReady(false);
    (async () => {
      try { await syncFromServer(); if (mounted) setOffline(false); } catch { if (mounted) setOffline(true); }
      const snapshot = await getSnapshot();
      displayedSnapshot.current = snapshot;
      const upcoming = snapshot?.memory_states.filter(state => state.mode === (kind === 'flashcard' ? 'flashcard' : 'recall') && new Date(state.due).getTime() > Date.now()).map(state => state.due).sort()[0];
      if (mounted) setNextDue(upcoming ?? '');
      if (!snapshot) throw new Error('Pair this device and sync the library before starting a review.');
      let rows = params.tagId ? await fetchWordsByTag(params.tagId) : await fetchAllWords();
      if (!practice) {
        const queued = await allOperations();
        const pending = new Set(queued.filter(op => op.status === 'pending').map(op => { const event = JSON.parse(op.payload); return `${event.item_id}:${event.mode}`; }));
        rows = rows.filter(word => {
          const state = snapshot.memory_states.find(state => state.item_id === word.id && state.mode === kind);
          return !pending.has(`${word.id}:${kind}`) && (!state || new Date(state.due).getTime() <= Date.now());
        });
      }
      if (params.todayOnly === 'true') { const day = new Date(); day.setHours(0, 0, 0, 0); rows = rows.filter(row => row.created_at >= day); }
      if (params.sortOrder === 'newest') rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      else if (params.sortOrder === 'jumbled') {
        for (let last = rows.length - 1; last > 0; last--) { const selected = Math.floor(Math.random() * (last + 1)); [rows[last], rows[selected]] = [rows[selected], rows[last]]; }
      }
      if (mounted) setDeck(rows);
    })().catch(error => { if (mounted) setError(error.message); }).finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, [refreshVersion]);
  useEffect(() => {
    let mounted = true;
    const context = current && displayedSnapshot.current ? reviewContext(displayedSnapshot.current, current.id, kind === 'flashcard' ? 'flashcard' : 'recall', current.content_revision) : undefined;
    setDraft({ ...emptyDraft(), context }); setSaveState(''); setDue('');
    if (!key) return;
    readCache<Draft>(key).then(async saved => {
      if (!mounted || !saved) return;
      setDraft({ ...saved, context: saved.context ?? context });
      if (saved.operationId) {
        const operation = await operationResult(saved.operationId);
        if (mounted && operation) setSaveState(operation.status);
      }
    }).catch(error => { if (mounted) setError(error.message); });
    return () => { mounted = false; };
  }, [key, deck]);
  const persist = async (next: Draft) => { await writeCache(key, next); setDraft(next); };
  async function saveReview(next: Draft, rating?: 1 | 3) {
    if (!current) return;
    next = { ...next, context: next.context ?? (displayedSnapshot.current ? reviewContext(displayedSnapshot.current, current.id, kind === 'flashcard' ? 'flashcard' : 'recall', current.content_revision) : undefined) };
    const request = await enqueueReview({ item_id: current.id, mode: kind === 'flashcard' ? 'flashcard' : 'recall', rating,
      assessment_id: next.result?.assessment_id ?? next.result?.id, revealed: kind === 'flashcard', offline, assisted: next.assisted, context: next.context, draftKey: key, draft: next });
    next = { ...next, operationId: request.id }; setDraft(next); setSaveState('pending');
    if (offline) return;
    try {
      await flushPendingReviews();
      const saved = await operationResult(request.id);
      setSaveState(saved?.status ?? 'pending');
      if (saved?.error) setError(saved.error);
      setOffline(false);
      await syncFromServer().catch(() => setOffline(true));
      const snapshot = await getSnapshot();
      setDue(snapshot?.memory_states.find(state => state.item_id === current.id && state.mode === kind)?.due ?? '');
    } catch { setOffline(true); setSaveState('pending'); }
  }
  async function submit(rating?: 1 | 3) {
    if (!current || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (draft.operationId) { await retry(); return; }
      if (kind === 'flashcard') { await saveReview(draft, rating); return; }
      if (!draft.answer.trim()) throw new Error('Enter an answer first.');
      const next = { ...draft, attemptId: draft.attemptId ?? Crypto.randomUUID(), context: draft.context ?? (displayedSnapshot.current ? reviewContext(displayedSnapshot.current, current.id, 'recall', current.content_revision) : undefined) };
      await persist(next);
      const request = { item_id: current.id, answer: next.answer, attempt_id: next.attemptId!, content_revision: current.content_revision ?? 1, language: next.language, assisted: kind === 'tutor' || next.assisted };
      const result = kind === 'tutor' ? (await tutorChat({ ...request, history: [], is_retry: false })).assessment : await gradeAnswer(request);
      const graded = { ...next, result }; await persist(graded); setOffline(false);
      if (!practice && !next.assisted && result.decision !== 'uncertain') await saveReview(graded);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save. Your draft remains available.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function retry() {
    setBusy(true); setError('');
    try {
      if (draft.operationId) {
        await flushPendingReviews();
        const operation = await operationResult(draft.operationId);
        setSaveState(operation?.status ?? 'pending'); setError(operation?.error ?? '');
      } else if (draft.result && draft.result.decision !== 'uncertain' && !practice) await saveReview(draft);
    } catch (error) { setError(error instanceof Error ? error.message : 'Still pending. Retry when connected.'); }
    finally { setBusy(false); }
  }
  async function next() {
    try { await writeCache(key, null); if (index + 1 >= deck.length) { const snapshot = await getSnapshot(); setNextDue(snapshot?.memory_states.filter(state => state.mode === kind && new Date(state.due).getTime() > Date.now()).map(state => state.due).sort()[0] ?? ''); setFinished(true); } else { setIndex(index + 1); setError(''); } }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save your progress.'); }
  }
  const button = (title: string, action: () => void, disabled = false, preferred = false) => <TVFocusable disabled={disabled || busy} hasTVPreferredFocus={preferred} onPress={action} style={[styles.button, { backgroundColor: colors.primary, opacity: disabled || busy ? 0.5 : 1 }]} accessibilityRole="button"><Text style={styles.buttonText}>{title}</Text></TVFocusable>;
  if (Platform.isTV && kind !== 'flashcard') return <View style={styles.container}><Text style={{ color: colors.text }}>Typed recall and tutor practice are available on phone and web.</Text>{button('Start self-rated review', () => router.replace('/flashcard?fcMode=self-rated' as any), false, true)}{button('Back to Library', () => router.replace('/(tabs)' as any))}</View>;
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    <Text style={[styles.heading, { color: colors.text }]}>{kind === 'tutor' ? 'Tutor practice' : passive ? 'Browse flashcards' : kind === 'recall' ? (practice ? 'Recall practice' : 'Scheduled recall') : 'Self-rated review'}</Text>
    {practice && <Text style={{ color: colors.textSecondary }}>Practice does not change your schedule.</Text>}
    {offline && <Text style={{ color: colors.textSecondary }}>Using cached cards. Self-ratings can be saved for sync. Typed answers need the server.</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text>}
    {!ready ? <ActivityIndicator /> : !current || finished ? <><Text style={[styles.body, { color: colors.text }]}>{finished ? 'Session complete. Pending reviews will sync when connected.' : error ? 'Review unavailable.' : 'No cards are due.'}</Text>{button('Library', () => router.replace('/(tabs)' as any), false, true)}{nextDue && <Text style={{ color: colors.textSecondary }}>Next confirmed review: {new Date(nextDue).toLocaleString()}</Text>}{button('Refresh due cards', () => { setIndex(0); setFinished(false); setRefreshVersion(version => version + 1); }, false, true)}{button('Connection and sync', () => router.push('/connection' as any))}</> : <>
      <Text style={{ color: colors.textSecondary }}>{index + 1} / {deck.length}</Text>
      <Text style={[styles.word, { color: colors.text }]}>{current.word}</Text>
      {kind === 'flashcard' ? <>
        {!draft.revealed ? button('Reveal answer', () => void persist({ ...draft, revealed: true }).catch(error => setError(error.message)), false, true) : <>
          <Text style={[styles.body, { color: colors.text }]}>{current.definition}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{current.example_sentence}</Text>
          {!passive && !draft.operationId && <View style={styles.row}>{button('Again — missed it', () => void submit(1), false, true)}{button('Good — remembered', () => void submit(3))}</View>}
        </>}
      </> : <>
        <View style={styles.row}>{(['en', 'hi', 'hi-Latn'] as const).map(language => <TVFocusable key={language} disabled={!!draft.result || busy} onPress={() => void persist({ ...draft, language, attemptId: null }).catch(error => setError(error.message))}><Text style={{ color: draft.language === language ? colors.primary : colors.textSecondary }}>{draft.language === language ? '● ' : ''}{language === 'en' ? 'English' : language === 'hi' ? 'Hindi' : 'Hinglish'}</Text></TVFocusable>)}</View>
        {draft.assisted && <Text style={{ color: colors.textSecondary }}>Assisted practice after feedback — your schedule will not change.</Text>}
        <TextInput accessibilityLabel="Your explanation" multiline editable={!busy && !draft.result && !draft.operationId} value={draft.answer} onChangeText={answer => {
          const next = { ...draft, answer, attemptId: null }; setDraft(next); void writeCache(key, next).catch(error => setError(error.message));
        }} placeholder="Explain the meaning in your own words" placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
        {!draft.result && button('Assess answer', () => void submit(), !draft.answer.trim())}
        {draft.result && <View style={styles.feedback}><Text style={[styles.heading, { color: colors.text }]}>{draft.result.decision}</Text><Text style={[styles.body, { color: colors.text }]}>{draft.result.feedback}</Text>
          {draft.result.experimental && <Text style={{ color: colors.textSecondary }}>Experimental assessment: calibration evidence is incomplete.</Text>}
          {(draft.result.decision === 'uncertain' || practice || draft.assisted) && button('Clarify or try another answer', () => void persist({ ...emptyDraft(), language: draft.language, assisted: true }).catch(error => setError(error.message)))}
        </View>}
      </>}
      {!!saveState && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{saveState === 'pending' ? 'Saved on this device · pending server confirmation. Due date unchanged.' : saveState === 'acknowledged' ? 'Saved to your shared history and schedule.' : saveState === 'practice' ? 'Saved as practice. Schedule unchanged.' : 'Not applied. Review the error and refresh.'}</Text>}
      {!!due && <Text style={{ color: colors.textSecondary }}>Next confirmed review: {new Date(due).toLocaleString()}</Text>}
      {(saveState === 'pending' || (!practice && !draft.assisted && draft.result && !draft.operationId && draft.result.decision !== 'uncertain')) && button('Retry save', () => void retry())}
      {(passive || !!draft.operationId || ((practice || draft.assisted) && !!draft.result)) && button(index + 1 < deck.length ? 'Next card' : 'Finish', () => void next(), false, !!draft.operationId)}
      {button('Exit review', () => router.back())}
    </>}
    {busy && <ActivityIndicator accessibilityLabel="Saving" />}
  </ScrollView>;
}
const styles = StyleSheet.create({ container: { padding: Platform.isTV ? 48 : 24, gap: 18, flexGrow: 1 }, heading: { fontSize: Platform.isTV ? 30 : 23, fontWeight: '600' }, word: { fontSize: Platform.isTV ? 48 : 34, fontWeight: '700' }, body: { fontSize: Platform.isTV ? 28 : 19, lineHeight: Platform.isTV ? 40 : 29 }, button: { borderRadius: 10, padding: 16, minHeight: 52 }, buttonText: { color: '#fff', fontSize: Platform.isTV ? 25 : 18, textAlign: 'center' }, row: { gap: 12 }, input: { borderWidth: 1, borderRadius: 12, padding: 16, minHeight: 140, fontSize: 19, textAlignVertical: 'top' }, feedback: { gap: 14 } });
