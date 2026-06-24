import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useDynamicInsets } from '@/src/hooks/useDynamicInsets';
import { getBackendUrl, setBackendUrl } from '@/src/config/settings';
import { useThemeColors } from '@/src/utils/theme';

export default function SettingsUrlScreen() {
  const insets = useDynamicInsets();
  const colors = useThemeColors();
  const [url, setUrl] = useState(getBackendUrl());
  const [error, setError] = useState<string | null>(null);

  function validate(value: string): string | null {
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      return 'URL must start with http:// or https://';
    }
    return null;
  }

  async function handleSave() {
    const err = validate(url.trim());
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    await setBackendUrl(url.trim());
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingBottom: insets.bottom, backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>Backend URL</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground }, error ? { borderColor: colors.error } : null]}
        value={url}
        onChangeText={(t) => { setUrl(t); setError(null); }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://192.168.x.x:8000"
        placeholderTextColor={colors.textSecondary}
      />
      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
      <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={handleSave} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Save</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 32,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  },
  inputError: {
    borderColor: '#EF4444',
  },
  error: {
    marginTop: 6,
    fontSize: 13,
    color: '#EF4444',
  },
  button: {
    marginTop: 24,
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
