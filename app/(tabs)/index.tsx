import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isNull, asc } from 'drizzle-orm';
import { db } from '@/src/db/client';
import { words as wordsTable } from '@/src/db/schema';
import { filterWords } from '@/src/screens/libraryLogic';
import { getAllTags, fetchWordsByTag, type Tag } from '@/src/db/operations/tags';

type WordRow = {
  id: string;
  word: string;
  definition: string;
};

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const [allWords, setAllWords] = useState<WordRow[]>([]);
  const [query, setQuery] = useState('');
  const [filterTags, setFilterTags] = useState<Tag[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  const fetchWords = useCallback(async (tagId: string | null) => {
    if (tagId) {
      const rows = await fetchWordsByTag(tagId);
      setAllWords(rows.map((r) => ({ id: r.id, word: r.word, definition: r.definition })));
    } else {
      const rows = await db
        .select({ id: wordsTable.id, word: wordsTable.word, definition: wordsTable.definition })
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

  const filtered = filterWords(allWords, query);

  const ItemSeparator = useCallback(() => <View style={styles.separator} />, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<WordRow>) => (
      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push(`/words/${item.id}`)}
        activeOpacity={0.7}
      >
        <Text style={styles.word}>{item.word}</Text>
        <Text style={styles.definition} numberOfLines={1} ellipsizeMode="tail">
          {item.definition}
        </Text>
      </TouchableOpacity>
    ),
    [],
  );

  const renderEmpty = useCallback(() => {
    if (allWords.length === 0 && !query) {
      if (activeTagName) {
        return (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No words tagged '{activeTagName}'</Text>
          </View>
        );
      }
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No words yet — tap + to add some</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No matches for '{query}'</Text>
      </View>
    );
  }, [allWords.length, query, activeTagName]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Search bar */}
      <View testID="library-search-row" style={styles.searchRow}>
        <Ionicons name="search-outline" size={18} color="#999" style={styles.searchIcon} />
        <TextInput
          testID="library-search-input"
          style={styles.searchInput}
          placeholder="Search words..."
          placeholderTextColor="#999"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Tag filter strip */}
      {filterTags.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tagStrip}
          contentContainerStyle={styles.tagStripContent}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            testID="library-tag-chip-all"
            style={[styles.tagChip, activeTagId === null && styles.tagChipActive]}
            onPress={() => { setActiveTagId(null); setQuery(''); }}
          >
            <Text style={[styles.tagChipText, activeTagId === null && styles.tagChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {filterTags.map((tag) => (
            <TouchableOpacity
              key={tag.id}
              style={[styles.tagChip, activeTagId === tag.id && styles.tagChipActive]}
              onPress={() => handleTagPress(tag.id)}
            >
              <Text style={[styles.tagChipText, activeTagId === tag.id && styles.tagChipTextActive]}>
                {tag.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        ItemSeparatorComponent={ItemSeparator}
        contentContainerStyle={filtered.length === 0 ? styles.listEmpty : undefined}
        keyboardShouldPersistTaps="handled"
      />
      <TouchableOpacity
        style={[styles.fab, { bottom: 24 + insets.bottom }]}
        onPress={() => router.push('/ingest')}
      >
        <Ionicons name="add" size={28} color="white" />
      </TouchableOpacity>
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
    backgroundColor: '#f2f2f7',
    borderRadius: 10,
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
  tagStrip: {
    flexGrow: 0,
    marginBottom: 4,
  },
  tagStripContent: {
    paddingHorizontal: 12,
    gap: 8,
    paddingBottom: 8,
  },
  tagChip: {
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
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
    paddingVertical: 12,
  },
  word: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 2,
  },
  definition: {
    fontSize: 14,
    color: '#666',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e0e0e0',
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
    backgroundColor: '#007AFF',
    borderRadius: 32,
    padding: 16,
  },
});
