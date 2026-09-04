import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { CentralReviewScreen } from '@/src/screens/CentralReviewScreen';
import { gradeAnswer } from '@/src/api/gradeClient';
import { tutorChat } from '@/src/api/tutorClient';
import { enqueueReview, flushPendingReviews, getSnapshot, writeCache, readCache, allOperations, operationResult } from '@/src/db/operations/central';
import { syncFromServer } from '@/src/db/operations/sync';
const mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }), useLocalSearchParams: () => mockParams }));
jest.mock('@/src/db/operations/tags', () => ({ fetchAllWords: jest.fn().mockResolvedValue([{ id: 'word', word: 'Transient', definition: 'Brief', example_sentence: '', content_revision: 2, created_at: new Date() }]), fetchWordsByTag: jest.fn() }));
jest.mock('@/src/db/operations/central', () => ({ reviewContext: () => ({ content_revision: 2, progress_generation: 3, settings_revision: 4 }), enqueueReview: jest.fn(), flushPendingReviews: jest.fn(), getSnapshot: jest.fn(), operationResult: jest.fn(), readCache: jest.fn(), writeCache: jest.fn(), allOperations: jest.fn() }));
jest.mock('@/src/db/operations/sync', () => ({ syncFromServer: jest.fn() }));
jest.mock('@/src/api/gradeClient', () => ({ gradeAnswer: jest.fn() }));
jest.mock('@/src/api/tutorClient', () => ({ tutorChat: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'attempt-uuid' }));
const assessment = { assessment_id: 'assessment', decision: 'correct', feedback: 'Meaning supported.', experimental: false };
beforeEach(() => {
 jest.clearAllMocks(); Object.keys(mockParams).forEach(key => delete mockParams[key]);
 (syncFromServer as jest.Mock).mockResolvedValue(undefined);
 (getSnapshot as jest.Mock).mockResolvedValue({ memory_states: [], reviews: [], settings: { progress_generation: 0 } });
 (allOperations as jest.Mock).mockResolvedValue([]); (readCache as jest.Mock).mockResolvedValue(null); (writeCache as jest.Mock).mockResolvedValue(undefined);
 (enqueueReview as jest.Mock).mockResolvedValue({ id: 'event-uuid' }); (flushPendingReviews as jest.Mock).mockResolvedValue(undefined); (operationResult as jest.Mock).mockResolvedValue({ status: 'acknowledged' });
 (gradeAnswer as jest.Mock).mockResolvedValue(assessment); (tutorChat as jest.Mock).mockResolvedValue({ assessment });
});
it('saves accepted recall immediately and Next cannot submit it again', async () => {
 const ui = render(<CentralReviewScreen kind="recall" />); await ui.findByText('Transient');
 fireEvent.changeText(ui.getByLabelText('Your explanation'), 'temporary'); fireEvent.press(ui.getByText('Assess answer'));
 await ui.findByText('Saved to your shared history and schedule.');
 expect(gradeAnswer).toHaveBeenCalledWith(expect.objectContaining({ item_id: 'word', content_revision: 2, attempt_id: 'attempt-uuid' }));
 expect(enqueueReview).toHaveBeenCalledWith(expect.objectContaining({ assessment_id: 'assessment', draftKey: 'draft:recall:word:2', draft: expect.objectContaining({ result: assessment }) }));
 fireEvent.press(ui.getByText('Finish')); await ui.findByText('Session complete. Pending reviews will sync when connected.'); expect(enqueueReview).toHaveBeenCalledTimes(1);
 expect(ui.getByText('Refresh due cards')).toBeTruthy();
});
it('keeps uncertainty outside scheduling and a Hindi clarification becomes assisted practice', async () => {
 (gradeAnswer as jest.Mock).mockResolvedValueOnce({ ...assessment, decision: 'uncertain', feedback: 'Please clarify.' }).mockResolvedValueOnce(assessment);
 const ui = render(<CentralReviewScreen kind="recall" />); await ui.findByText('Transient'); fireEvent.press(ui.getByText('Hindi'));
 await waitFor(() => expect(writeCache).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ language: 'hi' })));
 fireEvent.changeText(ui.getByLabelText('Your explanation'), 'अस्थायी'); fireEvent.press(ui.getByText('Assess answer')); await ui.findByText('Please clarify.');
 expect(enqueueReview).not.toHaveBeenCalled(); fireEvent.press(ui.getByText('Clarify or try another answer'));
 await ui.findByText('Assisted practice after feedback — your schedule will not change.');
 fireEvent.changeText(ui.getByLabelText('Your explanation'), 'कुछ समय तक'); fireEvent.press(ui.getByText('Assess answer')); await ui.findByText('Meaning supported.');
 expect(gradeAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'hi', assisted: true })); expect(enqueueReview).not.toHaveBeenCalled();
});
it('never schedules tutor practice', async () => {
 const ui = render(<CentralReviewScreen kind="tutor" />); await ui.findByText('Transient'); fireEvent.changeText(ui.getByLabelText('Your explanation'), 'temporary'); fireEvent.press(ui.getByText('Assess answer')); await ui.findByText('Meaning supported.');
 expect(tutorChat).toHaveBeenCalledWith(expect.objectContaining({ assisted: true })); expect(enqueueReview).not.toHaveBeenCalled();
});
it('restores a draft after an interrupted assessment instead of inventing a grade', async () => {
 (readCache as jest.Mock).mockResolvedValue({ answer: 'saved answer', attemptId: 'original-attempt', result: null, operationId: null, language: 'hi-Latn', assisted: false, revealed: false });
 const ui = render(<CentralReviewScreen kind="recall" />); await ui.findByDisplayValue('saved answer'); fireEvent.press(ui.getByText('Assess answer')); await ui.findByText('Meaning supported.');
 expect(gradeAnswer).toHaveBeenCalledWith(expect.objectContaining({ attempt_id: 'original-attempt', language: 'hi-Latn' }));
});
