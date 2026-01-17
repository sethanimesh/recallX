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
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { insertManualWord } from '@/src/db/operations/insertManualWord';
import { addTagToWord, type Tag } from '@/src/db/operations/tags';
import TagPickerSheet from '@/src/components/TagPickerSheet';

export default function AddWordScreen() {
  const [word, setWord] = useState('');
  const [definition, setDefinition] = useState('');
  const [exampleSentence, setExampleSentence] = useState('');
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const canSave = word.trim().length > 0 && definition.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const newId = await insertManualWord(word, definition, exampleSentence);
      if (selectedTags.length > 0) {
        await Promise.all(selectedTags.map((t) => addTagToWord(newId, t.id)));
      }
      router.replace(`/words/${newId}`);
    } catch (err) {
      setSaving(false);
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not save word. Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add Word</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Form */}
        <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>
            Word <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={word}
            onChangeText={setWord}
            placeholder="pellucid"
            placeholderTextColor="#C7C7CC"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          <Text style={styles.label}>
            Definition <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            value={definition}
            onChangeText={setDefinition}
            placeholder="Translucently clear..."
            placeholderTextColor="#C7C7CC"
            multiline
            textAlignVertical="top"
            returnKeyType="next"
          />

          <Text style={styles.label}>Example sentence</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            value={exampleSentence}
            onChangeText={setExampleSentence}
            placeholder="(optional)"
            placeholderTextColor="#C7C7CC"
            multiline
            textAlignVertical="top"
          />

          {/* Tags */}
          <Text style={styles.label}>Tags</Text>
          <View style={styles.chipsRow}>
            {selectedTags.map((tag) => (
              <View key={tag.id} style={styles.chip}>
                <Text style={styles.chipText}>{tag.name}</Text>
                <TouchableOpacity
                  onPress={() => setSelectedTags((prev) => prev.filter((t) => t.id !== tag.id))}
                  hitSlop={6}
                  style={styles.chipDelete}
                >
                  <Ionicons name="close" size={13} color="#1D4ED8" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.chipAdd} onPress={() => setTagPickerVisible(true)}>
              <Ionicons name="add" size={16} color="#007AFF" />
              <Text style={styles.chipAddText}>Add tag</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={!canSave || saving}
          >
            <Text style={[styles.saveButtonText, !canSave && styles.saveButtonTextDisabled]}>
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
