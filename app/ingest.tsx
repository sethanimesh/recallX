import { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput as RNTextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { setPendingCropUri } from '@/src/store/pendingCropUri';
import { takePendingCropResult } from '@/src/store/pendingCropResult';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { DocumentUpload, ImageInput, IngestionJob } from '@/src/api/types';
import { listIngestionJobs, getIngestionJob, retryIngestionJob, cancelIngestionJob } from '@/src/api/ingestionClient';
import { queueDocumentImport, queueTextImport, retryPendingImport, pendingImports, type PendingImport } from '@/src/db/operations/pendingImports';
import ExtractionProgress from '@/src/components/ExtractionProgress';
import { getSavedInstructions, addSavedInstruction, removeSavedInstruction } from '@/src/store/savedInstructions';
import type { Tag } from '@/src/db/operations/tags';
import { useThemeColors } from '@/src/utils/theme';

type ModalState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'analyzing' }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}


export default function IngestScreen() {
  const params = useLocalSearchParams<{ tagId?: string | string[]; tagName?: string | string[] }>();
  const colors = useThemeColors();
  const tagId = firstParam(params.tagId)?.trim();
  const tagName = firstParam(params.tagName)?.trim();
  const [modalState, setModalState] = useState<ModalState>({ phase: 'idle' });
  const lastActivePhaseRef = useRef<'uploading' | 'analyzing' | 'done'>('uploading');
  const isMountedRef = useRef(true);
  
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customInstructions, setCustomInstructions] = useState('');
  const [savedInstructions, setSavedInstructions] = useState<string[]>([]);
  const [job, setJob] = useState<IngestionJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<IngestionJob[]>([]);
  const [uploads, setUploads] = useState<PendingImport[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [extractionMode, setExtractionMode] = useState<'general_document' | 'vocabulary_mcq'>('general_document');

  const openReview = useCallback((id: string) => {
    router.push({ pathname: '/review', params: { jobId: id, ...(tagId ? { tagId, tagName: tagName ?? '' } : {}) } });
  }, [tagId, tagName]);

  useFocusEffect(useCallback(() => {
    listIngestionJobs().then(setRecentJobs).catch(() => {});
    pendingImports().then(setUploads).catch(() => {});
  }, []));

  useEffect(() => {
    if (!job || !['queued', 'parsing', 'extracting'].includes(job.status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getIngestionJob(job.id);
        if (!active) return;
        setJob(next);
        if (next.status === 'ready') {
          setModalState({ phase: 'idle' });
          openReview(next.id);
          return;
        }
        if (next.status === 'failed') {
          setModalState({ phase: 'error', message: next.error_message ?? 'Import failed' });
          return;
        }
        if (next.status === 'completed' || next.status === 'cancelled') {
          setModalState({ phase: 'idle' });
          return;
        }
      } catch { /* Server state survives a lost connection; keep polling. */ }
      if (active) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [job?.id, job?.status, openReview]);

  useEffect(() => {
    getSavedInstructions().then(setSavedInstructions);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Use a ref to always call the latest startExtraction, avoiding stale closures in useFocusEffect
  const startExtractionRef = useRef<typeof startExtraction | null>(null);
  startExtractionRef.current = startExtraction;

  useFocusEffect(
    useCallback(() => {
      const cropResult = takePendingCropResult();
      if (cropResult && startExtractionRef.current) {
        startExtractionRef.current({
          type: 'image',
          uri: cropResult.uri,
          base64: cropResult.base64,
          mimeType: cropResult.mimeType,
          originalUri: cropResult.originalUri,
          crop: cropResult.crop,
        });
      }
    }, [])
  );

  async function startExtraction(input: ImageInput | DocumentUpload) {
    if (isCustomMode && customInstructions.trim()) {
      input.instructions = customInstructions.trim();
      addSavedInstruction(customInstructions).then(setSavedInstructions);
    }
    if (isMountedRef.current) setModalState({ phase: 'uploading' });
    lastActivePhaseRef.current = 'uploading';
    try {
      const upload: DocumentUpload = 'name' in input ? input : {
        type: 'image', uri: input.originalUri ?? input.uri, name: 'photo.jpg',
        mimeType: input.mimeType, instructions: input.instructions, crop: input.crop,
      };
      const id = await queueDocumentImport({ ...upload, extractionMode });
      setUploadId(id);
      const created = await retryPendingImport(id);
      setUploadId(null);
      setUploads(await pendingImports());
      if (isMountedRef.current) {
        setJob(created);
        setModalState({ phase: 'analyzing' });
        lastActivePhaseRef.current = 'analyzing';
      }
    } catch (err) {
      if (isMountedRef.current)
        setModalState({ phase: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  async function handleCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images' as const,
      quality: 0.8,
    });
    if (result.canceled) return;
    setPendingCropUri(result.assets[0].uri);
    router.push('/crop');
  }

  async function handleLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images' as const,
      quality: 0.8,
    });
    if (result.canceled) return;
    setPendingCropUri(result.assets[0].uri);
    router.push('/crop');
  }

  async function handleDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    await startExtraction({ type: 'pdf', uri: asset.uri, name: asset.name, mimeType: 'application/pdf', file: asset.file });
  }

  async function resumeImport(id: string) {
    try {
      const current = await getIngestionJob(id);
      if (current.status === 'ready') { openReview(id); return; }
      if (current.status === 'completed') { Alert.alert('Import complete', 'This import has no remaining candidates.'); setRecentJobs(await listIngestionJobs()); return; }
      if (current.status === 'failed' || current.status === 'cancelled') {
        setJob(await retryIngestionJob(id, current.control_revision));
      } else { setJob(current); }
      setModalState({ phase: 'analyzing' });
    } catch (error) { Alert.alert('Import unavailable', error instanceof Error ? error.message : 'Please try again.'); }
  }

  async function resumeUpload(id: string) {
    setUploadId(id); setJob(null); setModalState({ phase: 'uploading' });
    try {
      const created = await retryPendingImport(id);
      setUploadId(null); setUploads(await pendingImports()); setJob(created);
      if (created.status === 'ready') { setModalState({ phase: 'idle' }); openReview(created.id); }
      else setModalState({ phase: 'analyzing' });
    } catch (error) { setModalState({ phase: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
        <Ionicons name="close" size={24} color={colors.text} />
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.text }]}>Add Words</Text>
      {modalState.phase === 'idle' && <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
        {(['general_document', 'vocabulary_mcq'] as const).map(mode => <TouchableOpacity key={mode} onPress={() => setExtractionMode(mode)} style={{ padding: 10, borderWidth: 1, borderRadius: 8, borderColor: extractionMode === mode ? colors.primary : colors.border }}><Text style={{ color: colors.text }}>{mode === 'general_document' ? 'Document' : 'Vocabulary MCQ'}</Text></TouchableOpacity>)}
      </View>}

      {modalState.phase !== 'idle' ? (
        <View>
        <ExtractionProgress
          phase={modalState.phase === 'error' ? 'error' : modalState.phase}
          errorMessage={modalState.phase === 'error' ? modalState.message : undefined}
          onRetry={() => uploadId ? resumeUpload(uploadId) : job ? resumeImport(job.id) : setModalState({ phase: 'idle' })}
          failedAtPhase={modalState.phase === 'error' ? lastActivePhaseRef.current : undefined}
        />
        {job && <>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text, marginVertical: 12 }}>
            {job.status === 'queued' ? 'Queued on your Mac' : `${job.pages_done} of ${job.pages_total} pages parsed · ${job.stage.split(':')[0]}`}
          </Text>
          <Text style={{ color: colors.textSecondary }}>You can leave this screen. Resume the import from Add Words on any paired device.</Text>
          <TouchableOpacity onPress={() => cancelIngestionJob(job.id, job.control_revision).then(next => { setJob(next); setModalState({ phase: 'idle' }); }).catch(error => Alert.alert('Could not cancel', String(error)))} style={{ padding: 16 }}>
            <Text style={{ color: colors.error }}>Cancel import</Text>
          </TouchableOpacity>
        </>}
        </View>
      ) : textMode ? (
        <View style={{ gap: 12 }}>
          <RNTextInput accessibilityLabel="Pasted document text" multiline value={pastedText} onChangeText={setPastedText} placeholder="Paste a passage to import" placeholderTextColor={colors.textSecondary} style={[styles.input, { minHeight: 160, color: colors.text, borderColor: colors.border }]} />
          <TouchableOpacity disabled={!pastedText.trim()} onPress={async () => {
            setModalState({ phase: 'uploading' });
            try { const id = await queueTextImport(pastedText, customInstructions, extractionMode); await resumeUpload(id); }
            catch (e) { setModalState({ phase: 'error', message: e instanceof Error ? e.message : String(e) }); }
          }} style={[styles.sourceButton, { backgroundColor: colors.inputBackground }]}><Text style={{ color: colors.primary }}>Import passage</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setTextMode(false)} style={{ padding: 12 }}><Text style={{ color: colors.primary }}>Choose another source</Text></TouchableOpacity>
        </View>
      ) : isCustomMode ? (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <TouchableOpacity onPress={() => setIsCustomMode(false)} style={{ marginRight: 12 }}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>Custom Instructions</Text>
          </View>

          <RNTextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
            placeholder="e.g. Use the bold words"
            placeholderTextColor={colors.text + '80'}
            value={customInstructions}
            onChangeText={setCustomInstructions}
            multiline
          />

          {savedInstructions.length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 }}>Saved Instructions</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {savedInstructions.map((inst, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.savedChip, { backgroundColor: colors.primary + '20' }]}
                    onPress={() => setCustomInstructions(inst)}
                  >
                    <Text style={{ color: colors.primary, marginRight: 4 }}>{inst}</Text>
                    <TouchableOpacity onPress={() => removeSavedInstruction(inst).then(setSavedInstructions)}>
                      <Ionicons name="close-circle" size={16} color={colors.primary} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 12, marginTop: 8 }}>
            Choose Source
          </Text>

          <View style={styles.buttonGroup}>
            <TouchableOpacity
              style={[styles.sourceButton, { backgroundColor: colors.inputBackground }]}
              onPress={handleCamera}
            >
              <Ionicons name="camera-outline" size={24} color={colors.primary} style={styles.icon} />
              <Text style={[styles.buttonLabel, { color: colors.text }]}>Camera</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sourceButton, { backgroundColor: colors.inputBackground }]}
              onPress={handleLibrary}
            >
              <Ionicons name="image-outline" size={24} color={colors.primary} style={styles.icon} />
              <Text style={[styles.buttonLabel, { color: colors.text }]}>Photo Library</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sourceButton, { backgroundColor: colors.inputBackground }]}
              onPress={handleDocument}
            >
              <Ionicons name="document-outline" size={24} color={colors.primary} style={styles.icon} />
              <Text style={[styles.buttonLabel, { color: colors.text }]}>PDF / Document</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={[styles.sourceButton, { backgroundColor: colors.inputBackground }]}
            onPress={handleCamera}
          >
            <Ionicons name="camera-outline" size={24} color={colors.primary} style={styles.icon} />
            <Text style={[styles.buttonLabel, { color: colors.text }]}>Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sourceButton, { backgroundColor: colors.inputBackground }]}
            onPress={handleLibrary}
          >
            <Ionicons name="image-outline" size={24} color={colors.primary} style={styles.icon} />
            <Text style={[styles.buttonLabel, { color: colors.text }]}>Photo Library</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sourceButton, { backgroundColor: colors.inputBackground }]}
            onPress={handleDocument}
          >
            <Ionicons name="document-outline" size={24} color={colors.primary} style={styles.icon} />
            <Text style={[styles.buttonLabel, { color: colors.text }]}>PDF / Document</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sourceButton, { backgroundColor: colors.inputBackground }]}
            onPress={() => {
              if (tagId && tagName) {
                router.push({ pathname: '/add-word', params: { tagId, tagName } });
                return;
              }
              router.push('/add-word');
            }}
          >
            <Ionicons name="pencil-outline" size={24} color={colors.primary} style={styles.icon} />
            <Text style={[styles.buttonLabel, { color: colors.text }]}>Add Manually</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sourceButton, { backgroundColor: colors.inputBackground }]}
            onPress={() => setIsCustomMode(true)}
          >
            <Ionicons name="color-wand-outline" size={24} color={colors.primary} style={styles.icon} />
            <Text style={[styles.buttonLabel, { color: colors.text }]}>Custom Extraction</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.sourceButton, { backgroundColor: colors.inputBackground }]} onPress={() => setTextMode(true)}>
            <Ionicons name="clipboard-outline" size={24} color={colors.primary} style={styles.icon} />
            <Text style={[styles.buttonLabel, { color: colors.text }]}>Paste text</Text>
          </TouchableOpacity>
        </View>
      )}
      {modalState.phase === 'idle' && uploads.length > 0 && <View style={{ marginTop: 16 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>Uploads awaiting acknowledgment</Text>
        {uploads.map(upload => <TouchableOpacity key={upload.id} onPress={() => resumeUpload(upload.id)} style={{ paddingVertical: 12 }}>
          <Text style={{ color: colors.primary }}>{upload.name} — retry saved upload</Text>
          {!!upload.error && <Text style={{ color: colors.textSecondary }}>{upload.error}</Text>}
        </TouchableOpacity>)}
      </View>}
      {modalState.phase === 'idle' && recentJobs.some(j => j.status !== 'completed') && (
        <ScrollView style={{ maxHeight: 220, marginTop: 16 }}>
          <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 8 }}>Resume imports</Text>
          {recentJobs.filter(j => j.status !== 'completed').map(j => (
            <TouchableOpacity key={j.id} onPress={() => resumeImport(j.id)} style={{ paddingVertical: 12 }}>
              <Text style={{ color: colors.primary }}>{j.filename}</Text>
              <Text style={{ color: colors.textSecondary }}>{j.status === 'ready' ? 'Ready to review' : j.status === 'failed' ? 'Failed — tap to retry' : j.status === 'cancelled' ? 'Cancelled — tap to resume' : `${j.pages_done}/${j.pages_total} pages · ${j.status}`}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
    padding: 24,
  },
  closeButton: {
    alignSelf: 'flex-end',
    padding: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 32,
  },
  buttonGroup: {
    gap: 16,
  },
  sourceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
  },
  icon: {
    marginRight: 12,
  },
  buttonLabel: {
    fontSize: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    minHeight: 100,
    fontSize: 16,
    marginBottom: 24,
    textAlignVertical: 'top',
  },
  savedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
});
