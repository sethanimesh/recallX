import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useDynamicInsets } from '@/src/hooks/useDynamicInsets';
import { Ionicons } from '@expo/vector-icons';
import { fetchPrompts, PromptRecord } from '@/src/api/promptsClient';
import { useThemeColors } from '@/src/utils/theme';

export default function ManagePromptsScreen() {
  const insets = useDynamicInsets();
  const colors = useThemeColors();
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPrompts();
      setPrompts(data);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to load prompts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPrompts();
    }, [loadPrompts])
  );

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'AI Prompts',
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerBackVisible: false,
        }}
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={[styles.headerText, { color: colors.textSecondary }]}>
            Configure the underlying system prompts used by the AI for different features.
          </Text>

          <View style={[styles.listContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {prompts.map((p, index) => (
              <TouchableOpacity
                key={p.id}
                style={[
                  styles.row,
                  { borderColor: colors.border },
                  index === prompts.length - 1 && { borderBottomWidth: 0 },
                ]}
                onPress={() => router.push(`/edit-prompt?id=${p.id}`)}
              >
                <View style={styles.rowContent}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{capitalize(p.id)} Prompt</Text>
                  <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>
                    {p.prompt_text}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 16,
  },
  headerText: {
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  listContainer: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  rowContent: {
    flex: 1,
    marginRight: 16,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  rowSubtitle: {
    fontSize: 13,
  },
});
