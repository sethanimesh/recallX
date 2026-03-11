import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getAllTags,
  renameTag,
  deleteTag,
  getTagWordCounts,
  findTagByName,
  mergeTagIntoExisting,
  type Tag,
} from '@/src/db/operations/tags';
import { WordServerError } from '@/src/api/wordServerClient';

interface TagWithCount extends Tag {
  count: number;
}

export async function submitTagRename(tag: Tag, newName: string | undefined, load: () => Promise<void>): Promise<void> {
  const trimmedName = newName?.trim();
  if (!trimmedName || trimmedName === tag.name) return;

  const confirmMerge = (targetTag: Tag) => {
    Alert.alert(
      'Merge Tags?',
      `"${tag.name}" will be merged into "${targetTag.name}". Words from both tags will use "${targetTag.name}", and duplicates will be ignored.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          onPress: () => {
            Alert.alert(
              'Are You Sure?',
              `This will remove "${tag.name}" and keep "${targetTag.name}" as the combined tag.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Merge Tags',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await mergeTagIntoExisting(tag.id, targetTag.id);
                      await load();
                    } catch (err) {
                      const message = err instanceof Error ? err.message : 'Could not merge tags.';
                      Alert.alert('Merge Failed', message);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  try {
    await renameTag(tag.id, trimmedName);
    await load();
  } catch (err) {
    if (err instanceof WordServerError && err.statusCode === 409) {
      try {
        const existingTag = await findTagByName(trimmedName);
        if (existingTag && existingTag.id !== tag.id) {
          confirmMerge(existingTag);
          return;
        }
      } catch {}
    }
    const message = err instanceof Error ? err.message : 'Could not rename tag.';
    Alert.alert('Rename Failed', message);
  }
}

export default function ManageTagsScreen() {
  const insets = useSafeAreaInsets();
  const [tags, setTags] = useState<TagWithCount[]>([]);

  const load = useCallback(async () => {
    const [allTags, counts] = await Promise.all([getAllTags(), getTagWordCounts()]);
    setTags(allTags.map((t) => ({ ...t, count: counts[t.id] ?? 0 })));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const handleRename = useCallback((tag: TagWithCount) => {
    Alert.prompt(
      'Rename Tag',
      `Rename "${tag.name}" to:`,
      (newName) => {
        submitTagRename(tag, newName, load);
      },
      'plain-text',
      tag.name,
    );
  }, [load]);

  const handleDelete = useCallback((tag: TagWithCount) => {
    Alert.alert(
      'Delete Tag',
      `Words tagged "${tag.name}" will lose it. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTag(tag.id);
              await load();
            } catch {
              Alert.alert('Error', 'Could not delete tag.');
            }
          },
        },
      ],
    );
  }, [load]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<TagWithCount>) => (
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Text style={styles.tagName}>{item.name}</Text>
          <Text style={styles.tagCount}>{item.count} {item.count === 1 ? 'word' : 'words'}</Text>
        </View>
        <View style={styles.rowActions}>
          <TouchableOpacity
            testID={`rename-tag-${item.id}`}
            onPress={() => handleRename(item)}
            hitSlop={8}
            style={styles.actionBtn}
          >
            <Ionicons name="pencil-outline" size={20} color="#007AFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={8} style={styles.actionBtn}>
            <Ionicons name="trash-outline" size={20} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      </View>
    ),
    [handleRename, handleDelete],
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Manage Tags' }} />
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <FlatList
          data={tags}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No tags yet — tag words to create them</Text>
            </View>
          }
          contentContainerStyle={tags.length === 0 ? styles.listEmpty : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowLeft: {
    flex: 1,
  },
  tagName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  tagCount: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 2,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 16,
  },
  actionBtn: {
    padding: 4,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginLeft: 20,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#9CA3AF',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  listEmpty: {
    flexGrow: 1,
  },
});
