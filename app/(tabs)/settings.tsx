import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActionSheetIOS } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import {
  getBackendUrl,
  getPreferredProvider,
  setPreferredProvider,
  resetSRSProgress,
  getPronunciationVoice,
  setPronunciationVoice,
  getDefaultSortOrder,
  setDefaultSortOrder,
} from '@/src/config/settings';
import { useThemeColors } from '@/src/utils/theme';
import * as Speech from 'expo-speech';
import VoicePickerSheet from '@/src/components/VoicePickerSheet';

type ProvidersStatus = 'loading' | 'loaded' | 'error';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [currentUrl, setCurrentUrl] = useState(getBackendUrl());
  const [providers, setProviders] = useState<string[]>([]);
  const [providersStatus, setProvidersStatus] = useState<ProvidersStatus>('loading');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(getPreferredProvider());
  const [selectedVoice, setSelectedVoice] = useState<string | null>(getPronunciationVoice());
  const [voiceSheetVisible, setVoiceSheetVisible] = useState(false);
  const [displayVoiceName, setDisplayVoiceName] = useState('System Default');
  const [defaultSortOrder, setDefaultSortOrderState] = useState(getDefaultSortOrder());
  const [showSortOrderDropdown, setShowSortOrderDropdown] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setCurrentUrl(getBackendUrl());
      setDefaultSortOrderState(getDefaultSortOrder());
      setProvidersStatus('loading');
      async function loadProviders() {
        try {
          const res = await fetch(`${getBackendUrl()}/providers`);
          if (!res.ok) throw new Error('Failed');
          const data = await res.json();
          setProviders(data.providers as string[]);
          setProvidersStatus('loaded');
        } catch (err) {
          console.warn('[Settings] loadProviders failed:', err);
          setProvidersStatus('error');
        }
      }
      async function updateVoiceDisplayName() {
        const activeVoiceId = getPronunciationVoice();
        setSelectedVoice(activeVoiceId);
        if (!activeVoiceId) {
          setDisplayVoiceName('System Default');
          return;
        }
        try {
          const list = await Speech.getAvailableVoicesAsync();
          const found = list.find((v) => v.identifier === activeVoiceId);
          setDisplayVoiceName(found ? found.name : 'Custom Voice');
        } catch {
          setDisplayVoiceName('Custom Voice');
        }
      }
      loadProviders();
      void updateVoiceDisplayName();
    }, []),
  );

  function openProviderPicker() {
    const options = ['None (auto)', ...providers, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1 },
      (index) => {
        if (index === options.length - 1) return;
        const chosen = index === 0 ? null : providers[index - 1];
        setSelectedProvider(chosen);
        setPreferredProvider(chosen).catch((err) => console.warn('[Settings] setPreferredProvider failed:', err));
      },
    );
  }

  const handleSelectVoice = async (voiceId: string | null) => {
    setSelectedVoice(voiceId);
    await setPronunciationVoice(voiceId);
    if (!voiceId) {
      setDisplayVoiceName('System Default');
      return;
    }
    try {
      const list = await Speech.getAvailableVoicesAsync();
      const found = list.find((v) => v.identifier === voiceId);
      setDisplayVoiceName(found ? found.name : 'Custom Voice');
    } catch {
      setDisplayVoiceName('Custom Voice');
    }
  };

  function handleResetSRS() {
    Alert.alert(
      'Reset SRS Progress',
      'This will reset all spaced repetition progress. Your words and tags are kept. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              await resetSRSProgress();
              Alert.alert('Done', 'SRS progress has been reset.');
            } catch {
              Alert.alert('Error', 'Reset failed, try again.');
            }
          },
        },
      ],
    );
  }

  const providerSubtitle =
    providersStatus === 'loading'
      ? 'Loading…'
      : providersStatus === 'error'
        ? 'Unavailable'
        : selectedProvider ?? 'None (auto)';

  const colors = useThemeColors();
  const version = Constants.expoConfig?.version ?? '—';

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text, backgroundColor: colors.background }]}>Settings</Text>

      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>LIBRARY</Text>

        <TouchableOpacity style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/manage-tags')} activeOpacity={0.7}>
          <Ionicons name="pricetags-outline" size={22} color={colors.textSecondary} style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Manage Tags</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/export-words')} activeOpacity={0.7}>
          <Ionicons name="download-outline" size={22} color={colors.textSecondary} style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Export Words</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/llm-stats')} activeOpacity={0.7}>
          <Ionicons name="hardware-chip-outline" size={22} color={colors.textSecondary} style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>AI Usage</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowSortOrderDropdown((prev) => !prev)}
          activeOpacity={0.7}
        >
          <Ionicons name="filter-outline" size={22} color={colors.textSecondary} style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Default Sorting Mode</Text>
            <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
              {sortOrderLabel(defaultSortOrder)}
            </Text>
          </View>
          <Ionicons name={showSortOrderDropdown ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        {showSortOrderDropdown && (
          <View style={[styles.dropdownContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {(['alphabetical', 'newest', 'oldest'] as const).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.dropdownRow,
                  { borderColor: colors.border },
                  defaultSortOrder === mode && { backgroundColor: colors.inputBackground }
                ]}
                onPress={async () => {
                  setDefaultSortOrderState(mode);
                  await setDefaultSortOrder(mode);
                  setShowSortOrderDropdown(false);
                }}
              >
                <Text style={[styles.dropdownLabel, { color: colors.text }, defaultSortOrder === mode && { fontWeight: '700' }]}>
                  {sortOrderLabel(mode)}
                </Text>
                {defaultSortOrder === mode && (
                  <Ionicons name="checkmark" size={18} color={colors.primary ?? colors.text} style={{ marginLeft: 'auto' }} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>CONNECTION</Text>

        <TouchableOpacity style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/settings-url' as any)} activeOpacity={0.7}>
          <Ionicons name="server-outline" size={22} color={colors.textSecondary} style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Backend URL</Text>
            <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>{currentUrl}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={providersStatus === 'loaded' ? openProviderPicker : undefined}
          activeOpacity={providersStatus === 'loaded' ? 0.7 : 1}
        >
          <Ionicons name="sparkles-outline" size={22} color={colors.textSecondary} style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>AI Provider</Text>
            <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>{providerSubtitle}</Text>
          </View>
          {providersStatus === 'loaded' && <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>APP</Text>

        <TouchableOpacity style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setVoiceSheetVisible(true)} activeOpacity={0.7}>
          <Ionicons name="volume-high-outline" size={22} color={colors.textSecondary} style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Pronunciation Voice</Text>
            <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>{displayVoiceName}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="information-circle-outline" size={22} color={colors.textSecondary} style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Version</Text>
            <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>{version}</Text>
          </View>
        </View>

        <TouchableOpacity style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={handleResetSRS} activeOpacity={0.7}>
          <Ionicons name="refresh-outline" size={22} color={colors.error} style={styles.rowIcon} />
          <Text style={[styles.rowLabel, styles.destructive, { color: colors.error }]}>Reset SRS Progress</Text>
        </TouchableOpacity>
      </View>

      <VoicePickerSheet
        visible={voiceSheetVisible}
        onClose={() => setVoiceSheetVisible(false)}
        selectedVoiceId={selectedVoice}
        onSelectVoice={handleSelectVoice}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#F3F4F6',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
    marginBottom: -StyleSheet.hairlineWidth,
  },
  rowIcon: {
    marginRight: 14,
  },
  rowContent: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 16,
    color: '#111827',
  },
  rowSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 1,
  },
  destructive: {
    color: '#EF4444',
    flex: 1,
  },
  dropdownContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 56,
    paddingRight: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  dropdownLabel: {
    fontSize: 15,
  },
});

function sortOrderLabel(mode: 'alphabetical' | 'newest' | 'oldest'): string {
  if (mode === 'newest') return 'Newest First';
  if (mode === 'oldest') return 'Oldest First';
  return 'Alphabetical (A-Z)';
}
