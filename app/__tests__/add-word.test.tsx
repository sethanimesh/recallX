import React from 'react';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';
import { Alert } from 'react-native';

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
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: mockReplace, back: mockBack },
}));

const mockInsertManualWord = jest.fn();
jest.mock('@/src/db/operations/insertManualWord', () => ({
  insertManualWord: (...args: unknown[]) => mockInsertManualWord(...args),
}));

const mockAddTagToWord = jest.fn();
jest.mock('@/src/db/operations/tags', () => ({
  addTagToWord: (...args: unknown[]) => mockAddTagToWord(...args),
}));

jest.mock('@/src/components/TagPickerSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockTagPickerSheet() {
    return <View />;
  };
});

const mockLookupWord = jest.fn();
jest.mock('@/src/api/http', () => ({
  lookupWord: (...args: unknown[]) => mockLookupWord(...args),
}));

import AddWordScreen from '../add-word';

function findByTestId(tree: renderer.ReactTestRendererJSON | null, testID: string): renderer.ReactTestRendererJSON | null {
  if (!tree) return null;
  if (Array.isArray(tree)) {
    for (const node of tree as renderer.ReactTestRendererJSON[]) {
      const found = findByTestId(node, testID);
      if (found) return found;
    }
    return null;
  }
  if ((tree as renderer.ReactTestRendererJSON).props?.testID === testID) return tree as renderer.ReactTestRendererJSON;
  if (!(tree as renderer.ReactTestRendererJSON).children) return null;
  for (const child of (tree as renderer.ReactTestRendererJSON).children!) {
    if (typeof child === 'string') continue;
    const found = findByTestId(child as renderer.ReactTestRendererJSON, testID);
    if (found) return found;
  }
  return null;
}

describe('AddWordScreen autofill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('autofill button fills word, definition, and example sentence on success', async () => {
    mockLookupWord.mockResolvedValueOnce({
      word: 'pellucid',
      definition: 'Translucently clear.',
      example_sentence: 'A pellucid stream.',
    });

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<AddWordScreen />);
    });

    const wordInput = findByTestId(tree!.toJSON() as renderer.ReactTestRendererJSON, 'word-input');
    await act(async () => {
      wordInput!.props.onChangeText('pellucid');
    });

    const autofillBtn = findByTestId(tree!.toJSON() as renderer.ReactTestRendererJSON, 'autofill-button');
    await act(async () => {
      autofillBtn!.props.onClick();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockLookupWord).toHaveBeenCalledWith('pellucid');

    const json = tree!.toJSON() as renderer.ReactTestRendererJSON;
    const defInput = findByTestId(json, 'definition-input');
    expect(defInput!.props.value).toBe('Translucently clear.');
    const exInput = findByTestId(json, 'example-input');
    expect(exInput!.props.value).toBe('A pellucid stream.');
  });

  it('shows Alert on autofill failure', async () => {
    mockLookupWord.mockRejectedValueOnce(new Error('Network error'));
    const alertSpy = jest.spyOn(Alert, 'alert');

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<AddWordScreen />);
    });

    const wordInput = findByTestId(tree!.toJSON() as renderer.ReactTestRendererJSON, 'word-input');
    await act(async () => {
      wordInput!.props.onChangeText('test');
    });

    const autofillBtn = findByTestId(tree!.toJSON() as renderer.ReactTestRendererJSON, 'autofill-button');
    await act(async () => {
      autofillBtn!.props.onClick();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Network error');
  });
});
