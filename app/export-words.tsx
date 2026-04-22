import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Directory } from 'expo-file-system';
import {
  fetchWordsForExport,
  pickExportDirectory,
  saveWordsExport,
  type ExportFormat,
  type ExportWordRecord,
} from '@/src/db/operations/exportWords';
import { getAllTags, getTagWordCounts, type Tag } from '@/src/db/operations/tags';
import { useThemeColors } from '@/src/utils/theme';

interface TagWithCount extends Tag {
  count: number;
}

function getFolderLabel(directory: Directory | null): string {
  if (!directory) return 'No folder selected';
  const parts = directory.uri.split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] ?? directory.uri);
}

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && /cancel/i.test(error.message);
}

export default function ExportWordsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const [allTags, setAllTags] = useState<TagWithCount[]>([]);
  const [allWords, setAllWords] = useState<ExportWordRecord[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedDirectory, setSelectedDirectory] = useState<Directory | null>(null);
  const [sortOrder, setSortOrder] = useState<'alphabetical' | 'newest' | 'oldest'>('alphabetical');
  const [loading, setLoading] = useState(true);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [choosingFolder, setChoosingFolder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tags, counts, words] = await Promise.all([
        getAllTags(),
        getTagWordCounts(),
        fetchWordsForExport(),
      ]);
      setAllTags(tags.map((tag) => ({ ...tag, count: counts[tag.id] ?? 0 })));
      setAllWords(words);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch((err) => {
        console.warn('[ExportWords] load failed:', err);
        Alert.alert('Error', 'Could not load words for export.');
      });
    }, [load]),
  );

  const selectedTagNames = useMemo(() => {
    const tagNameById = new Map(allTags.map((tag) => [tag.id, tag.name]));
    return selectedTagIds
      .map((tagId) => tagNameById.get(tagId))
      .filter((tagName): tagName is string => Boolean(tagName));
  }, [allTags, selectedTagIds]);

  const filteredWords = useMemo(() => {
    const result = selectedTagNames.length === 0
      ? allWords
      : allWords.filter((word) => word.tags.some((tagName) => selectedTagNames.includes(tagName)));

    if (sortOrder === 'newest') {
      return [...result].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    if (sortOrder === 'oldest') {
      return [...result].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    return [...result].sort((a, b) => a.word.localeCompare(b.word));
  }, [allWords, selectedTagNames, sortOrder]);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  }, []);

  const handleChooseFolder = useCallback(async () => {
    setChoosingFolder(true);
    try {
      const directory = await pickExportDirectory();
      setSelectedDirectory(directory);
    } catch (err) {
      if (!isCancelledError(err)) {
        console.warn('[ExportWords] pick directory failed:', err);
        Alert.alert('Folder Selection Failed', 'Could not open the Files folder picker.');
      }
    } finally {
      setChoosingFolder(false);
    }
  }, []);

  const handleExport = useCallback(async (format: ExportFormat) => {
    if (!selectedDirectory) {
      Alert.alert('Choose Folder First', 'Pick a destination folder in Files before exporting.');
      return;
    }
    setExportingFormat(format);
    try {
      const result = await saveWordsExport(format, selectedTagIds, selectedDirectory, sortOrder);
      Alert.alert(
        'Export Saved',
        `${result.filename} saved with ${result.count} ${result.count === 1 ? 'word' : 'words'}.\n\nLocation:\n${result.uri}`,
      );
    } catch (err) {
      console.warn('[ExportWords] save failed:', err);
      Alert.alert('Export Failed', 'Could not save the export file.');
    } finally {
      setExportingFormat(null);
    }
  }, [selectedDirectory, selectedTagIds, sortOrder]);

  const isEmpty = filteredWords.length === 0;

  return (
    <>
      <Stack.Screen options={{ title: 'Export Words' }} />
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      >
        <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Save To</Text>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Choose a folder in the Files app. Exported files will be written there directly.
          </Text>
          <View style={[styles.destinationBox, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
            <Text style={[styles.destinationLabel, { color: colors.textSecondary }]}>Selected Folder</Text>
            <Text testID="export-folder-label" style={[styles.destinationValue, { color: colors.text }]}>
              {getFolderLabel(selectedDirectory)}
            </Text>
          </View>
          <TouchableOpacity
            testID="choose-export-folder-button"
            style={[styles.buttonSecondary, { backgroundColor: colors.border }]}
            onPress={handleChooseFolder}
            activeOpacity={0.8}
            disabled={choosingFolder || exportingFormat !== null}
          >
            <Text style={[styles.buttonSecondaryText, { color: colors.text }]}>
              {choosingFolder ? 'Opening Files…' : selectedDirectory ? 'Change Folder' : 'Choose Folder in Files'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Filter</Text>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            {selectedTagIds.length === 0
              ? 'All Words selected'
              : `${selectedTagIds.length} ${selectedTagIds.length === 1 ? 'tag' : 'tags'} selected`}
          </Text>

          {allTags.length === 0 && !loading ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No tags yet. Export will include all words.</Text>
          ) : (
            <View style={styles.chips}>
              {allTags.map((tag) => {
                const selected = selectedTagIds.includes(tag.id);
                return (
                  <TouchableOpacity
                    key={tag.id}
                    testID={`export-tag-${tag.id}`}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.border },
                      selected && [styles.chipSelected, { backgroundColor: colors.text }]
                    ]}
                    onPress={() => toggleTag(tag.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[
                      styles.chipText,
                      { color: colors.textSecondary },
                      selected && [styles.chipTextSelected, { color: colors.card }]
                    ]}>
                      {tag.name} ({tag.count})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Sort Order</Text>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Choose how you want to order your exported words. Defaults to alphabetical.
          </Text>
          <View style={styles.chips}>
            {[
              { id: 'alphabetical', label: 'Alphabetical' },
              { id: 'newest', label: 'Newest First' },
              { id: 'oldest', label: 'Oldest First' },
            ].map((option) => {
              const selected = sortOrder === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  testID={`export-sort-${option.id}`}
                  style={[
                    styles.chip,
                    { backgroundColor: colors.border },
                    selected && [styles.chipSelected, { backgroundColor: colors.text }]
                  ]}
                  onPress={() => setSortOrder(option.id as 'alphabetical' | 'newest' | 'oldest')}
                  activeOpacity={0.8}
                >
                  <Text style={[
                    styles.chipText,
                    { color: colors.textSecondary },
                    selected && [styles.chipTextSelected, { color: colors.card }]
                  ]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Preview</Text>
          <Text testID="export-word-count" style={[styles.previewCount, { color: colors.text }]}>
            {loading ? 'Loading words…' : `${filteredWords.length} ${filteredWords.length === 1 ? 'word' : 'words'} ready`}
          </Text>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            JSON preserves full structure. CSV is better for spreadsheets.
          </Text>
          {isEmpty && !loading && (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No words match the selected tags.</Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Export</Text>

          <TouchableOpacity
            testID="export-json-button"
            style={[
              styles.button,
              { backgroundColor: colors.text },
              (loading || isEmpty || exportingFormat !== null || !selectedDirectory) && styles.buttonDisabled,
            ]}
            onPress={() => handleExport('json')}
            activeOpacity={0.8}
            disabled={loading || isEmpty || exportingFormat !== null || !selectedDirectory}
          >
            <Text style={[styles.buttonText, { color: colors.card }]}>
              {exportingFormat === 'json' ? 'Saving JSON…' : 'Export JSON'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="export-csv-button"
            style={[
              styles.buttonSecondary,
              { backgroundColor: colors.border },
              (loading || isEmpty || exportingFormat !== null || !selectedDirectory) && styles.buttonDisabled,
            ]}
            onPress={() => handleExport('csv')}
            activeOpacity={0.8}
            disabled={loading || isEmpty || exportingFormat !== null || !selectedDirectory}
          >
            <Text style={[styles.buttonSecondaryText, { color: colors.text }]}>
              {exportingFormat === 'csv' ? 'Saving CSV…' : 'Export CSV'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#111827',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6B7280',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
  },
  chipSelected: {
    backgroundColor: '#111827',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  destinationBox: {
    marginTop: 14,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  destinationLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  destinationValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  previewCount: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 12,
  },
  button: {
    marginTop: 10,
    backgroundColor: '#111827',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  buttonSecondary: {
    marginTop: 12,
    backgroundColor: '#E5E7EB',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  buttonSecondaryText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
});
