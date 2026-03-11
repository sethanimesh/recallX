import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActionSheetIOS } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import {
  getBackendUrl,
  getPreferredProvider,
  setPreferredProvider,
  resetSRSProgress,
} from '@/src/config/settings';

type ProvidersStatus = 'loading' | 'loaded' | 'error';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [currentUrl, setCurrentUrl] = useState(getBackendUrl());
  const [providers, setProviders] = useState<string[]>([]);
  const [providersStatus, setProvidersStatus] = useState<ProvidersStatus>('loading');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(getPreferredProvider());

  useEffect(() => {
    async function loadProviders() {
      try {
        const res = await fetch(`${getBackendUrl()}/providers`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        setProviders(data.providers as string[]);
        setProvidersStatus('loaded');
      } catch {
        setProvidersStatus('error');
      }
    }
    loadProviders();
  }, []);

  // Refresh URL display when returning from the URL edit screen
  useEffect(() => {
    setCurrentUrl(getBackendUrl());
  });

  function openProviderPicker() {
    const options = ['None (auto)', ...providers, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1 },
      (index) => {
        if (index === options.length - 1) return;
        const chosen = index === 0 ? null : providers[index - 1];
        setSelectedProvider(chosen);
        setPreferredProvider(chosen).catch(() => {});
      },
    );
  }

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

  const version = Constants.expoConfig?.version ?? '—';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>LIBRARY</Text>

        <TouchableOpacity style={styles.row} onPress={() => router.push('/manage-tags')} activeOpacity={0.7}>
          <Ionicons name="pricetags-outline" size={22} color="#374151" style={styles.rowIcon} />
          <Text style={styles.rowLabel}>Manage Tags</Text>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => router.push('/llm-stats')} activeOpacity={0.7}>
          <Ionicons name="hardware-chip-outline" size={22} color="#374151" style={styles.rowIcon} />
          <Text style={styles.rowLabel}>AI Usage</Text>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>CONNECTION</Text>

        <TouchableOpacity style={styles.row} onPress={() => router.push('/settings-url' as any)} activeOpacity={0.7}>
          <Ionicons name="server-outline" size={22} color="#374151" style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Backend URL</Text>
            <Text style={styles.rowSubtitle} numberOfLines={1}>{currentUrl}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.row}
          onPress={providersStatus === 'loaded' ? openProviderPicker : undefined}
          activeOpacity={providersStatus === 'loaded' ? 0.7 : 1}
        >
          <Ionicons name="sparkles-outline" size={22} color="#374151" style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>AI Provider</Text>
            <Text style={styles.rowSubtitle}>{providerSubtitle}</Text>
          </View>
          {providersStatus === 'loaded' && <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />}
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>APP</Text>

        <View style={styles.row}>
          <Ionicons name="information-circle-outline" size={22} color="#374151" style={styles.rowIcon} />
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowSubtitle}>{version}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.row} onPress={handleResetSRS} activeOpacity={0.7}>
          <Ionicons name="refresh-outline" size={22} color="#EF4444" style={styles.rowIcon} />
          <Text style={[styles.rowLabel, styles.destructive]}>Reset SRS Progress</Text>
        </TouchableOpacity>
      </View>
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
});
