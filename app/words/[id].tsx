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
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';

import {
  fetchWordWithSource,
  updateWordField,
  softDeleteWord,
  type WordWithSource,
} from '@/src/db/operations/wordDetail';
import { getTagsForWord, removeTagFromWord, type Tag } from '@/src/db/operations/tags';
import TagPickerSheet from '@/src/components/TagPickerSheet';
import { getNav, navigate, clearNav } from '@/src/store/libraryNav';
import { getPronunciation } from '@/src/api/wordServerClient';

type PronunciationState = 'idle' | 'loading' | 'playing' | 'unavailable' | 'error';

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
}

function EditableField({ label, value, onSave, multiline = false, italic = false }: EditableFieldProps) {
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
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          ref={inputRef}
          style={[styles.fieldInput, italic && styles.fieldInputItalic, multiline && styles.fieldInputMultiline]}
          value={draft}
          onChangeText={setDraft}
          onBlur={handleBlur}
          multiline={multiline}
          autoFocus
        />
      </View>
    );
  }

  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
        <Text style={[styles.fieldText, italic && styles.fieldTextItalic]}>{value}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function WordDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const currentIdRef = useRef<string | undefined>(id);
  const currentWordRef = useRef<string | undefined>(undefined);
  const previousPronunciationWordRef = useRef<string | undefined>(undefined);

  const [loading, setLoading] = useState(true);
  const [wordData, setWordData] = useState<WordWithSource | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [pronunciationState, setPronunciationState] = useState<PronunciationState>('idle');
  const soundRef = useRef<Audio.Sound | null>(null);

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
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
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
    void soundRef.current?.unloadAsync();
    soundRef.current = null;
  }, [wordData?.word]);

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
      <TouchableOpacity
        onPress={handleDelete}
        accessibilityLabel="Delete word"
        hitSlop={8}
        style={styles.headerDeleteButton}
      >
        <Ionicons name="trash-outline" size={22} color="#FF3B30" />
      </TouchableOpacity>
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

  const handlePronunciationPress = useCallback(async () => {
    if (!wordData?.word || pronunciationState === 'loading') return;

    setPronunciationState('loading');
    try {
      await soundRef.current?.unloadAsync();
      soundRef.current = null;
      const pronunciation = await getPronunciation(wordData.word);
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: pronunciation.audio_url });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if ('isLoaded' in status && status.isLoaded && status.didJustFinish) {
          setPronunciationState('idle');
          void sound.unloadAsync();
          if (soundRef.current === sound) soundRef.current = null;
        }
      });
      setPronunciationState('playing');
      await sound.playAsync();
    } catch (err) {
      await soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      if (typeof err === 'object' && err !== null && 'statusCode' in err && err.statusCode === 404) {
        setPronunciationState('unavailable');
      } else {
        setPronunciationState('error');
      }
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
              Math.abs(gs.dx) > Math.abs(gs.dy) && Math.abs(gs.dx) > 10,
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
      <View style={styles.centeredContainer}>
        <Stack.Screen options={{ title: '', headerBackTitle: 'Library' }} />
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  // ── Not found ───────────────────────────────────────────────────────────────

  if (notFound || !wordData) {
    return (
      <View style={styles.centeredContainer}>
        <Stack.Screen options={{ title: '', headerBackTitle: 'Library' }} />
        <Text style={styles.notFoundText}>Word not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Go Back</Text>
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
      style={styles.screenContainer}
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
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Word heading */}
        <View style={styles.wordHeaderRow}>
          <Text style={styles.wordHeading}>{wordData.word}</Text>
          <TouchableOpacity
            testID="pronunciation-button"
            accessibilityLabel={`Play pronunciation for ${wordData.word}`}
            accessibilityRole="button"
            disabled={pronunciationState === 'loading'}
            onPress={handlePronunciationPress}
            hitSlop={10}
            style={[
              styles.pronunciationButton,
              pronunciationState === 'loading' && styles.pronunciationButtonDisabled,
            ]}
          >
            {pronunciationState === 'loading' ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <Ionicons
                name={pronunciationState === 'playing' ? 'volume-high-outline' : 'volume-medium-outline'}
                size={24}
                color="#007AFF"
              />
            )}
          </TouchableOpacity>
        </View>
        {pronunciationState === 'unavailable' && (
          <Text testID="pronunciation-status" style={styles.pronunciationStatus}>
            No pronunciation available
          </Text>
        )}
        {pronunciationState === 'error' && (
          <Text testID="pronunciation-status" style={styles.pronunciationStatus}>
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
              color="#666"
              style={styles.sourceIcon}
            />
            <Text style={styles.sourceLabel}>{formatSourceLabel(wordData.source)}</Text>
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

        {/* Tags */}
        <View style={styles.fieldContainer}>
          <Text style={styles.fieldLabel}>Tags</Text>
          <View style={styles.chipsRow}>
            {tags.map((tag) => (
              <View key={tag.id} style={styles.chip}>
                <Text style={styles.chipText}>{tag.name}</Text>
                <TouchableOpacity
                  onPress={async () => {
                    await removeTagFromWord(id!, tag.id);
                    setTags((prev) => prev.filter((t) => t.id !== tag.id));
                  }}
                  hitSlop={6}
                  style={styles.chipDelete}
                >
                  <Ionicons name="close" size={14} color="#1D4ED8" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.chipAdd} onPress={() => setTagPickerVisible(true)}>
              <Ionicons name="add" size={16} color="#007AFF" />
              <Text style={styles.chipAddText}>Add tag</Text>
            </TouchableOpacity>
          </View>
          {tags.length === 0 && (
            <Text style={styles.noTagsText}>No tags — tap + to add</Text>
          )}
        </View>
      </ScrollView>

      {navActive && (
        <View
          testID="word-detail-nav-bar"
          style={[styles.navBar, { paddingBottom: insets.bottom + 8 }]}
        >
          <TouchableOpacity
            testID="word-detail-nav-prev"
            disabled={!canPrev}
            onPress={() => goToAdjacentWord(-1)}
            hitSlop={12}
            style={[styles.navChevron, !canPrev && styles.navChevronDisabled]}
          >
            <Ionicons name="chevron-back" size={28} color="#007AFF" />
          </TouchableOpacity>

          <Text style={styles.navCounter}>{navIndex + 1} / {ids.length}</Text>

          <TouchableOpacity
            testID="word-detail-nav-next"
            disabled={!canNext}
            onPress={() => goToAdjacentWord(1)}
            hitSlop={12}
            style={[styles.navChevron, !canNext && styles.navChevronDisabled]}
          >
            <Ionicons name="chevron-forward" size={28} color="#007AFF" />
          </TouchableOpacity>
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
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
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
});
