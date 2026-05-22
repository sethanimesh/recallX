import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ListRenderItemInfo,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isNull, asc } from 'drizzle-orm';
import { db } from '@/src/db/client';
import { words as wordsTable } from '@/src/db/schema';
import { filterWords } from '@/src/screens/libraryLogic';
import { getAllTags, fetchWordsByTag, type Tag } from '@/src/db/operations/tags';
import { setNav } from '@/src/store/libraryNav';
import { useThemeColors } from '@/src/utils/theme';

type WordRow = {
  id: string;
  word: string;
  definition: string;
  created_at: Date;
};

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const [allWords, setAllWords] = useState<WordRow[]>([]);
  const [query, setQuery] = useState('');
  const [filterTags, setFilterTags] = useState<Tag[]>([]);
  const params = useLocalSearchParams<{ tagId?: string }>();
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  useEffect(() => {
    if (params.tagId) {
      setActiveTagId(params.tagId);
      router.setParams({ tagId: undefined });
    }
  }, [params.tagId]);
  const [sortOrder, setSortOrder] = useState<'alphabetical' | 'newest' | 'oldest'>('alphabetical');
  const [showSortMenu, setShowSortMenu] = useState(false);

  const fetchWords = useCallback(async (tagId: string | null) => {
    if (tagId) {
      const rows = await fetchWordsByTag(tagId);
      setAllWords(rows.map((r) => ({ id: r.id, word: r.word, definition: r.definition, created_at: r.created_at })));
    } else {
      const rows = await db
        .select({ id: wordsTable.id, word: wordsTable.word, definition: wordsTable.definition, created_at: wordsTable.created_at })
        .from(wordsTable)
        .where(isNull(wordsTable.deleted_at))
        .orderBy(asc(wordsTable.word));
      setAllWords(rows);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([getAllTags(), fetchWords(activeTagId)])
        .then(([tags]) => {
          if (active) setFilterTags(tags);
        })
        .catch((err) => {
          if (__DEV__) console.warn('[LibraryScreen] load failed', err);
          if (active) setAllWords([]);
        });
      return () => {
        active = false;
      };
    }, [activeTagId, fetchWords]),
  );

  useEffect(() => {
    fetchWords(activeTagId).catch(() => {});
  }, [activeTagId, fetchWords]);

  const handleTagPress = useCallback((tagId: string) => {
    setActiveTagId((prev) => (prev === tagId ? null : tagId));
    setQuery('');
  }, []);

  const activeTagName = filterTags.find((t) => t.id === activeTagId)?.name ?? null;

  const handleSortPress = useCallback(() => {
    if (Platform.OS === 'web') {
      setShowSortMenu((prev) => !prev);
      return;
    }
    Alert.alert(
      'Sort Order',
      'Choose how you want to order your library:',
      [
        {
          text: 'Alphabetical (A-Z)',
          onPress: () => setSortOrder('alphabetical'),
        },
        {
          text: 'Newest First',
          onPress: () => setSortOrder('newest'),
        },
        {
          text: 'Oldest First',
          onPress: () => setSortOrder('oldest'),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ],
      { cancelable: true }
    );
  }, []);

  const getSortIcon = useCallback(() => {
    if (sortOrder === 'newest') return 'time';
    if (sortOrder === 'oldest') return 'time-outline';
    return 'swap-vertical-outline';
  }, [sortOrder]);

  const filtered = filterWords(allWords, query);

  const sortedAndFiltered = [...filtered].sort((a, b) => {
    if (sortOrder === 'newest') {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortOrder === 'oldest') {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    return a.word.localeCompare(b.word);
  });

  const filteredIdsRef = useRef<string[]>([]);
  filteredIdsRef.current = sortedAndFiltered.map((w) => w.id);

  const ItemSeparator = useCallback(() => <View style={[styles.separator, { backgroundColor: colors.separator }]} />, [colors.separator]);

  const handleAddPress = useCallback(() => {
    if (activeTagId && activeTagName) {
      router.push({
        pathname: '/ingest',
        params: { tagId: activeTagId, tagName: activeTagName },
      });
      return;
    }
    router.push('/ingest');
  }, [activeTagId, activeTagName]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<WordRow>) => (
      <TouchableOpacity
        testID={`word-row-${item.id}`}
        style={styles.row}
        onPress={() => {
          setNav(filteredIdsRef.current, index);
          router.push(`/words/${item.id}`);
        }}
        activeOpacity={0.7}
      >
        <Text style={[styles.word, { color: colors.text }]}>{item.word}</Text>
        <Text style={[styles.definition, { color: colors.textSecondary }]} numberOfLines={1} ellipsizeMode="tail">
          {item.definition}
        </Text>
      </TouchableOpacity>
    ),
    [colors],
  );

  const renderEmpty = useCallback(() => {
    if (allWords.length === 0 && !query) {
      if (activeTagName) {
        return (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No words tagged '{activeTagName}'</Text>
          </View>
        );
      }
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No words yet — tap + to add some</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No matches for '{query}'</Text>
      </View>
    );
  }, [allWords.length, query, activeTagName, colors.textSecondary]);

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      {/* Search bar */}
      <View testID="library-search-row" style={[styles.searchRow, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          testID="library-search-input"
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search words..."
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <TouchableOpacity
          testID="library-sort-button"
          style={styles.sortButton}
          onPress={handleSortPress}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name={getSortIcon()} size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Tag filter strip */}
      {filterTags.length > 0 && (
        <View testID="library-tag-wrap" style={styles.tagWrap}>
          <TouchableOpacity
            testID="library-tag-chip-all"
            style={[
              styles.tagChip,
              { backgroundColor: colors.card, borderColor: colors.border },
              activeTagId === null && { backgroundColor: colors.text, borderColor: colors.text }
            ]}
            onPress={() => { setActiveTagId(null); setQuery(''); }}
          >
            <Text style={[
              styles.tagChipText,
              { color: colors.textSecondary },
              activeTagId === null && { color: colors.card }
            ]}>
              All
            </Text>
          </TouchableOpacity>
          {filterTags.map((tag) => (
            <TouchableOpacity
              key={tag.id}
              testID={`library-tag-chip-${tag.id}`}
              style={[
                styles.tagChip,
                { backgroundColor: colors.card, borderColor: colors.border },
                activeTagId === tag.id && { backgroundColor: colors.text, borderColor: colors.text }
              ]}
              onPress={() => handleTagPress(tag.id)}
            >
              <Text style={[
                styles.tagChipText,
                { color: colors.textSecondary },
                activeTagId === tag.id && { color: colors.card }
              ]}>
                {tag.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={sortedAndFiltered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        ItemSeparatorComponent={ItemSeparator}
        contentContainerStyle={sortedAndFiltered.length === 0 ? styles.listEmpty : undefined}
        keyboardShouldPersistTaps="handled"
      />
      <TouchableOpacity
        testID="library-add-button"
        style={[styles.fab, { bottom: 24 + insets.bottom, backgroundColor: colors.text }]}
        onPress={handleAddPress}
      >
        <Ionicons name="add" size={28} color={colors.card} />
      </TouchableOpacity>

      {showSortMenu && (
        <>
          <TouchableOpacity
            style={styles.sortMenuBackdrop}
            activeOpacity={1}
            onPress={() => setShowSortMenu(false)}
          />
          <View style={[styles.sortMenu, { top: 56 + insets.top, backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[
                styles.sortMenuItem,
                sortOrder === 'alphabetical' && { backgroundColor: colors.inputBackground }
              ]}
              onPress={() => {
                setSortOrder('alphabetical');
                setShowSortMenu(false);
              }}
            >
              <Ionicons name="swap-vertical-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <Text style={[styles.sortMenuItemText, { color: colors.text }]}>Alphabetical (A-Z)</Text>
              {sortOrder === 'alphabetical' && (
                <Ionicons name="checkmark" size={16} color={colors.text} style={{ marginLeft: 'auto' }} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sortMenuItem,
                sortOrder === 'newest' && { backgroundColor: colors.inputBackground }
              ]}
              onPress={() => {
                setSortOrder('newest');
                setShowSortMenu(false);
              }}
            >
              <Ionicons name="time" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <Text style={[styles.sortMenuItemText, { color: colors.text }]}>Newest First</Text>
              {sortOrder === 'newest' && (
                <Ionicons name="checkmark" size={16} color={colors.text} style={{ marginLeft: 'auto' }} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sortMenuItem,
                sortOrder === 'oldest' && { backgroundColor: colors.inputBackground }
              ]}
              onPress={() => {
                setSortOrder('oldest');
                setShowSortMenu(false);
              }}
            >
              <Ionicons name="time-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <Text style={[styles.sortMenuItemText, { color: colors.text }]}>Oldest First</Text>
              {sortOrder === 'oldest' && (
                <Ionicons name="checkmark" size={16} color={colors.text} style={{ marginLeft: 'auto' }} />
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    minHeight: 40,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
    color: '#000',
  },
  sortButton: {
    paddingLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  tagChip: {
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagChipActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  tagChipText: {
    fontSize: 14,
    lineHeight: 18,
    color: '#374151',
    fontWeight: '500',
  },
  tagChipTextActive: {
    color: '#fff',
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  word: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 3,
  },
  definition: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#EEF2F7',
    marginLeft: 16,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  listEmpty: {
    flexGrow: 1,
  },
  fab: {
    position: 'absolute',
    right: 24,
    backgroundColor: '#111827',
    borderRadius: 32,
    padding: 14,
  },
  sortMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 999,
  },
  sortMenu: {
    position: 'absolute',
    right: 12,
    borderRadius: 8,
    borderWidth: 1,
    padding: 4,
    width: 200,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  sortMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  sortMenuItemText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
