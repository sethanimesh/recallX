import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  PanResponder,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDynamicInsets } from '@/src/hooks/useDynamicInsets';
import * as Speech from 'expo-speech';
import { useThemeColors } from '@/src/utils/theme';
import { getPronunciationVoice } from '@/src/config/settings';
import { getSmartDefaultVoice } from '@/src/utils/speech';

import {
  fetchWordWithSource,
  updateWordField,
  softDeleteWord,
  type WordWithSource,
} from '@/src/db/operations/wordDetail';
import { getTagsForWord, removeTagFromWord, type Tag } from '@/src/db/operations/tags';
import { fetchWordHistory, type SessionResultRow } from '@/src/db/operations/sessionHistory';
import TagPickerSheet from '@/src/components/TagPickerSheet';
import TextWithLinks from '@/src/components/TextWithLinks';
import { TVFocusable } from '@/src/components/TVFocusable';
import { scaleSize, scaleFont } from '@/src/utils/tvConfig';
import { getNav, navigate, clearNav } from '@/src/store/libraryNav';

type PronunciationState = 'idle' | 'playing' | 'error';

// ── Source helpers ────────────────────────────────────────────────────────────

function formatSourceLabel(source: WordWithSource['source']): string {
  if (!source) return '';
  if (source.type === 'image') {
    const date = new Date(source.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    return `Photo · ${date}`;
  }
  // pdf / video
  const filename = source.uri.split('/').pop() ?? source.uri;
  const typeLabel = source.type === 'pdf' ? 'PDF' : 'Video';
  return `${typeLabel} · ${filename}`;
}

function sourceIconName(type: 'image' | 'pdf' | 'video'): React.ComponentProps<typeof Ionicons>['name'] {
  if (type === 'image') return 'image-outline';
  return 'document-outline';
}

// ── Inline-edit field ─────────────────────────────────────────────────────────

interface EditableFieldProps {
  label: string;
  value: string;
  onSave: (newValue: string) => Promise<void>;
  multiline?: boolean;
  italic?: boolean;
  placeholder?: string;
  rightAccessory?: React.ReactNode;
}

function EditableField({ label, value, onSave, multiline = false, italic = false, placeholder, rightAccessory }: EditableFieldProps) {
  const colors = useThemeColors();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<TextInput>(null);

  // Keep draft in sync if parent value changes externally
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const handlePress = useCallback(() => {
    setDraft(value);
    setEditing(true);
    // Focus happens after state update
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [value]);

  const handleBlur = useCallback(async () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      try {
        await onSave(trimmed);
      } catch {
        setDraft(value); // revert to original value
        Alert.alert('Save failed', 'Could not save your change. Please try again.');
      }
    } else {
      // Revert if empty or unchanged
      setDraft(value);
    }
  }, [draft, value, onSave]);

  if (editing) {
    return (
      <View style={styles.fieldContainer}>
        <View style={styles.fieldLabelRow}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
          {rightAccessory}
        </View>
        <TextInput
          ref={inputRef}
          style={[styles.fieldInput, italic && styles.fieldInputItalic, multiline && styles.fieldInputMultiline, { color: colors.text, borderColor: colors.primary, backgroundColor: colors.inputBackground }]}
          value={draft}
          onChangeText={setDraft}
          onBlur={handleBlur}
          multiline={multiline}
          autoFocus
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
        />
      </View>
    );
  }

  const content = value ? (
    <TextWithLinks 
      text={value} 
      style={[styles.fieldText, { color: italic ? colors.textSecondary : colors.text }]} 
      italic={italic} 
    />
  ) : (
    <Text style={[styles.fieldText, { color: colors.textSecondary, fontStyle: 'italic' }]}>
      {placeholder || `Tap to add ${label.toLowerCase()}`}
    </Text>
  );

  if (Platform.isTV) {
    return (
      <View style={styles.fieldContainer}>
        <View style={styles.fieldLabelRow}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
          {rightAccessory}
        </View>
        <TVFocusable onPress={handlePress} activeOpacity={1}>{content}</TVFocusable>
      </View>
    );
  }

  return (
    <View style={styles.fieldContainer}>
      <View style={styles.fieldLabelRow}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
        {rightAccessory}
      </View>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function WordDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useDynamicInsets();
  const colors = useThemeColors();
  const currentIdRef = useRef<string | undefined>(id);
  const currentWordRef = useRef<string | undefined>(undefined);
  const previousPronunciationWordRef = useRef<string | undefined>(undefined);

  const [loading, setLoading] = useState(true);
  const [wordData, setWordData] = useState<WordWithSource | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [pronunciationState, setPronunciationState] = useState<PronunciationState>('idle');
  const [history, setHistory] = useState<SessionResultRow[]>([]);

  const [editingWord, setEditingWord] = useState(false);
  const [draftWord, setDraftWord] = useState('');
  const [generatingMnemonic, setGeneratingMnemonic] = useState(false);
  const wordInputRef = useRef<TextInput>(null);

  // Keep draftWord in sync if wordData changes externally
  useEffect(() => {
    if (!editingWord && wordData) {
      setDraftWord(wordData.word);
    }
  }, [wordData?.word, editingWord]);

  const handleWordPress = useCallback(() => {
    if (wordData) {
      setDraftWord(wordData.word);
      setEditingWord(true);
      setTimeout(() => wordInputRef.current?.focus(), 0);
    }
  }, [wordData]);

  const handleWordBlur = useCallback(async () => {
    setEditingWord(false);
    const trimmed = draftWord.trim();
    if (trimmed && trimmed !== wordData?.word) {
      const capitalized = trimmed.replace(/^\w/, (c) => c.toUpperCase());
      try {
        await updateWordField(id!, 'word', trimmed);
        setWordData((prev) => (prev ? { ...prev, word: capitalized } : prev));
      } catch (err: any) {
        setDraftWord(wordData?.word ?? ''); // revert to original value
        const errMsg = err?.message || '';
        if (errMsg.includes('already exists') || err?.statusCode === 409) {
          Alert.alert('Save failed', 'This word already exists.');
        } else {
          Alert.alert('Save failed', 'Could not save your change. Please try again.');
        }
      }
    } else {
      // Revert if empty or unchanged
      setDraftWord(wordData?.word ?? '');
    }
  }, [draftWord, wordData?.word, id]);

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const [data, wordTags] = await Promise.all([fetchWordWithSource(id), getTagsForWord(id)]);
      if (!data) {
        setNotFound(true);
      } else {
        setWordData(data);
      }
      setTags(wordTags);
    } catch (err) {
      if (__DEV__) console.warn('[WordDetail] load error', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      void Speech.stop();
    };
  }, []);

  useEffect(() => {
    currentIdRef.current = id;
    currentWordRef.current = wordData?.word;
  }, [id, wordData?.word]);

  useEffect(() => {
    const previousWord = previousPronunciationWordRef.current;
    previousPronunciationWordRef.current = wordData?.word;
    if (!previousWord || previousWord === wordData?.word) return;

    setPronunciationState('idle');
    void Speech.stop();
  }, [wordData?.word]);

  useEffect(() => {
    if (!id) return;
    fetchWordHistory(String(id), 5).then(setHistory).catch(() => {});
  }, [id]);

  // ── Delete handler ──────────────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    const currentId = currentIdRef.current;
    Alert.alert(
      'Delete Word',
      `Are you sure you want to delete "${currentWordRef.current ?? 'this word'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!currentId) return;
            try {
              await softDeleteWord(currentId);
              router.back();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert('Error', `Could not delete word: ${message}`);
            }
          },
        },
      ],
    );
  }, []);

  const renderHeaderRight = useCallback(
    () => (
      <TVFocusable
        onPress={handleDelete}
        accessibilityLabel="Delete word"
        hitSlop={8}
        style={styles.headerDeleteButton}
      >
        <Ionicons name="trash-outline" size={22} color="#FF3B30" />
      </TVFocusable>
    ),
    [handleDelete],
  );

  // ── Field save handlers ─────────────────────────────────────────────────────

  const saveDefinition = useCallback(
    async (newVal: string) => {
      await updateWordField(id!, 'definition', newVal);
      setWordData((prev) => (prev ? { ...prev, definition: newVal } : prev));
    },
    [id],
  );

  const saveExampleSentence = useCallback(
    async (newVal: string) => {
      await updateWordField(id!, 'example_sentence', newVal);
      setWordData((prev) => (prev ? { ...prev, example_sentence: newVal } : prev));
    },
    [id],
  );

  const saveMnemonic = useCallback(
    async (newVal: string) => {
      await updateWordField(id!, 'mnemonic', newVal);
      setWordData((prev) => (prev ? { ...prev, mnemonic: newVal } : prev));
    },
    [id],
  );

  const handleGenerateMnemonic = useCallback(async () => {
    if (!id) return;
    setGeneratingMnemonic(true);
    try {
      // Must import generateMnemonicForWord at the top of the file
      const { generateMnemonicForWord } = require('@/src/db/operations/wordDetail');
      const newMnemonic = await generateMnemonicForWord(id);
      if (newMnemonic) {
        setWordData((prev) => (prev ? { ...prev, mnemonic: newMnemonic } : prev));
      } else {
        Alert.alert('Generation Failed', 'Could not generate a mnemonic. Please try again.');
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Generation Failed', msg);
    } finally {
      setGeneratingMnemonic(false);
    }
  }, [id]);

  const handlePronunciationPress = useCallback(async () => {
    if (!wordData?.word) return;

    if (pronunciationState === 'playing') {
      try {
        await Speech.stop();
      } catch (err) {
        if (__DEV__) console.warn('[WordDetail] speech stop error', err);
      }
      setPronunciationState('idle');
      return;
    }

    setPronunciationState('playing');
    try {
      await Speech.stop();

      // Retrieve the preferred voice from settings or detect a smart default female voice
      let selectedVoice: string | null | undefined = getPronunciationVoice();
      if (!selectedVoice) {
        selectedVoice = await getSmartDefaultVoice();
      }

      const speakOptions: Speech.SpeechOptions = {
        language: 'en',
        onDone: () => setPronunciationState('idle'),
        onStopped: () => setPronunciationState('idle'),
        onError: (err) => {
          if (__DEV__) console.warn('[WordDetail] speech speak callback error', err);
          setPronunciationState('error');
        },
      };

      if (selectedVoice) {
        speakOptions.voice = selectedVoice;
      }

      Speech.speak(wordData.word, speakOptions);
    } catch (err) {
      if (__DEV__) console.warn('[WordDetail] speech speak catch error', err);
      setPronunciationState('error');
    }
  }, [pronunciationState, wordData?.word]);

  useEffect(() => {
    const { active, ids, index } = getNav();
    if (active && ids[index] !== id) {
      clearNav();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only: detect stale nav state from a previous Library session

  // ── Nav state ───────────────────────────────────────────────────────────────

  // getNav() is a non-reactive read; setParams triggers a render after navigate() mutates the store.
  const navState = getNav();

  const goToAdjacentWord = useCallback((delta: 1 | -1) => {
    const nextId = navigate(delta);
    if (nextId) router.setParams({ id: nextId });
  }, []);



  const panResponder = useMemo(
    () =>
      navState.active
        ? PanResponder.create({
            onMoveShouldSetPanResponder: (_, gs) =>
              Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 && Math.abs(gs.dx) > 40,
            onPanResponderRelease: (_, gs) => {
              if (Math.abs(gs.dx) < 60) return;
              goToAdjacentWord(gs.dx < 0 ? 1 : -1);
            },
          })
        : null,
    [goToAdjacentWord, navState.active],
  );

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: '', headerBackTitle: 'Library' }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Not found ───────────────────────────────────────────────────────────────

  if (notFound || !wordData) {
    return (
      <View style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: '', headerBackTitle: 'Library' }} />
        <Text style={[styles.notFoundText, { color: colors.textSecondary }]}>Word not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.backButtonText, { color: colors.card }]}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const { ids, index: navIndex, active: navActive } = navState;
  const canPrev = navActive && navIndex > 0;
  const canNext = navActive && navIndex < ids.length - 1;

  return (
    <View
      style={[styles.screenContainer, { backgroundColor: colors.background }]}
      {...(panResponder?.panHandlers ?? {})}
    >
      <Stack.Screen
        options={{
          title: '',
          headerBackTitle: 'Library',
          headerRight: renderHeaderRight,
        }}
      />
      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Word heading */}
        <View style={styles.wordHeaderRow}>
          {editingWord ? (
            <TextInput
              ref={wordInputRef}
              style={[
                styles.wordInput,
                {
                  color: colors.text,
                  borderColor: colors.primary,
                  backgroundColor: colors.inputBackground,
                },
              ]}
              value={draftWord}
              onChangeText={setDraftWord}
              onBlur={handleWordBlur}
              autoFocus
              selectTextOnFocus
            />
          ) : (
            Platform.isTV ? (
              <TVFocusable
                onPress={handleWordPress}
                style={{ flexShrink: 1 }}
              >
                <Text style={[styles.wordHeading, { color: colors.text }]}>{wordData.word}</Text>
              </TVFocusable>
            ) : (
              <TouchableOpacity
                onPress={handleWordPress}
                activeOpacity={0.7}
                style={{ flexShrink: 1 }}
              >
                <Text style={[styles.wordHeading, { color: colors.text }]}>{wordData.word}</Text>
              </TouchableOpacity>
            )
          )}

          <TVFocusable
            testID="pronunciation-button"
            accessibilityLabel={`Play pronunciation for ${wordData.word}`}
            accessibilityRole="button"
            onPress={handlePronunciationPress}
            hitSlop={10}
            style={[styles.pronunciationButton, { backgroundColor: colors.accent }]}
          >
            <Ionicons
              name={pronunciationState === 'playing' ? 'volume-high-outline' : 'volume-medium-outline'}
              size={24}
              color={colors.primary}
            />
          </TVFocusable>
        </View>
        {pronunciationState === 'error' && (
          <Text testID="pronunciation-status" style={[styles.pronunciationStatus, { color: colors.error }]}>
            Could not play pronunciation
          </Text>
        )}

        {/* Source row */}
        {wordData.source && (
          <TouchableOpacity
            style={styles.sourceRow}
            onPress={() => Alert.alert('Source', wordData.source!.uri)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={sourceIconName(wordData.source.type)}
              size={16}
              color={colors.textSecondary}
              style={styles.sourceIcon}
            />
            <Text style={[styles.sourceLabel, { color: colors.textSecondary }]}>{formatSourceLabel(wordData.source)}</Text>
          </TouchableOpacity>
        )}

        {/* Definition */}
        <EditableField
          label="Definition"
          value={wordData.definition}
          onSave={saveDefinition}
          multiline
        />

        {/* Example sentence */}
        <EditableField
          label="Example Sentence"
          value={wordData.example_sentence}
          onSave={saveExampleSentence}
          multiline
          italic
        />

        {/* Mnemonic */}
        <EditableField
          label="Mnemonic"
          value={wordData.mnemonic || ''}
          placeholder="Tap to add a mnemonic..."
          onSave={saveMnemonic}
          multiline
          rightAccessory={
            !wordData.mnemonic ? (
              <TouchableOpacity
                onPress={handleGenerateMnemonic}
                disabled={generatingMnemonic}
                style={styles.generateButton}
                hitSlop={8}
              >
                {generatingMnemonic ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={14} color={colors.primary} />
                    <Text style={[styles.generateButtonText, { color: colors.primary }]}>Generate</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : undefined
          }
        />

        {/* Tags */}
        <View style={styles.fieldContainer}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Tags</Text>
          <View style={styles.chipsRow}>
            {tags.map((tag) => (
              <View key={tag.id} style={[styles.chip, { backgroundColor: colors.accent }]}>
                <Text style={[styles.chipText, { color: colors.primary }]}>{tag.name}</Text>
                {!Platform.isTV && (
                  <TouchableOpacity
                    onPress={async () => {
                      await removeTagFromWord(id!, tag.id);
                      setTags((prev) => prev.filter((t) => t.id !== tag.id));
                    }}
                    hitSlop={6}
                    style={styles.chipDelete}
                  >
                    <Ionicons name="close" size={14} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TVFocusable style={[styles.chipAdd, { borderColor: colors.primary }]} onPress={() => setTagPickerVisible(true)}>
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={[styles.chipAddText, { color: colors.primary }]}>Add tag</Text>
            </TVFocusable>
          </View>
          {tags.length === 0 && (
            <Text style={[styles.noTagsText, { color: colors.textSecondary }]}>No tags — tap + to add</Text>
          )}
        </View>

        {/* Review history */}
        <View style={[styles.historySection, { borderTopColor: colors.border }]}>
          <Text style={[styles.historyLabel, { color: colors.textSecondary }]}>Review history</Text>
          {history.length === 0 ? (
            <Text style={[styles.historyEmpty, { color: colors.textSecondary }]}>Not reviewed yet</Text>
          ) : (
            history.map((r, i) => (
              <View key={i} style={styles.historyRow}>
                <Text style={r.correct === 1 ? styles.historyCheck : styles.historyCross}>
                  {r.correct === 1 ? '✓' : '✗'}
                </Text>
                <Text style={[styles.historyDate, { color: colors.textSecondary }]}>
                  {new Date(r.answered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {navActive && (
        <View
          testID="word-detail-nav-bar"
          style={[styles.navBar, { paddingBottom: insets.bottom + 8, borderTopColor: colors.border, backgroundColor: colors.card }]}
        >
          <TVFocusable
            testID="word-detail-nav-prev"
            disabled={!canPrev}
            onPress={() => goToAdjacentWord(-1)}
            hitSlop={12}
            style={[styles.navChevron, !canPrev && styles.navChevronDisabled]}
          >
            <Ionicons name="chevron-back" size={28} color={colors.primary} />
          </TVFocusable>

          <Text style={[styles.navCounter, { color: colors.textSecondary }]}>{navIndex + 1} / {ids.length}</Text>

          <TVFocusable
            testID="word-detail-nav-next"
            disabled={!canNext}
            onPress={() => goToAdjacentWord(1)}
            hitSlop={12}
            style={[styles.navChevron, !canNext && styles.navChevronDisabled]}
          >
            <Ionicons name="chevron-forward" size={28} color={colors.primary} />
          </TVFocusable>
        </View>
      )}

      <TagPickerSheet
        wordId={id!}
        currentTags={tags}
        visible={tagPickerVisible}
        onClose={() => setTagPickerVisible(false)}
        onTagsChanged={setTags}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  centeredContainer: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  wordHeading: {
    fontSize: 32,
    fontWeight: '800',
    color: '#111827',
    flexShrink: 1,
  },
  wordHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  wordInput: {
    fontSize: 32,
    fontWeight: '800',
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    padding: 6,
  },
  pronunciationButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
  },
  pronunciationButtonDisabled: {
    opacity: 0.65,
  },
  pronunciationStatus: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: -6,
    marginBottom: 12,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  sourceIcon: {
    marginRight: 6,
  },
  sourceLabel: {
    fontSize: 14,
    color: '#666',
  },
  fieldContainer: {
    marginBottom: 24,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  generateButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  fieldText: {
    fontSize: 16,
    color: '#111827',
    lineHeight: 24,
  },
  fieldTextItalic: {
    fontStyle: 'italic',
    color: '#6B7280',
  },
  fieldInput: {
    fontSize: 16,
    color: '#111827',
    lineHeight: 24,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#F9FAFB',
  },
  fieldInputItalic: {
    fontStyle: 'italic',
  },
  fieldInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 14,
    color: '#1D4ED8',
    fontWeight: '500',
  },
  chipDelete: {
    marginLeft: 4,
  },
  chipAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#007AFF',
    borderStyle: 'dashed',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 2,
  },
  chipAddText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  headerDeleteButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noTagsText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  notFoundText: {
    fontSize: 18,
    color: '#374151',
    marginBottom: 16,
    textAlign: 'center',
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#007AFF',
    borderRadius: 10,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F3F4F6',
    backgroundColor: '#fff',
  },
  navChevron: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navChevronDisabled: {
    opacity: 0.3,
  },
  navCounter: {
    fontSize: 15,
    color: '#6B7280',
    fontWeight: '500',
  },
  historySection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  historyLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  historyEmpty: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  historyCheck: {
    fontSize: 14,
    color: '#22C55E',
    fontWeight: '700',
    width: 18,
  },
  historyCross: {
    fontSize: 14,
    color: '#EF4444',
    fontWeight: '700',
    width: 18,
  },
  historyDate: {
    fontSize: 14,
    color: '#6B7280',
  },
});
