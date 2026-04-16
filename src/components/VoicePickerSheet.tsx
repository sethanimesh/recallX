import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';

import { useThemeColors } from '@/src/utils/theme';
import { isFemaleVoice } from '@/src/utils/speech';

interface Props {
  visible: boolean;
  onClose: () => void;
  selectedVoiceId: string | null;
  onSelectVoice: (voiceId: string | null) => void;
}

export default function VoicePickerSheet({
  visible,
  onClose,
  selectedVoiceId,
  onSelectVoice,
}: Props) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const footerBottomPadding = insets.bottom + 16;

  const [loading, setLoading] = useState(false);
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);

  // Load available voices
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    async function fetchVoices() {
      try {
        const list = await Speech.getAvailableVoicesAsync();
        // Filter English-only voices and sort them alphabetically
        const englishList = list
          .filter((v) => v.language && v.language.toLowerCase().startsWith('en'))
          .sort((a, b) => a.name.localeCompare(b.name));
        setVoices(englishList);
      } catch (err) {
        if (__DEV__) console.warn('[VoicePickerSheet] Failed to fetch voices', err);
      } finally {
        setLoading(false);
      }
    }
    fetchVoices();
  }, [visible]);

  // Clean up speech preview on close/unmount
  useEffect(() => {
    return () => {
      void Speech.stop();
    };
  }, []);

  const handlePlayPreview = useCallback(async (voiceId: string, name: string, lang: string) => {
    if (previewVoiceId === voiceId) {
      try {
        await Speech.stop();
      } catch {}
      setPreviewVoiceId(null);
      return;
    }

    setPreviewVoiceId(voiceId);
    try {
      await Speech.stop();
      const testText = `${name} pronunciation preview`;
      Speech.speak(testText, {
        voice: voiceId,
        language: lang,
        onDone: () => setPreviewVoiceId(null),
        onStopped: () => setPreviewVoiceId(null),
        onError: (err) => {
          if (__DEV__) console.warn('[VoicePickerSheet] preview speak error', err);
          setPreviewVoiceId(null);
        },
      });
    } catch (err) {
      if (__DEV__) console.warn('[VoicePickerSheet] preview speak catch error', err);
      setPreviewVoiceId(null);
    }
  }, [previewVoiceId]);

  const handleSelect = useCallback((voiceId: string | null) => {
    onSelectVoice(voiceId);
    onClose();
  }, [onSelectVoice, onClose]);

  const renderVoiceItem = ({ item }: { item: Speech.Voice }) => {
    const isSelected = selectedVoiceId === item.identifier;
    const isFemale = isFemaleVoice(item.name);
    const isPreviewing = previewVoiceId === item.identifier;

    return (
      <TouchableOpacity
        testID={`voice-row-${item.identifier}`}
        style={[
          styles.voiceRow,
          {
            backgroundColor: colors.card,
            borderColor: isSelected ? colors.primary : colors.border,
          },
          isSelected && { borderWidth: 1.5 },
        ]}
        onPress={() => handleSelect(item.identifier)}
        activeOpacity={0.8}
      >
        <View style={styles.voiceInfo}>
          <View style={styles.voiceNameRow}>
            <Text
              style={[
                styles.voiceName,
                { color: colors.text },
                isSelected && { fontWeight: '700', color: colors.primary },
              ]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {isFemale && (
              <View style={[styles.genderBadge, { backgroundColor: colors.accent }]}>
                <Text style={[styles.genderText, { color: colors.primary }]}>Female</Text>
              </View>
            )}
            {!isFemale && (
              <View style={[styles.genderBadge, { backgroundColor: colors.background }]}>
                <Text style={[styles.genderText, { color: colors.textSecondary }]}>Male/Other</Text>
              </View>
            )}
          </View>
          
          <View style={styles.voiceMetaRow}>
            <View style={[styles.metaBadge, { backgroundColor: colors.background }]}>
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {item.language.toUpperCase()}
              </Text>
            </View>
            {item.quality === 'enhanced' && (
              <View style={[styles.enhancedBadge, { backgroundColor: colors.accent }]}>
                <Ionicons name="sparkles" size={10} color={colors.primary} />
                <Text style={[styles.enhancedText, { color: colors.primary }]}>High Quality</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.voiceActions}>
          <TouchableOpacity
            testID={`voice-preview-${item.identifier}`}
            style={[
              styles.previewButton,
              { backgroundColor: isPreviewing ? colors.accent : colors.background },
            ]}
            onPress={() => handlePlayPreview(item.identifier, item.name, item.language)}
            hitSlop={8}
          >
            {isPreviewing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="volume-high-outline" size={18} color={colors.primary} />
            )}
          </TouchableOpacity>

          <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary }]}>
            {isSelected && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const isDefaultSelected = selectedVoiceId === null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={onClose}
        />
        
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: footerBottomPadding }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Pronunciation Voice</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Choose a voice for vocabulary pronunciation
            </Text>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Scanning device speech engines…
              </Text>
            </View>
          ) : (
            <FlatList
              testID="voice-picker-list"
              data={voices}
              keyExtractor={(item) => item.identifier}
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={
                <TouchableOpacity
                  testID="voice-row-default"
                  style={[
                    styles.voiceRow,
                    styles.defaultRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: isDefaultSelected ? colors.primary : colors.border,
                    },
                    isDefaultSelected && { borderWidth: 1.5 },
                  ]}
                  onPress={() => handleSelect(null)}
                  activeOpacity={0.8}
                >
                  <View style={styles.voiceInfo}>
                    <Text
                      style={[
                        styles.voiceName,
                        { color: colors.text },
                        isDefaultSelected && { fontWeight: '700', color: colors.primary },
                      ]}
                    >
                      System Default (Auto-detect)
                    </Text>
                    <Text style={[styles.defaultSub, { color: colors.textSecondary }]}>
                      RecallX will choose the highest-quality female voice on this device
                    </Text>
                  </View>
                  <View style={[styles.checkbox, isDefaultSelected && { backgroundColor: colors.primary }]}>
                    {isDefaultSelected && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                  </View>
                </TouchableOpacity>
              }
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="alert-circle-outline" size={32} color={colors.textSecondary} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No voices found</Text>
                  <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                    Ensure speech-to-text or TTS engines are enabled in your device settings.
                  </Text>
                </View>
              }
              renderItem={renderVoiceItem}
            />
          )}

          <View style={styles.footer}>
            <TouchableOpacity
              testID="voice-picker-cancel"
              style={[styles.cancelButton, { borderColor: colors.border }]}
              onPress={onClose}
            >
              <Text style={[styles.cancelText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 16,
    maxHeight: '80%',
    minHeight: 460,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 24,
    gap: 10,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  defaultRow: {
    marginBottom: 4,
  },
  voiceInfo: {
    flex: 1,
    paddingRight: 8,
  },
  voiceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceName: {
    fontSize: 15,
    fontWeight: '600',
  },
  genderBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  genderText: {
    fontSize: 10,
    fontWeight: '700',
  },
  voiceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  metaBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  metaText: {
    fontSize: 10,
    fontWeight: '600',
  },
  enhancedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  enhancedText: {
    fontSize: 10,
    fontWeight: '700',
  },
  defaultSub: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  voiceActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 16,
  },
  cancelButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
