import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import RubricScreen from '../rubric';
import { api } from '@/src/api/centralClient';
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'word' }) }));
jest.mock('@/src/api/centralClient', () => ({ ...jest.requireActual('@/src/api/centralClient'), api: jest.fn() }));
jest.mock('@/src/db/operations/wordDetail', () => ({ fetchWordWithSource: jest.fn().mockResolvedValue({ word: 'Lucid', definition: 'Clear', content_revision: 3 }) }));
jest.mock('@/src/db/operations/central', () => ({ preparePendingRequest: jest.fn(), completePendingRequest: jest.fn().mockResolvedValue(undefined), readCache: jest.fn(async key => key.startsWith('pending_rubric_approval') ? { id: 'saved-approval', body: { revision: 2, content_revision: 1 } } : null) }));
it('retries the saved rubric revision explicitly after a newer definition has arrived', async () => {
  (api as jest.Mock).mockImplementation(async path => path === '/items/word/rubrics' ? [{ revision: 3, content_revision: 3, reference_language: 'en', concepts: [] }] : {});
  const ui = render(<RubricScreen />); await ui.findByText('Retry saved rubric approval');
  await act(async () => { fireEvent.press(ui.getByText('Retry saved rubric approval')); });
  expect(api).toHaveBeenCalledWith('/items/word/rubrics/2/approve', { content_revision: 1, operation_id: 'saved-approval' });
  await ui.findByText('Rubric revision 2 approved for its saved definition.');
});
