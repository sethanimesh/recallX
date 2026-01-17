import React from 'react';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }: any) => <View {...props}>{children}</View>,
  };
});

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: mockReplace },
}));

const mockTakePendingExtraction = jest.fn();
jest.mock('@/src/store/pendingWords', () => ({
  takePendingExtraction: () => mockTakePendingExtraction(),
}));

const mockInsertExtraction = jest.fn();
jest.mock('@/src/db/operations/insertExtraction', () => ({
  insertExtraction: (...args: unknown[]) => mockInsertExtraction(...args),
}));

const mockAddTagToWord = jest.fn();
jest.mock('@/src/db/operations/tags', () => ({
  addTagToWord: (...args: unknown[]) => mockAddTagToWord(...args),
}));

let mockNextTagIndex = 0;
const mockTagSelections = [
  [{ id: 'tag-gre', name: 'GRE' }],
  [{ id: 'tag-sat', name: 'SAT' }],
];

jest.mock('@/src/components/TagPickerSheet', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');

  return function MockTagPickerSheet(props: any) {
    if (!props.visible) return null;
    return (
      <View testID="mock-tag-picker">
        <Text>{props.currentTags.map((tag: any) => tag.name).join(',')}</Text>
        <TouchableOpacity
          testID="mock-tag-picker-apply"
          onPress={() => {
            const selection =
              mockTagSelections[mockNextTagIndex] ?? mockTagSelections[mockTagSelections.length - 1];
            mockNextTagIndex += 1;
            props.onTagsChanged(selection);
            props.onClose();
          }}
        >
          <Text>Apply tags</Text>
        </TouchableOpacity>
      </View>
    );
  };
});

import ReviewScreen from '../review';

function collectText(node: renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] | null): string[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(collectText);
  const children = node.children ?? [];

  return [
    ...children.filter((child): child is string => typeof child === 'string'),
    ...children.flatMap((child) =>
      typeof child === 'string' ? [] : collectText(child)
    ),
  ];
}

describe('ReviewScreen tagging flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockNextTagIndex = 0;
    mockTakePendingExtraction.mockReturnValue({
      words: [
        { word: 'insidious', definition: 'Secretly harmful.', example_sentence: 'An insidious threat.' },
        { word: 'pellucid', definition: 'Clear.', example_sentence: 'A pellucid argument.' },
      ],
      sourceUri: 'file://scan.png',
      sourceType: 'image',
    });
    mockInsertExtraction.mockResolvedValue(['word-1', 'word-2']);
    mockAddTagToWord.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('keeps per-card tags visible and applies them to the matching saved words', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ReviewScreen />);
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'review-tag-trigger' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'mock-tag-picker-apply' }).props.onPress();
    });

    expect(collectText(tree.toJSON())).toContain('GRE');

    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Accept word' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'review-tag-trigger' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'mock-tag-picker-apply' }).props.onPress();
    });

    expect(collectText(tree.toJSON())).toContain('SAT');

    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Accept word' }).props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockInsertExtraction).toHaveBeenCalledTimes(1);
    expect(mockAddTagToWord).toHaveBeenNthCalledWith(1, 'word-1', 'tag-gre');
    expect(mockAddTagToWord).toHaveBeenNthCalledWith(2, 'word-2', 'tag-sat');
  });
});
