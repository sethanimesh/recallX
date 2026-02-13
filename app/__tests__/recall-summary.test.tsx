import React from 'react';
import renderer, { act } from 'react-test-renderer';

let mockParams: Record<string, string> = {
  score: '7', total: '10', tagId: 'tag1', mode: 'adaptive', missedIds: '',
};

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));

const mockFetchAllWords = jest.fn();
jest.mock('@/src/db/operations/tags', () => ({
  fetchAllWords: jest.fn(() => mockFetchAllWords()),
}));

import RecallSummaryScreen from '../recall-summary';

function collectText(node: any): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node?.props?.children) return collectText(node.props.children);
  if (node?.children) return collectText(node.children);
  return '';
}

describe('RecallSummaryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAllWords.mockResolvedValue([]);
    mockParams = { score: '7', total: '10', tagId: 'tag1', mode: 'adaptive', missedIds: '' };
  });

  it('renders score fraction correctly', async () => {
    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    const fractionNode = tree.root.findAll((n: any) => n.props?.testID === 'score-fraction')[0];
    expect(collectText(fractionNode)).toContain('7');
    expect(collectText(fractionNode)).toContain('10');
  });

  it('Done button navigates to practice tab', async () => {
    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    const doneBtn = tree.root.findAll((n: any) => n.props?.testID === 'done-button')[0];
    await act(async () => { doneBtn.props.onPress(); });
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('practice'));
  });

  it('Restart button navigates back to recall with tagId and mode', async () => {
    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    const restartBtn = tree.root.findAll((n: any) => n.props?.testID === 'restart-button')[0];
    await act(async () => { restartBtn.props.onPress(); });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recall',
      params: { tagId: 'tag1', mode: 'adaptive' },
    });
  });

  it('renders without crashing when total is 0', async () => {
    mockParams = { score: '0', total: '0', tagId: '', mode: 'adaptive', missedIds: '' };
    await act(async () => { renderer.create(<RecallSummaryScreen />); });
  });

  it('does not render missed section when missedIds is empty', async () => {
    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    await act(async () => { await Promise.resolve(); });
    const missed = tree.root.findAll((n: any) => n.props?.testID === 'missed-heading');
    expect(missed).toHaveLength(0);
  });

  it('renders missed words section with word and definition', async () => {
    mockParams = { score: '3', total: '5', tagId: 'tag1', mode: 'adaptive', missedIds: 'w1,w2' };
    mockFetchAllWords.mockResolvedValue([
      {
        id: 'w1', word: 'ephemeral', definition: 'Lasting for a very short time',
        example_sentence: 'ex', source_id: null, created_at: new Date(),
        updated_at: new Date(), deleted_at: null,
      },
      {
        id: 'w2', word: 'tenacious', definition: 'Holding fast; persistent',
        example_sentence: 'ex', source_id: null, created_at: new Date(),
        updated_at: new Date(), deleted_at: null,
      },
    ]);

    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const headings = tree.root.findAll((n: any) => n.props?.testID === 'missed-heading' && n.type === 'Text');
    expect(headings.length).toBeGreaterThan(0);
    expect(collectText(headings[0])).toContain('Missed Words');

    const rows = tree.root.findAll((n: any) => n.props?.testID?.startsWith('missed-row-') && n.type === 'View');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const allText = rows.map(collectText).join('');
    expect(allText).toContain('ephemeral');
    expect(allText).toContain('tenacious');
  });

  it('only shows words whose IDs are in missedIds (filters correctly)', async () => {
    mockParams = { score: '4', total: '5', tagId: '', mode: 'adaptive', missedIds: 'w2' };
    mockFetchAllWords.mockResolvedValue([
      {
        id: 'w1', word: 'ephemeral', definition: 'Short-lived',
        example_sentence: 'ex', source_id: null, created_at: new Date(),
        updated_at: new Date(), deleted_at: null,
      },
      {
        id: 'w2', word: 'tenacious', definition: 'Holding fast',
        example_sentence: 'ex', source_id: null, created_at: new Date(),
        updated_at: new Date(), deleted_at: null,
      },
    ]);

    let tree: any;
    await act(async () => { tree = renderer.create(<RecallSummaryScreen />); });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const rows = tree.root.findAll((n: any) => n.props?.testID?.startsWith('missed-row-') && n.type === 'View');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const w2Row = rows.find((r: any) => r.props.testID === 'missed-row-w2');
    expect(w2Row).toBeDefined();
    const rowsText = rows.map(collectText).join('');
    expect(rowsText).toContain('tenacious');
    expect(rowsText).not.toContain('ephemeral');
  });
});
