import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchWordWithSource,
  fetchWordTags,
  updateWordField,
  softDeleteWord,
  type WordWithSource,
} from '@/src/db/operations/wordDetail';

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

  const [loading, setLoading] = useState(true);
  const [wordData, setWordData] = useState<WordWithSource | null>(null);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const [data, tags] = await Promise.all([fetchWordWithSource(id), fetchWordTags(id)]);
      if (!data) {
        setNotFound(true);
      } else {
        setWordData(data);
      }
      setTagNames(tags);
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

  // ── Delete handler ──────────────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Word',
      `Are you sure you want to delete "${wordData?.word ?? 'this word'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await softDeleteWord(id!);
              router.back();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert('Error', `Could not delete word: ${message}`);
            }
          },
        },
      ],
    );
  }, [id, wordData?.word]);

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

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerBackTitle: 'Library',
          headerRight: () => (
            <TouchableOpacity onPress={handleDelete} accessibilityLabel="Delete word" hitSlop={8}>
              <Ionicons name="trash-outline" size={22} color="#FF3B30" />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Word heading */}
        <Text style={styles.wordHeading}>{wordData.word}</Text>

        {/* Source row */}
        {wordData.source && (
          <TouchableOpacity
            style={styles.sourceRow}
            onPress={() =>
              Alert.alert('Source', wordData.source!.uri)
            }
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
          {tagNames.length === 0 ? (
            <Text style={styles.noTagsText}>No tags yet — coming in Phase 5</Text>
          ) : (
            <View style={styles.chipsRow}>
              {tagNames.map((tag) => (
                <View key={tag} style={styles.chip}>
                  <Text style={styles.chipText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
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
});
