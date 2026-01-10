import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isNull, asc } from 'drizzle-orm';
import { db } from '@/src/db/client';
import { words as wordsTable } from '@/src/db/schema';
import { filterWords } from '@/src/screens/libraryLogic';

type WordRow = {
  id: string;
  word: string;
  definition: string;
};

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const [allWords, setAllWords] = useState<WordRow[]>([]);
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      db.select({
        id: wordsTable.id,
        word: wordsTable.word,
        definition: wordsTable.definition,
      })
        .from(wordsTable)
        .where(isNull(wordsTable.deleted_at))
        .orderBy(asc(wordsTable.word))
        .then((rows) => {
          if (active) setAllWords(rows);
        })
        .catch((err) => {
          if (__DEV__) console.warn('[LibraryScreen] word query failed', err);
          if (active) setAllWords([]);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const filtered = filterWords(allWords, query);

  const renderItem = ({ item }: ListRenderItemInfo<WordRow>) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/words/${item.id}`)}
      activeOpacity={0.7}
    >
      <Text style={styles.word}>{item.word}</Text>
      <Text style={styles.definition} numberOfLines={1} ellipsizeMode="tail">
        {item.definition.length > 80
          ? item.definition.slice(0, 80)
          : item.definition}
      </Text>
    </TouchableOpacity>
  );

  const renderEmpty = () => {
    if (allWords.length === 0) {
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
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={18} color="#999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search words..."
          placeholderTextColor="#999"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
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
    backgroundColor: '#f2f2f7',
    borderRadius: 10,
    height: 40,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#000',
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
