import React from 'react';
import { AppState } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import RetentionScreen from '../retention';
import { getSnapshot } from '@/src/db/operations/central';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn(), back: jest.fn() }), useFocusEffect: (callback: () => void) => { require('react').useEffect(callback, [callback]); } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
jest.mock('@/src/db/operations/central', () => ({ getSnapshot: jest.fn() }));
const snapshot = (due: string) => ({ words: [{ id: 'word', word: 'Lucid', definition: 'Clear' }, { id: 'deleted', word: 'Removed', definition: 'Hidden', deleted_at: '2026-01-01' }], memory_states: [{ item_id: 'word', mode: 'recall', due }, { item_id: 'word', mode: 'flashcard', due: '2000-01-01T00:00:00Z' }] });
beforeEach(() => { jest.useFakeTimers(); AppState.currentState = 'active'; });
afterEach(() => jest.useRealTimers());
it('refreshes the confirmed schedule while the dashboard stays open', async () => {
  (getSnapshot as jest.Mock).mockResolvedValue(snapshot('2099-01-01T00:00:00Z'));
  const ui = render(<RetentionScreen />); await ui.findByText("You're all caught up!");
  (getSnapshot as jest.Mock).mockResolvedValue(snapshot('2000-01-01T00:00:00Z'));
  await act(async () => { jest.advanceTimersByTime(30000); });
  await ui.findByText('Lucid'); expect(ui.queryByText('Removed')).toBeNull(); ui.unmount();
});
it('uses the independent flashcard schedule when switching modes', async () => {
  (getSnapshot as jest.Mock).mockResolvedValue(snapshot('2099-01-01T00:00:00Z'));
  const ui = render(<RetentionScreen />); await ui.findByText("You're all caught up!");
  fireEvent.press(ui.getByText('Flashcard')); await ui.findByText('Lucid');
});
it('does not describe missing confirmed data as a completed schedule', async () => {
  (getSnapshot as jest.Mock).mockResolvedValue(null);
  const ui = render(<RetentionScreen />); await ui.findByText('Pair and sync this device to view your confirmed schedule.');
  expect(ui.queryByText("You're all caught up!")).toBeNull();
});
