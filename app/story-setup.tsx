import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ListRenderItemInfo,
  TextInput,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getAllTags, fetchAllWords, fetchWordsByTag, type Tag, type WordRow } from '@/src/db/operations/tags';
import { generateStory, fetchBackendStories, saveBackendStory, deleteBackendStory, type SavedStory } from '@/src/api/storyClient';
import { useThemeColors } from '@/src/utils/theme';

type DeckOption = { id: string | null; name: string };

export default function StorySetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [words, setWords] = useState<WordRow[]>([]);
  const [customPrompt, setCustomPrompt] = useState('');
  
  const [stories, setStories] = useState<SavedStory[]>([]);
  const [loading, setLoading] = useState(false);
  const pulseAnim = React.useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (loading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 800, useNativeDriver: true })
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(0.6);
    }
  }, [loading, pulseAnim]);

  useFocusEffect(
    useCallback(() => {
      getAllTags().then(setTags);
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      async function loadDeckInfo() {
        const rows = selectedTagId === null
          ? await fetchAllWords()
          : await fetchWordsByTag(selectedTagId);
        
        const savedStories = await fetchBackendStories(null);
        
        if (!cancelled) {
          setWords(rows);
          setWordCount(rows.length);
          setStories(savedStories);
        }
      }
      loadDeckInfo().catch(() => {});
      return () => { cancelled = true; };
    }, [selectedTagId])
  );

  const handleGenerate = async () => {
    if (words.length === 0) return;
    
    if (words.length > 20) {
      Alert.alert(
        'Large Deck',
        `You have ${words.length} words in this deck. Generating a story for this many words may take a while and produce a very large story. Do you want to proceed?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Proceed', onPress: doGenerate },
        ]
      );
    } else {
      doGenerate();
    }
  };

  const doGenerate = async () => {
    setLoading(true);
    try {
      // Navigate to the view screen with a special parameter indicating generation
      // Instead of keeping state here and navigating after, we can pass words as params?
      // Passing 100 words in navigation params is bad. 
      // Instead, let's generate it here and pass the ID.
      const payload = {
        words: words.map(w => ({ word: w.word, definition: w.definition })),
        custom_prompt: customPrompt,
      };
      const response = await generateStory(payload);
      
      // Save it to the backend immediately
      const saved = await saveBackendStory({
        id: Crypto.randomUUID(),
        tag_id: selectedTagId,
        prompt: customPrompt,
        title: response.title,
        content: response.content,
        created_at: Math.floor(Date.now() / 1000),
      });
      
      // Navigate to view it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push({ pathname: '/story-view' as any, params: { storyId: saved.id } });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to generate story.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenStory = (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push({ pathname: '/story-view' as any, params: { storyId: id } });
  };

  const handleDeleteStory = (id: string) => {
    Alert.alert('Delete Story', 'Are you sure you want to delete this story?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteBackendStory(id);
        setStories(prev => prev.filter(s => s.id !== id));
      }}
    ]);
  };

  const deckOptions: DeckOption[] = [{ id: null, name: 'All Words' }, ...tags];

  const getTagName = (tagId: string | null) => {
    if (!tagId) return 'All Words';
    const tag = tags.find(t => t.id === tagId);
    return tag ? tag.name : 'Unknown Deck';
  };

  const renderDeckItem = useCallback(
    ({ item }: ListRenderItemInfo<DeckOption>) => {
      const isSelected = item.id === selectedTagId;
      return (
        <TouchableOpacity
          style={[styles.row, { backgroundColor: colors.card }, isSelected && { backgroundColor: colors.primary }]}
          onPress={() => setSelectedTagId(item.id)}
          accessibilityRole="radio"
        >
          <Text style={[styles.rowText, { color: colors.text }, isSelected && { color: '#fff', fontWeight: '600' }]}>{item.name}</Text>
        </TouchableOpacity>
      );
    },
    [selectedTagId, colors],
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16, paddingTop: insets.top + 16, backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Story Setup</Text>
        <View style={styles.backButton} />
      </View>

      <Text style={[styles.heading, { color: colors.textSecondary }]}>Choose a Deck</Text>
      <View style={[styles.listWrapper, { borderColor: colors.border }]}>
        <FlatList
          data={deckOptions}
          keyExtractor={(item) => item.id ?? '__all__'}
          renderItem={renderDeckItem}
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
          style={styles.list}
          nestedScrollEnabled
        />
      </View>
      <Text style={[styles.wordCount, { color: colors.textSecondary }]}>
        {wordCount} {wordCount === 1 ? 'word' : 'words'} in selected deck
      </Text>

      <Text style={[styles.heading, { color: colors.textSecondary, marginTop: 16 }]}>Custom Instructions (Optional)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
        placeholder="e.g., Make it a sci-fi thriller..."
        placeholderTextColor={colors.textSecondary}
        value={customPrompt}
        onChangeText={setCustomPrompt}
        multiline
      />

      <TouchableOpacity
        style={[
          styles.generateButton,
          { backgroundColor: colors.primary },
          (wordCount === 0 || loading) && { backgroundColor: colors.inputBackground }
        ]}
        onPress={handleGenerate}
        disabled={wordCount === 0 || loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={[styles.generateButtonText, wordCount === 0 && { color: colors.textSecondary }]}>
            Generate Story
          </Text>
        )}
      </TouchableOpacity>

      {stories.length > 0 && (
        <>
          <Text style={[styles.heading, { color: colors.textSecondary, marginTop: 24 }]}>Past Stories</Text>
          <FlatList
            data={stories}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={[styles.storyCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleOpenStory(item.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.storyTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                  <View style={styles.storyMetaRow}>
                    <View style={[styles.tagPill, { backgroundColor: colors.inputBackground }]}>
                      <Text style={[styles.tagPillText, { color: colors.textSecondary }]}>{getTagName(item.tag_id)}</Text>
                    </View>
                    <Text style={[styles.storyDate, { color: colors.textSecondary }]}>{new Date(item.created_at * 1000).toLocaleDateString()}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => handleDeleteStory(item.id)} style={{ padding: 8 }}>
                  <Ionicons name="trash-outline" size={20} color={colors.error} />
                </TouchableOpacity>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            style={{ flex: 1, marginTop: 8 }}
          />
        </>
      )}

      {loading && (
        <View style={[StyleSheet.absoluteFill, styles.loadingOverlay, { backgroundColor: colors.background }]}>
          <Animated.View style={{ opacity: pulseAnim, transform: [{ scale: pulseAnim }] }}>
            <Ionicons name="sparkles" size={64} color={colors.primary} style={{ alignSelf: 'center', marginBottom: 24 }} />
          </Animated.View>
          <Animated.Text style={[styles.loadingText, { color: colors.text, opacity: pulseAnim }]}>
            Generating your story...
          </Animated.Text>
          <Text style={[styles.loadingSubtext, { color: colors.textSecondary }]}>
            Crafting a unique tale with your {wordCount} words. This might take a few moments.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  heading: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  listWrapper: {
    height: 150,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  list: { flex: 1 },
  row: { paddingHorizontal: 16, paddingVertical: 12 },
  rowText: { fontSize: 16 },
  separator: { height: StyleSheet.hairlineWidth },
  wordCount: { fontSize: 13, marginTop: 8, textAlign: 'right' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    minHeight: 80,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  generateButton: {
    marginTop: 16,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  generateButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  storyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  storyTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  storyMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  tagPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginRight: 8 },
  tagPillText: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase' },
  storyDate: { fontSize: 12 },
  loadingOverlay: {
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
    padding: 32,
  },
  loadingText: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  loadingSubtext: { fontSize: 16, textAlign: 'center', lineHeight: 24 },
});
