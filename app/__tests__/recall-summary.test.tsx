import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));

let mockParams: Record<string, string> = { score: '7', total: '10', tagId: 'tag1' };

import RecallSummaryScreen from '../recall-summary';

function collectText(node: any): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node?.props?.children) return collectText(node.props.children);
  return '';
}

describe('RecallSummaryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { score: '7', total: '10', tagId: 'tag1' };
  });

  it('renders score fraction correctly', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(<RecallSummaryScreen />);
    });
    const fractionNode = tree.root.findAll((n: any) => n.props?.testID === 'score-fraction')[0];
    expect(collectText(fractionNode)).toContain('7');
    expect(collectText(fractionNode)).toContain('10');
  });

  it('Done button navigates to practice tab', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(<RecallSummaryScreen />);
    });
    const doneBtn = tree.root.findAll((n: any) => n.props?.testID === 'done-button')[0];
    await act(async () => { doneBtn.props.onPress(); });
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('practice'));
  });

  it('Restart button navigates back to recall with same tagId', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(<RecallSummaryScreen />);
    });
    const restartBtn = tree.root.findAll((n: any) => n.props?.testID === 'restart-button')[0];
    await act(async () => { restartBtn.props.onPress(); });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recall',
      params: { tagId: 'tag1' },
    });
  });

  it('renders without crashing when total is 0', async () => {
    mockParams = { score: '0', total: '0', tagId: '' };
    await act(async () => {
      renderer.create(<RecallSummaryScreen />);
    });
  });
});
