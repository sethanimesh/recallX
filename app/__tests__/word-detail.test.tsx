import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';
import { render, fireEvent, waitFor, act as actRTL } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockBack = jest.fn();
const mockSetParams = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({ id: 'word-1' }));
type MockScreenProps = {
  options?: {
    headerRight?: () => React.ReactElement;
  };
};
const mockScreen = jest.fn((_props: MockScreenProps) => null);

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  router: { back: (...args: unknown[]) => mockBack(...args), setParams: (...args: unknown[]) => mockSetParams(...args) },
  Stack: {
    Screen: (props: unknown) => mockScreen(props as MockScreenProps),
  },
}));

const mockGetNav = jest.fn();
const mockNavigate = jest.fn();
const mockClearNav = jest.fn();
jest.mock('@/src/store/libraryNav', () => ({
  getNav: () => mockGetNav(),
  navigate: (...args: unknown[]) => mockNavigate(...args),
  clearNav: () => mockClearNav(),
}));

const mockFetchWordWithSource = jest.fn();
const mockUpdateWordField = jest.fn();
const mockSoftDeleteWord = jest.fn();

jest.mock('@/src/db/operations/wordDetail', () => ({
  fetchWordWithSource: (...args: unknown[]) => mockFetchWordWithSource(...args),
  updateWordField: (...args: unknown[]) => mockUpdateWordField(...args),
  softDeleteWord: (...args: unknown[]) => mockSoftDeleteWord(...args),
}));

const mockGetTagsForWord = jest.fn();
const mockRemoveTagFromWord = jest.fn();

jest.mock('@/src/db/operations/tags', () => ({
  getTagsForWord: (...args: unknown[]) => mockGetTagsForWord(...args),
  removeTagFromWord: (...args: unknown[]) => mockRemoveTagFromWord(...args),
}));

const mockFetchWordHistory = jest.fn();
jest.mock('@/src/db/operations/sessionHistory', () => ({
  fetchWordHistory: (...args: unknown[]) => mockFetchWordHistory(...args),
}));

jest.mock('@/src/components/TagPickerSheet', () => () => null);

const mockGetPronunciation = jest.fn();
class MockWordServerError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'WordServerError';
  }
}
jest.mock('@/src/api/wordServerClient', () => ({
  getPronunciation: (...args: unknown[]) => mockGetPronunciation(...args),
  WordServerError: MockWordServerError,
}));

const mockPlayAsync = jest.fn();
const mockUnloadAsync = jest.fn();
const mockSetOnPlaybackStatusUpdate = jest.fn();
const mockCreateAsync = jest.fn();
const mockSetAudioModeAsync = jest.fn();
jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: (...args: unknown[]) => mockSetAudioModeAsync(...args),
    Sound: {
      createAsync: (...args: unknown[]) => mockCreateAsync(...args),
    },
  },
}));

import WordDetailScreen from '../words/[id]';

describe('WordDetailScreen header delete action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPronunciation.mockResolvedValue({
      word: 'alacrity',
      audio_url: 'https://audio.example/alacrity-us.mp3',
      source: 'dictionaryapi.dev',
      accent: 'us',
    });
    mockSetAudioModeAsync.mockResolvedValue(undefined);
    mockCreateAsync.mockResolvedValue({
      sound: {
        playAsync: mockPlayAsync,
        unloadAsync: mockUnloadAsync,
        setOnPlaybackStatusUpdate: mockSetOnPlaybackStatusUpdate,
      },
    });
    mockPlayAsync.mockResolvedValue(undefined);
    mockUnloadAsync.mockResolvedValue(undefined);
    mockFetchWordWithSource.mockResolvedValue({
      id: 'word-1',
      word: 'alacrity',
      definition: 'A feeling of happy excitement or eagerness.',
      example_sentence: 'She accepted the challenge with alacrity.',
      source: null,
    });
    mockGetTagsForWord.mockResolvedValue([]);
    mockUpdateWordField.mockResolvedValue(undefined);
    mockSoftDeleteWord.mockResolvedValue(undefined);
    mockFetchWordHistory.mockResolvedValue([]);
    mockGetNav.mockReturnValue({ active: false, ids: [], index: 0 });
  });

  it('centers the header trash icon inside a square touch target', async () => {
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<WordDetailScreen />);
      await Promise.resolve();
    });

    expect(tree.toJSON()).toBeTruthy();

    const screenCalls = mockScreen.mock.calls;
    const detailScreenCall = screenCalls.find(
      ([props]) => props?.options?.headerRight,
    );
    expect(detailScreenCall).toBeTruthy();

    const headerRight = (detailScreenCall![0] as MockScreenProps).options!.headerRight!;
    const headerAction = headerRight() as React.ReactElement<{
      accessibilityLabel?: string;
      style?: unknown;
    }>;
    const buttonStyle = StyleSheet.flatten(headerAction.props.style) as ViewStyle;

    expect(headerAction.props.accessibilityLabel).toBe('Delete word');
    expect(buttonStyle.width).toBe(32);
    expect(buttonStyle.height).toBe(32);
    expect(buttonStyle.alignItems).toBe('center');
    expect(buttonStyle.justifyContent).toBe('center');
  });
});

describe('WordDetailScreen navigation bar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPronunciation.mockResolvedValue({
      word: 'alacrity',
      audio_url: 'https://audio.example/alacrity-us.mp3',
      source: 'dictionaryapi.dev',
      accent: 'us',
    });
    mockSetAudioModeAsync.mockResolvedValue(undefined);
    mockCreateAsync.mockResolvedValue({
      sound: {
        playAsync: mockPlayAsync,
        unloadAsync: mockUnloadAsync,
        setOnPlaybackStatusUpdate: mockSetOnPlaybackStatusUpdate,
      },
    });
    mockPlayAsync.mockResolvedValue(undefined);
    mockUnloadAsync.mockResolvedValue(undefined);
    mockFetchWordWithSource.mockResolvedValue({
      id: 'word-1',
      word: 'alacrity',
      definition: 'A feeling of happy excitement.',
      example_sentence: 'She accepted the challenge with alacrity.',
      source: null,
    });
    mockGetTagsForWord.mockResolvedValue([]);
    mockFetchWordHistory.mockResolvedValue([]);
    mockGetNav.mockReturnValue({ active: false, ids: [], index: 0 });
  });

  it('does not render nav bar when active is false', async () => {
    mockGetNav.mockReturnValue({ active: false, ids: [], index: 0 });
    const { queryByTestId } = render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());
    expect(queryByTestId('word-detail-nav-bar')).toBeNull();
  });

  it('renders nav bar with correct counter when active', async () => {
    mockGetNav.mockReturnValue({ active: true, ids: ['w0', 'word-1', 'w2'], index: 1 });
    const { getByTestId, getByText } = render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());
    expect(getByTestId('word-detail-nav-bar')).toBeTruthy();
    expect(getByText('2 / 3')).toBeTruthy();
  });

  it('prev button is disabled at index 0', async () => {
    mockGetNav.mockReturnValue({ active: true, ids: ['word-1', 'w2'], index: 0 });
    const { getByTestId } = render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());
    const prevBtn = getByTestId('word-detail-nav-prev');
    expect(prevBtn.props.accessibilityState?.disabled).toBe(true);
  });

  it('next button is disabled at last index', async () => {
    mockGetNav.mockReturnValue({ active: true, ids: ['w0', 'word-1'], index: 1 });
    const { getByTestId } = render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());
    const nextBtn = getByTestId('word-detail-nav-next');
    expect(nextBtn.props.accessibilityState?.disabled).toBe(true);
  });

  it('tapping next calls navigate(1) and updates the current route params', async () => {
    mockGetNav.mockReturnValue({ active: true, ids: ['word-1', 'w2'], index: 0 });
    mockNavigate.mockReturnValue('w2');
    const { getByTestId } = render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());
    const nextBtn = getByTestId('word-detail-nav-next');
    await actRTL(async () => { fireEvent.press(nextBtn); });
    expect(mockNavigate).toHaveBeenCalledWith(1);
    expect(mockSetParams).toHaveBeenCalledWith({ id: 'w2' });
  });

  it('tapping prev calls navigate(-1) and updates the current route params', async () => {
    mockGetNav.mockReturnValue({ active: true, ids: ['w0', 'word-1'], index: 1 });
    mockNavigate.mockReturnValue('w0');
    const { getByTestId } = render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());
    const prevBtn = getByTestId('word-detail-nav-prev');
    await actRTL(async () => { fireEvent.press(prevBtn); });
    expect(mockNavigate).toHaveBeenCalledWith(-1);
    expect(mockSetParams).toHaveBeenCalledWith({ id: 'w0' });
  });

  it('calls clearNav when mounted with id not matching store index (stale deep-link scenario)', async () => {
    // Store has stale active state pointing to a different word
    mockGetNav.mockReturnValue({ active: true, ids: ['other-word', 'another-word'], index: 0 });
    render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());
    expect(mockClearNav).toHaveBeenCalled();
  });
});

describe('WordDetailScreen pronunciation playback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchWordWithSource.mockResolvedValue({
      id: 'word-1',
      word: 'alacrity',
      definition: 'A feeling of happy excitement.',
      example_sentence: 'She accepted the challenge with alacrity.',
      source: null,
    });
    mockGetTagsForWord.mockResolvedValue([]);
    mockFetchWordHistory.mockResolvedValue([]);
    mockGetNav.mockReturnValue({ active: false, ids: [], index: 0 });
    mockGetPronunciation.mockResolvedValue({
      word: 'alacrity',
      audio_url: 'https://audio.example/alacrity-us.mp3',
      source: 'dictionaryapi.dev',
      accent: 'us',
    });
    mockSetAudioModeAsync.mockResolvedValue(undefined);
    mockCreateAsync.mockResolvedValue({
      sound: {
        playAsync: mockPlayAsync,
        unloadAsync: mockUnloadAsync,
        setOnPlaybackStatusUpdate: mockSetOnPlaybackStatusUpdate,
      },
    });
    mockPlayAsync.mockResolvedValue(undefined);
    mockUnloadAsync.mockResolvedValue(undefined);
  });

  it('renders a pronunciation button on word detail', async () => {
    const { getByTestId } = render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());
    expect(getByTestId('pronunciation-button')).toBeTruthy();
  });

  it('fetches dictionary pronunciation and plays the returned audio URL', async () => {
    const { getByTestId } = render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());

    await actRTL(async () => {
      fireEvent.press(getByTestId('pronunciation-button'));
    });

    expect(mockGetPronunciation).toHaveBeenCalledWith('alacrity');
    expect(mockCreateAsync).toHaveBeenCalledWith({ uri: 'https://audio.example/alacrity-us.mp3' });
    expect(mockPlayAsync).toHaveBeenCalled();
  });

  it('shows unavailable message when no dictionary audio exists', async () => {
    mockGetPronunciation.mockRejectedValueOnce(new MockWordServerError('missing', 404));
    const { getByTestId, getByText } = render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());

    await actRTL(async () => {
      fireEvent.press(getByTestId('pronunciation-button'));
    });

    expect(getByText('No pronunciation available')).toBeTruthy();
  });

  it('shows playback error message when audio playback fails', async () => {
    mockCreateAsync.mockRejectedValueOnce(new Error('playback failed'));
    const { getByTestId, getByText } = render(<WordDetailScreen />);
    await waitFor(() => expect(mockFetchWordWithSource).toHaveBeenCalled());

    await actRTL(async () => {
      fireEvent.press(getByTestId('pronunciation-button'));
    });

    expect(getByText('Could not play pronunciation')).toBeTruthy();
  });
});
