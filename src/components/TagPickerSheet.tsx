import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getAllTags,
  createOrGetTag,
  addTagToWord,
  removeTagFromWord,
  type Tag,
} from '@/src/db/operations/tags';
import { useThemeColors } from '@/src/utils/theme';

interface Props {
  /** When provided, addTagToWord / removeTagFromWord are called on Done.
   *  When null/undefined, Done just calls onTagsChanged without touching the DB. */
  wordId?: string | null;
  currentTags: Tag[];
  visible: boolean;
  onClose: () => void;
  onTagsChanged: (tags: Tag[]) => void;
}

export default function TagPickerSheet({ wordId, currentTags, visible, onClose, onTagsChanged }: Props) {
  const insets = useSafeAreaInsets();
  const footerBottomPadding = insets.bottom + 16;
  const [query, setQuery] = useState('');
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setSelected(new Set(currentTags.map((t) => t.id)));
    getAllTags().then(setAllTags).catch(() => {});
  }, [visible, currentTags]);

  const trimmedQuery = query.trim();
  const filteredTags = trimmedQuery
    ? allTags.filter((t) => t.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : allTags;

  const showCreate =
    trimmedQuery.length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === trimmedQuery.toLowerCase());

  const selectedTags = allTags.filter((tag) => selected.has(tag.id));

  const toggleTag = useCallback((tagId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    const name = trimmedQuery;
    if (!name) return;
    try {
      const id = await createOrGetTag(name);
      const newTag: Tag = { id, name };
      setAllTags((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        return [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name));
      });
      setSelected((prev) => new Set([...prev, id]));
      setQuery('');
    } catch {
      // silently ignore
    }
  }, [trimmedQuery]);

  const handleDone = useCallback(async () => {
    const updatedTags = allTags.filter((t) => selected.has(t.id));

    if (wordId) {
      const originalIds = new Set(currentTags.map((t) => t.id));
      const added = [...selected].filter((id) => !originalIds.has(id));
      const removed = [...originalIds].filter((id) => !selected.has(id));
      try {
        await Promise.all([
          ...added.map((id) => addTagToWord(wordId, id)),
          ...removed.map((id) => removeTagFromWord(wordId, id)),
        ]);
      } catch {
        // silently ignore — UI still closes
      }
    }

    onTagsChanged(updatedTags);
    onClose();
  }, [wordId, currentTags, selected, allTags, onTagsChanged, onClose]);

  const colors = useThemeColors();

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetWrapper}
        >
          <View testID="tag-picker-sheet" style={[styles.sheet, { paddingBottom: footerBottomPadding, backgroundColor: colors.card }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />

            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: colors.text }]}>Tags</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                {selected.size === 0 ? 'Choose or create tags' : `${selected.size} selected`}
              </Text>
            </View>

            <View style={[styles.searchRow, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
              <Ionicons name="search-outline" size={18} color={colors.textSecondary} style={styles.searchIcon} />
              <TextInput
                testID="tag-picker-search-input"
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search or create tag…"
                placeholderTextColor={colors.textSecondary}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={showCreate ? handleCreate : undefined}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} testID="tag-picker-clear-query">
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              testID="tag-picker-list"
              data={filteredTags}
              keyExtractor={(item) => item.id}
              style={styles.list}
              contentContainerStyle={[styles.listContent, { paddingBottom: 24 }]}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <View testID="tag-picker-list-header" style={styles.listHeader}>
                  {selectedTags.length > 0 && (
                    <View testID="tag-picker-selected-section" style={styles.selectedSection}>
                      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Selected tags</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.selectedChipsRow}
                      >
                        {selectedTags.map((tag) => (
                          <TouchableOpacity
                            key={tag.id}
                            testID={`selected-chip-${tag.id}`}
                            style={[styles.selectedChip, { backgroundColor: colors.accent, borderColor: colors.border }]}
                            onPress={() => toggleTag(tag.id)}
                            activeOpacity={0.8}
                          >
                            <Text style={[styles.selectedChipText, { color: colors.primary }]}>{tag.name}</Text>
                            <Ionicons name="close" size={14} color={colors.primary} />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {showCreate && (
                    <TouchableOpacity testID="tag-picker-create" style={[styles.createRow, { backgroundColor: colors.inputBackground, borderColor: colors.border }]} onPress={handleCreate}>
                      <View style={[styles.createIconWrap, { backgroundColor: colors.accent }]}>
                        <Ionicons name="add" size={16} color={colors.primary} />
                      </View>
                      <View style={styles.createCopy}>
                        <Text style={[styles.createText, { color: colors.primary }]}>Create "{trimmedQuery}"</Text>
                        <Text style={[styles.createHint, { color: colors.textSecondary }]}>Add a new tag and select it right away</Text>
                      </View>
                    </TouchableOpacity>
                  )}

                  <Text testID="tag-picker-all-tags-label" style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                    {filteredTags.length > 0 ? 'All tags' : 'Results'}
                  </Text>
                </View>
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="pricetags-outline" size={26} color={colors.textSecondary} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>
                    {trimmedQuery.length > 0
                      ? `No matching tags. Create "${trimmedQuery}".`
                      : 'No tags yet. Create your first one.'}
                  </Text>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {trimmedQuery.length > 0
                      ? 'Try a different search or create a new tag above.'
                      : 'Tags help group words for review and discovery.'}
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                const isSelected = selected.has(item.id);
                return (
                  <TouchableOpacity
                    testID={`tag-row-${item.id}`}
                    style={[
                      styles.tagRow,
                      { backgroundColor: colors.inputBackground, borderColor: colors.border },
                      isSelected && { backgroundColor: colors.accent, borderColor: colors.primary }
                    ]}
                    onPress={() => toggleTag(item.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.tagRowCopy}>
                      <Text style={[
                        styles.tagName,
                        { color: colors.text },
                        isSelected && { color: colors.primary }
                      ]}>{item.name}</Text>
                      <Text style={[
                        styles.tagHint,
                        { color: colors.textSecondary },
                        isSelected && { color: colors.primary }
                      ]}>
                        {isSelected ? 'Selected for this word' : 'Tap to add this tag'}
                      </Text>
                    </View>
                    <View style={[
                      styles.checkbox,
                      { backgroundColor: colors.border },
                      isSelected && { backgroundColor: colors.primary }
                    ]}>
                      <Ionicons
                        name={isSelected ? 'checkmark' : 'add'}
                        size={16}
                        color={isSelected ? '#FFFFFF' : colors.textSecondary}
                      />
                    </View>
                  </TouchableOpacity>
                );
              }}
            />

            <View style={styles.footer}>
              <TouchableOpacity testID="tag-picker-done" style={[styles.doneButton, { backgroundColor: colors.primary }]} onPress={handleDone}>
                <Text style={styles.doneText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheetWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 16,
    maxHeight: '88%',
    minHeight: 420,
  },
  handle: {
    width: 44,
    height: 5,
    backgroundColor: '#E5E7EB',
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 16,
  },
  headerRow: {
    marginBottom: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6B7280',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  listHeader: {
    paddingTop: 14,
  },
  selectedSection: {
    marginBottom: 18,
  },
  sectionLabel: {
    marginBottom: 10,
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  selectedChipsRow: {
    gap: 8,
    paddingRight: 8,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectedChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D4ED8',
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  createIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  createCopy: {
    flex: 1,
  },
  createText: {
    fontSize: 15,
    color: '#007AFF',
    fontWeight: '600',
  },
  createHint: {
    marginTop: 2,
    fontSize: 13,
    color: '#6B7280',
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 0,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 10,
  },
  tagRowSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  tagRowCopy: {
    flex: 1,
    paddingRight: 12,
  },
  tagName: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '600',
  },
  tagNameSelected: {
    color: '#1D4ED8',
  },
  tagHint: {
    marginTop: 3,
    fontSize: 13,
    color: '#6B7280',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#2563EB',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  footer: {
    flexShrink: 0,
    paddingTop: 16,
  },
  doneButton: {
    backgroundColor: '#007AFF',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  doneText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
