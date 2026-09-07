import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import HistoryScreen from '../history';
import { api } from '@/src/api/centralClient';
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('@/src/api/centralClient', () => ({ api: jest.fn().mockResolvedValue({}) }));
jest.mock('@/src/db/operations/sync', () => ({ syncFromServer: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/src/db/operations/central', () => ({ getSnapshot: jest.fn().mockResolvedValue({ words: [{ id: 'word', word: 'Lucid' }], reviews: [{ id: 'review', item_id: 'word', mode: 'flashcard', status: 'acknowledged', rating: 3, answered_at: '2026-09-01T10:00:00Z' }] }), readCache: jest.fn().mockResolvedValue({ id: 'saved-correction', rating: 1, reason: 'Accidental rating' }), writeCache: jest.fn().mockResolvedValue(undefined) }));
it('shows the frozen correction and retries it only through an explicit saved-correction action', async () => {
  const ui = render(<HistoryScreen />); await ui.findByText('Lucid');
  await act(async () => { fireEvent.press(ui.getByText('Correct this review')); });
  await ui.findByText('Saved correction: Again · Accidental rating');
  expect(ui.getByLabelText('Correction reason').props.editable).toBe(false);
  expect(ui.queryByText('Exclude from scheduling')).toBeNull();
  await act(async () => { fireEvent.press(ui.getByText('Retry saved correction')); });
  expect(api).toHaveBeenCalledWith('/reviews/review/corrections', { id: 'saved-correction', rating: 1, reason: 'Accidental rating' });
});
