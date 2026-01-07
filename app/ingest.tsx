import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { activeExtractionClient } from '@/src/api/index';
import type { ImageInput, TextInput } from '@/src/api/types';
import ExtractionProgress from '@/src/components/ExtractionProgress';

type ModalState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'analyzing' }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

export default function IngestScreen() {
  const [modalState, setModalState] = useState<ModalState>({ phase: 'idle' });
  const lastActivePhaseRef = useRef<'uploading' | 'analyzing' | 'done'>('uploading');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function startExtraction(input: ImageInput | TextInput) {
    if (isMountedRef.current) setModalState({ phase: 'uploading' });
    lastActivePhaseRef.current = 'uploading';
    if (isMountedRef.current) setModalState({ phase: 'analyzing' });
    lastActivePhaseRef.current = 'analyzing';
    try {
      await activeExtractionClient.extractWords(input);
      if (isMountedRef.current) setModalState({ phase: 'done' });
      lastActivePhaseRef.current = 'done';
      timerRef.current = setTimeout(() => router.back(), 800);
    } catch (err) {
      if (isMountedRef.current) setModalState({ phase: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  async function handleCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images' as const,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return;
    const b64 = result.assets[0].base64;
    const mimeType = result.assets[0].mimeType ?? 'image/jpeg';
    if (!b64) {
      Alert.alert('Error', 'Could not read image data. Please try again.');
      return;
    }
    await startExtraction({ type: 'image', uri: result.assets[0].uri, base64: b64, mimeType });
  }

  async function handleLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images' as const,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return;
    const b64 = result.assets[0].base64;
    const mimeType = result.assets[0].mimeType ?? 'image/jpeg';
    if (!b64) {
      Alert.alert('Error', 'Could not read image data. Please try again.');
      return;
    }
    await startExtraction({ type: 'image', uri: result.assets[0].uri, base64: b64, mimeType });
  }

  async function handleDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
    if (result.canceled) return;
    await startExtraction({ type: 'text', content: result.assets[0].uri });
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
        <Ionicons name="close" size={24} color="#333" />
      </TouchableOpacity>

      <Text style={styles.title}>Add Words</Text>

      {modalState.phase !== 'idle' ? (
        <ExtractionProgress
          phase={modalState.phase === 'error' ? 'error' : modalState.phase}
          errorMessage={modalState.phase === 'error' ? modalState.message : undefined}
          onRetry={() => setModalState({ phase: 'idle' })}
          failedAtPhase={modalState.phase === 'error' ? lastActivePhaseRef.current : undefined}
        />
      ) : (
        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={styles.sourceButton}
            onPress={handleCamera}
          >
            <Ionicons name="camera-outline" size={24} color="#007AFF" style={styles.icon} />
            <Text style={styles.buttonLabel}>Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sourceButton}
            onPress={handleLibrary}
          >
            <Ionicons name="image-outline" size={24} color="#007AFF" style={styles.icon} />
            <Text style={styles.buttonLabel}>Photo Library</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sourceButton}
            onPress={handleDocument}
          >
            <Ionicons name="document-outline" size={24} color="#007AFF" style={styles.icon} />
            <Text style={styles.buttonLabel}>PDF / Document</Text>
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
});
