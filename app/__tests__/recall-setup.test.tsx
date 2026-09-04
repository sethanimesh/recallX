import React from 'react';
import { AppState } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import RecallSetupScreen from '../recall-setup';
import { getSnapshot, allOperations } from '@/src/db/operations/central';
import { fetchAllWords, fetchWordsByTag } from '@/src/db/operations/tags';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (callback: () => void) => { require('react').useEffect(callback, [callback]); } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
jest.mock('@/src/db/operations/tags', () => ({ getAllTags: jest.fn().mockResolvedValue([{ id: 'tag', name: 'My deck' }]), fetchAllWords: jest.fn(), fetchWordsByTag: jest.fn() }));
jest.mock('@/src/db/operations/central', () => ({ getSnapshot: jest.fn(), allOperations: jest.fn() }));
const row = (id: string) => ({ id, word: id, definition: 'Meaning', created_at: new Date() });
const snapshot = (states: unknown[] = []) => ({ memory_states: states });
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); AppState.currentState = 'active';
  (fetchAllWords as jest.Mock).mockResolvedValue([]); (fetchWordsByTag as jest.Mock).mockResolvedValue([]);
  (getSnapshot as jest.Mock).mockResolvedValue(snapshot()); (allOperations as jest.Mock).mockResolvedValue([]);
});
afterEach(() => jest.useRealTimers());
it('shows the completed schedule and disables Start with no due cards', async () => {
  const ui = render(<RecallSetupScreen />);
  await ui.findByText('All caught up! No words due now.');
  expect(ui.getByTestId('start-button').props.accessibilityState.disabled).toBe(true);
  expect(ui.queryByText('Adaptive')).toBeNull(); expect(ui.queryByText('Classic')).toBeNull(); expect(ui.queryByText('Passive')).toBeNull();
});
it('counts only due cards and excludes ratings awaiting server confirmation', async () => {
  (fetchAllWords as jest.Mock).mockResolvedValue(['due', 'future', 'pending'].map(row));
  (getSnapshot as jest.Mock).mockResolvedValue(snapshot([{ item_id: 'future', mode: 'recall', due: '2099-01-01T00:00:00Z' }]));
  (allOperations as jest.Mock).mockResolvedValue([{ status: 'pending', payload: JSON.stringify({ item_id: 'pending', mode: 'recall' }) }]);
  const ui = render(<RecallSetupScreen />); await ui.findByText('1 word due now');
  fireEvent.press(ui.getByText('Start')); expect(mockPush).toHaveBeenCalledWith({ pathname: '/recall', params: { tagId: '', sortOrder: 'jumbled' } });
});
it('starts self-rated flashcards using their independent confirmed due state', async () => {
  (fetchAllWords as jest.Mock).mockResolvedValue([row('word')]);
  (getSnapshot as jest.Mock).mockResolvedValue(snapshot([{ item_id: 'word', mode: 'recall', due: '2099-01-01T00:00:00Z' }]));
  const ui = render(<RecallSetupScreen />); await ui.findByText('0 words due now');
  fireEvent.press(ui.getByText('Self-rated flashcards')); await ui.findByText('1 word due now'); fireEvent.press(ui.getByText('Start'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/flashcard', params: { tagId: '', sortOrder: 'jumbled', fcMode: 'self-rated' } });
});
it('offers every item for tutor practice even when its scheduled review is later', async () => {
  (fetchAllWords as jest.Mock).mockResolvedValue([row('word')]);
  (getSnapshot as jest.Mock).mockResolvedValue(snapshot([{ item_id: 'word', mode: 'recall', due: '2099-01-01T00:00:00Z' }]));
  const ui = render(<RecallSetupScreen />); await ui.findByText('0 words due now');
  fireEvent.press(ui.getByText('Tutor practice')); await ui.findByText('1 word available for practice'); fireEvent.press(ui.getByText('Start'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/tutor', params: { tagId: '', sortOrder: 'jumbled' } });
});
it('uses the selected deck and ordering for the next session', async () => {
  (fetchWordsByTag as jest.Mock).mockResolvedValue([row('tagged')]);
  const ui = render(<RecallSetupScreen />); await ui.findByText('My deck');
  fireEvent.press(ui.getByText('My deck')); await ui.findByText('1 word due now'); fireEvent.press(ui.getByText('Alphabetical')); fireEvent.press(ui.getByText('Start'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/recall', params: { tagId: 'tag', sortOrder: 'alphabetical' } });
});
it('refreshes the confirmed count while the setup screen remains in the foreground', async () => {
  (fetchAllWords as jest.Mock).mockResolvedValue([row('word')]);
  const ui = render(<RecallSetupScreen />); await ui.findByText('1 word due now');
  (getSnapshot as jest.Mock).mockResolvedValue(snapshot([{ item_id: 'word', mode: 'recall', due: '2099-01-01T00:00:00Z' }]));
  await act(async () => { jest.advanceTimersByTime(30000); });
  await ui.findByText('0 words due now'); ui.unmount();
});
it('limits the today shortcut to items eligible in the selected mode', async () => {
  (fetchAllWords as jest.Mock).mockResolvedValue([row('word')]);
  const ui = render(<RecallSetupScreen />); await ui.findByText("Today's Words (1)"); fireEvent.press(ui.getByText("Today's Words (1)"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/recall', params: { tagId: '', sortOrder: 'jumbled', todayOnly: 'true' } });
});
it('keeps reviews unavailable until a confirmed library snapshot exists', async () => {
  (getSnapshot as jest.Mock).mockResolvedValue(null); (fetchAllWords as jest.Mock).mockResolvedValue([row('legacy')]);
  const ui = render(<RecallSetupScreen />); await ui.findByText('Pair and sync this device before reviewing.');
  expect(ui.getByTestId('start-button').props.accessibilityState.disabled).toBe(true);
});
