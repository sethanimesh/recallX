import { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput as RNTextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { setPendingCropUri } from '@/src/store/pendingCropUri';
import { takePendingCropResult } from '@/src/store/pendingCropResult';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { activeExtractionClient } from '@/src/api/index';
import type { ImageInput, TextInput } from '@/src/api/types';
import ExtractionProgress from '@/src/components/ExtractionProgress';
import { setPendingExtraction } from '@/src/store/pendingWords';
import { getSavedInstructions, addSavedInstruction, removeSavedInstruction } from '@/src/store/savedInstructions';
import type { Tag } from '@/src/db/operations/tags';
import { useThemeColors } from '@/src/utils/theme';

const DONE_DISPLAY_MS = 600;

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
  const defaultTags: Tag[] = tagId && tagName ? [{ id: tagId, name: tagName }] : [];
  const defaultTagsRef = useRef<Tag[]>(defaultTags);
  defaultTagsRef.current = defaultTags;
  const [modalState, setModalState] = useState<ModalState>({ phase: 'idle' });
  const lastActivePhaseRef = useRef<'uploading' | 'analyzing' | 'done'>('uploading');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customInstructions, setCustomInstructions] = useState('');
  const [savedInstructions, setSavedInstructions] = useState<string[]>([]);

  useEffect(() => {
    getSavedInstructions().then(setSavedInstructions);
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
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
        });
      }
    }, [])
  );

  async function startExtraction(input: ImageInput | TextInput) {
    if (isCustomMode && customInstructions.trim()) {
      input.instructions = customInstructions.trim();
      addSavedInstruction(customInstructions).then(setSavedInstructions);
    }
    if (isMountedRef.current) setModalState({ phase: 'uploading' });
    lastActivePhaseRef.current = 'uploading';
    if (isMountedRef.current) setModalState({ phase: 'analyzing' });
    lastActivePhaseRef.current = 'analyzing';
    try {
      const extracted = await activeExtractionClient.extractWords(input);
      const sourceType = input.type === 'image' ? 'image' : 'pdf';
      const sourceUri = input.type === 'image' ? input.uri : input.content;
      setPendingExtraction({ words: extracted, sourceUri, sourceType, defaultTags: defaultTagsRef.current });
      if (isMountedRef.current) setModalState({ phase: 'done' });
      lastActivePhaseRef.current = 'done';
      timerRef.current = setTimeout(() => router.replace('/review'), DONE_DISPLAY_MS);
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
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
    if (result.canceled) return;
    await startExtraction({ type: 'text', content: result.assets[0].uri });
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
        <Ionicons name="close" size={24} color={colors.text} />
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.text }]}>Add Words</Text>

      {modalState.phase !== 'idle' ? (
        <ExtractionProgress
          phase={modalState.phase === 'error' ? 'error' : modalState.phase}
          errorMessage={modalState.phase === 'error' ? modalState.message : undefined}
          onRetry={() => setModalState({ phase: 'idle' })}
          failedAtPhase={modalState.phase === 'error' ? lastActivePhaseRef.current : undefined}
        />
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
        </View>
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
