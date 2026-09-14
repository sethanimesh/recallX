import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SourcesScreen from '../sources';
import { getItemSources } from '@/src/api/ingestionClient';
const mockDownload = jest.fn();
jest.mock('expo-file-system', () => ({ Directory: { pickDirectoryAsync: async () => ({ uri: 'file:///chosen' }) }, File: class { constructor(..._args: any[]) {} static downloadFileAsync(...args: any[]): Promise<any> { return mockDownload(...args); } } }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'item' }) }));
jest.mock('@/src/api/ingestionClient', () => ({ getItemSources: jest.fn() }));
jest.mock('@/src/config/settings', () => ({ getBackendUrl: () => 'http://localhost:8000', getCommonHeaders: () => ({ Authorization: 'Bearer test-device-token' }) }));
beforeEach(() => { jest.clearAllMocks(); mockDownload.mockResolvedValue({}); });
it('shows retained citations and authenticates saving the original source', async () => {
  (getItemSources as jest.Mock).mockResolvedValue({ item_id: 'item', sources: [{ source_id: 'source', filename: 'chapter.pdf', mime_type: 'application/pdf', sha256: 'fingerprint', size_bytes: 123, extraction_mode: 'general_document', source_path: '/ingestion/sources/source', citations: [{ page_number: 2, block_id: 'block', excerpt: 'A cited definition.' }], pages: [] }] });
  const ui = render(<SourcesScreen />); await ui.findByText('chapter.pdf');
  expect(ui.getByText('A cited definition.')).toBeTruthy();
  fireEvent.press(ui.getByText('Save original source'));
  await ui.findByText('Original source saved to the folder you selected.');
  expect(mockDownload).toHaveBeenCalledWith('http://localhost:8000/ingestion/sources/source', expect.anything(), { headers: { Authorization: 'Bearer test-device-token' } });
});
it('shows failed provenance requests rather than claiming the item has no sources', async () => {
  (getItemSources as jest.Mock).mockRejectedValue(new Error('Device is not paired'));
  const ui = render(<SourcesScreen />); await ui.findByText('Device is not paired');
  expect(ui.queryByText(/This item has no retained/)).toBeNull();
});
