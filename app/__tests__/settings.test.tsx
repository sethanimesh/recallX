import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
  },
  useFocusEffect: (callback: () => void) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('expo-constants', () => ({
  expoConfig: {
    version: '1.0.0',
  },
}));

const mockGetBackendUrl = jest.fn(() => 'http://localhost:8000');
const mockGetPreferredProvider = jest.fn(() => null);
const mockSetPreferredProvider = jest.fn().mockResolvedValue(undefined);
const mockResetSRSProgress = jest.fn().mockResolvedValue(undefined);
const mockGetPronunciationVoice = jest.fn(() => null);
const mockSetPronunciationVoice = jest.fn().mockResolvedValue(undefined);
const mockGetDefaultSortOrder = jest.fn(() => 'alphabetical');
const mockSetDefaultSortOrder = jest.fn().mockResolvedValue(undefined);

jest.mock('@/src/config/settings', () => ({
  getCommonHeaders: jest.fn(() => ({})),
  getBackendUrl: () => mockGetBackendUrl(),
  getPreferredProvider: () => mockGetPreferredProvider(),
  setPreferredProvider: (...args: unknown[]) => mockSetPreferredProvider(...args),
  resetSRSProgress: (...args: unknown[]) => mockResetSRSProgress(...args),
  getPronunciationVoice: () => mockGetPronunciationVoice(),
  setPronunciationVoice: (...args: unknown[]) => mockSetPronunciationVoice(...args),
  getDefaultSortOrder: () => mockGetDefaultSortOrder(),
  setDefaultSortOrder: (...args: unknown[]) => mockSetDefaultSortOrder(...args),
}));

jest.mock('@/src/components/VoicePickerSheet', () => () => null);

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ providers: [] }),
}) as jest.Mock;

import SettingsScreen from '../(tabs)/settings';

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ providers: [] }),
    });
  });

  it('navigates to export words from the settings list', async () => {
    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    fireEvent.press(getByText('Export Words'));

    expect(mockPush).toHaveBeenCalledWith('/export-words');
  });
});
