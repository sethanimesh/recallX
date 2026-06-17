import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchPrompts, updatePrompt, resetPrompt, PromptRecord } from '@/src/api/promptsClient';
import { useThemeColors } from '@/src/utils/theme';

export default function EditPromptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  const [record, setRecord] = useState<PromptRecord | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchPrompts();
        const found = data.find((p) => p.id === id);
        if (found) {
          setRecord(found);
          setText(found.prompt_text);
        } else {
          Alert.alert('Error', 'Prompt not found.');
          router.back();
        }
      } catch (err) {
        console.error(err);
        Alert.alert('Error', 'Failed to load prompt.');
      } finally {
        setLoading(false);
      }
    }
    if (id) load();
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await updatePrompt(id, text);
      Alert.alert('Success', 'Prompt updated successfully.', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to save prompt.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!id) return;
    Alert.alert(
      'Reset Prompt',
      'Are you sure you want to reset this prompt to its default value?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const res = await resetPrompt(id);
              setText(res.prompt_text);
              Alert.alert('Success', 'Prompt reset to default.');
            } catch (err) {
              console.error(err);
              Alert.alert('Error', 'Failed to reset prompt.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  if (loading || !record) {
    return <View style={[styles.container, { backgroundColor: colors.background }]} />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          headerTitle: `Edit ${capitalize(id)} Prompt`,
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerRight: () => (
            <TouchableOpacity onPress={handleSave} disabled={saving} style={{ marginRight: 16 }}>
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600', opacity: saving ? 0.5 : 1 }}>
                Save
              </Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: colors.textSecondary }]}>Prompt Text</Text>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
          ]}
          multiline
          value={text}
          onChangeText={setText}
          placeholder="Enter system prompt here..."
          placeholderTextColor={colors.textSecondary}
          textAlignVertical="top"
        />

        <TouchableOpacity style={[styles.resetButton, { borderColor: colors.error }]} onPress={handleReset} disabled={saving}>
          <Text style={[styles.resetText, { color: colors.error }]}>Reset to Default</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    minHeight: 250,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  resetButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  resetText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
