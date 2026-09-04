import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CentralReviewScreen } from '@/src/screens/CentralReviewScreen';
import { enqueueReview, flushPendingReviews } from '@/src/db/operations/central';
import { fetchAllWords } from '@/src/db/operations/tags';
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }), useLocalSearchParams: () => ({ fcMode: 'self-rated' }) }));
jest.mock('@/src/db/operations/tags', () => ({ fetchAllWords: jest.fn().mockResolvedValue([{ id: 'word', word: 'Transient', definition: 'Brief', example_sentence: '', content_revision: 2, created_at: new Date() }]), fetchWordsByTag: jest.fn() }));
jest.mock('@/src/db/operations/central', () => ({ reviewContext: () => ({ content_revision: 2, progress_generation: 3, settings_revision: 4 }), enqueueReview: jest.fn(), flushPendingReviews: jest.fn(), getSnapshot: jest.fn().mockResolvedValue({ memory_states: [] }), operationResult: jest.fn(), readCache: jest.fn().mockResolvedValue(null), writeCache: jest.fn().mockResolvedValue(undefined), allOperations: jest.fn().mockResolvedValue([]) }));
jest.mock('@/src/db/operations/sync', () => ({ syncFromServer: jest.fn().mockRejectedValue(new Error('offline')) }));
jest.mock('@/src/api/gradeClient', () => ({ gradeAnswer: jest.fn() }));
jest.mock('@/src/api/tutorClient', () => ({ tutorChat: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); (enqueueReview as jest.Mock).mockResolvedValue({ id: 'queued-id' }); (flushPendingReviews as jest.Mock).mockRejectedValue(new Error('offline')); });
it('queues an offline rating durably before Next and never invents a due date', async () => {
 const ui = render(<CentralReviewScreen kind="flashcard" />); await ui.findByText('Transient'); fireEvent.press(ui.getByText('Reveal answer')); await ui.findByText('Brief'); fireEvent.press(ui.getByText('Good — remembered'));
 await ui.findByText('Saved on this device · pending server confirmation. Due date unchanged.');
 expect(enqueueReview).toHaveBeenCalledWith(expect.objectContaining({ rating: 3, revealed: true, offline: true, draftKey: 'draft:flashcard:word:2', context: { content_revision: 2, progress_generation: 3, settings_revision: 4 } }));
 expect(flushPendingReviews).not.toHaveBeenCalled();
 fireEvent.press(ui.getByText('Retry save')); await ui.findByText('offline'); expect(enqueueReview).toHaveBeenCalledTimes(1);
 expect(ui.getByText('Finish')).toBeTruthy();
});
it('does not confirm or advance a rating when local persistence fails', async () => {
 (enqueueReview as jest.Mock).mockRejectedValue(new Error('Storage full'));
 const ui = render(<CentralReviewScreen kind="flashcard" />); await ui.findByText('Transient'); fireEvent.press(ui.getByText('Reveal answer')); await ui.findByText('Brief'); fireEvent.press(ui.getByText('Again — missed it'));
 await ui.findByText('Storage full'); expect(ui.queryByText('Finish')).toBeNull(); expect(flushPendingReviews).not.toHaveBeenCalled();
});
it('starts a fresh draft when the same learning card re-enters a refreshed session', async () => {
 (fetchAllWords as jest.Mock).mockImplementation(async () => [{ id: 'word', word: 'Transient', definition: 'Brief', example_sentence: '', content_revision: 2, created_at: new Date() }]);
 const ui = render(<CentralReviewScreen kind="flashcard" />); await ui.findByText('Transient');
 fireEvent.press(ui.getByText('Reveal answer')); await ui.findByText('Brief'); fireEvent.press(ui.getByText('Good — remembered'));
 await ui.findByText('Finish'); fireEvent.press(ui.getByText('Finish')); await ui.findByText('Session complete. Pending reviews will sync when connected.');
 fireEvent.press(ui.getByText('Refresh due cards'));
 await ui.findByText('Reveal answer'); expect(ui.queryByText('Finish')).toBeNull();
 fireEvent.press(ui.getByText('Reveal answer')); await ui.findByText('Brief'); fireEvent.press(ui.getByText('Again — missed it'));
 await ui.findByText('Finish'); expect(enqueueReview).toHaveBeenCalledTimes(2);
});
