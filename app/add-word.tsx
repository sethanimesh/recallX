import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { insertManualWord } from '@/src/db/operations/insertManualWord';
import { addTagToWord, type Tag } from '@/src/db/operations/tags';
import TagPickerSheet from '@/src/components/TagPickerSheet';
import { lookupWord } from '@/src/api/http';
import { useThemeColors } from '@/src/utils/theme';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function AddWordScreen() {
  const params = useLocalSearchParams<{ tagId?: string | string[]; tagName?: string | string[] }>();
  const colors = useThemeColors();
  const tagId = firstParam(params.tagId)?.trim();
  const tagName = firstParam(params.tagName)?.trim();
  const initialTags: Tag[] = tagId && tagName ? [{ id: tagId, name: tagName }] : [];
  const [word, setWord] = useState('');
  const [definition, setDefinition] = useState('');
  const [exampleSentence, setExampleSentence] = useState('');
  const [selectedTags, setSelectedTags] = useState<Tag[]>(initialTags);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autofilling, setAutofilling] = useState(false);

  const canSave = word.trim().length > 0 && definition.trim().length > 0;

  async function handleAutofill() {
    if (!word.trim() || autofilling) return;
    setAutofilling(true);
    try {
      const result = await lookupWord(word.trim());
      setWord(result.word);
      setDefinition(result.definition);
      setExampleSentence(result.example_sentence);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not look up word. Please try again.');
    } finally {
      setAutofilling(false);
    }
  }

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const newId = await insertManualWord(word, definition, exampleSentence);
      if (selectedTags.length > 0) {
        await Promise.all(selectedTags.map((t) => addTagToWord(newId, t.id)));
      }
      router.dismissAll();
      router.push(`/words/${newId}`);
    } catch (err) {
      setSaving(false);
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not save word. Please try again.');
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={[styles.keyboardAvoid, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Add Word</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Form */}
        <ScrollView style={[styles.form, { backgroundColor: colors.background }]} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: colors.text }]}>
            Word <Text style={[styles.required, { color: colors.error }]}>*</Text>
          </Text>
          <View style={styles.wordRow}>
            <TextInput
              testID="word-input"
              style={[styles.input, styles.wordInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground }]}
              value={word}
              onChangeText={setWord}
              placeholder="pellucid"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
            <TouchableOpacity
              testID="autofill-button"
              style={[styles.autofillButton, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}
              onPress={handleAutofill}
              disabled={!word.trim() || autofilling}
            >
              {autofilling ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="sparkles" size={20} color={word.trim() ? colors.primary : colors.textSecondary} />
              )}
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: colors.text }]}>
            Definition <Text style={[styles.required, { color: colors.error }]}>*</Text>
          </Text>
          <TextInput
            testID="definition-input"
            style={[styles.input, styles.multilineInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground }]}
            value={definition}
            onChangeText={setDefinition}
            placeholder="Translucently clear..."
            placeholderTextColor={colors.textSecondary}
            multiline
            textAlignVertical="top"
            returnKeyType="next"
          />

          <Text style={[styles.label, { color: colors.text }]}>Example sentence</Text>
          <TextInput
            testID="example-input"
            style={[styles.input, styles.multilineInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground }]}
            value={exampleSentence}
            onChangeText={setExampleSentence}
            placeholder="(optional)"
            placeholderTextColor={colors.textSecondary}
            multiline
            textAlignVertical="top"
          />

          {/* Tags */}
          <Text style={[styles.label, { color: colors.text }]}>Tags</Text>
          <View style={styles.chipsRow}>
            {selectedTags.map((tag) => (
              <View key={tag.id} style={[styles.chip, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                <Text style={[styles.chipText, { color: colors.primary }]}>{tag.name}</Text>
                <TouchableOpacity
                  onPress={() => setSelectedTags((prev) => prev.filter((t) => t.id !== tag.id))}
                  hitSlop={6}
                  style={styles.chipDelete}
                >
                  <Ionicons name="close" size={13} color={colors.primary} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={[styles.chipAdd, { borderColor: colors.primary }]} onPress={() => setTagPickerVisible(true)}>
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={[styles.chipAddText, { color: colors.primary }]}>Add tag</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            testID="save-word-button"
            style={[
              styles.saveButton,
              { backgroundColor: colors.primary },
              !canSave && { backgroundColor: colors.inputBackground }
            ]}
            onPress={handleSave}
            disabled={!canSave || saving || autofilling}
          >
            <Text style={[styles.saveButtonText, !canSave && { color: colors.textSecondary }]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <TagPickerSheet
        currentTags={selectedTags}
        visible={tagPickerVisible}
        onClose={() => setTagPickerVisible(false)}
        onTagsChanged={setSelectedTags}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  closeButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
  },
  headerSpacer: {
    width: 40,
  },
  form: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  required: {
    color: '#EF4444',
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  wordInput: {
    flex: 1,
    marginBottom: 0,
  },
  autofillButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#F9FAFB',
    marginBottom: 20,
  },
  multilineInput: {
    minHeight: 80,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 28,
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
  saveButton: {
    marginTop: 8,
    marginBottom: 32,
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  saveButtonTextDisabled: {
    color: '#fff',
  },
});
