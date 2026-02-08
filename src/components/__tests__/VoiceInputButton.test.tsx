import React from 'react';
import { create, act } from 'react-test-renderer';

// Setup mocks BEFORE importing the component
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: {
      View: RN.View,
    },
    useSharedValue: jest.fn((val) => ({ value: val })),
    useAnimatedStyle: jest.fn((fn) => ({})),
    withRepeat: jest.fn((animation) => animation),
    withTiming: jest.fn((target, options) => ({ target, options })),
    cancelAnimation: jest.fn(),
  };
});

import { VoiceInputButton } from '../VoiceInputButton';

function render(state: any, onPress = jest.fn()) {
  let tree: any;
  act(() => {
    tree = create(<VoiceInputButton state={state} onPress={onPress} />);
  });
  return tree!;
}

describe('VoiceInputButton', () => {
  it('renders mic button in idle state and is pressable', () => {
    const onPress = jest.fn();
    const tree = render('idle', onPress);
    const btn = tree.root.findByProps({ testID: 'voice-input-button' });
    expect(btn).toBeTruthy();
    expect(btn.props.disabled).toBe(false);
  });

  it('is disabled and shows spinner in connecting state', () => {
    const tree = render('connecting');
    expect(() => tree.root.findByProps({ testID: 'voice-input-button' })).toThrow();
    const { ActivityIndicator } = require('react-native');
    expect(tree.root.findByType(ActivityIndicator)).toBeTruthy();
  });

  it('is disabled and shows spinner in transcribing state', () => {
    const tree = render('transcribing');
    expect(() => tree.root.findByProps({ testID: 'voice-input-button' })).toThrow();
    const { ActivityIndicator } = require('react-native');
    expect(tree.root.findByType(ActivityIndicator)).toBeTruthy();
  });

  it('shows active mic in listening state', () => {
    const tree = render('listening');
    const btn = tree.root.findByProps({ testID: 'voice-input-button' });
    expect(btn.props.disabled).toBe(false);
  });

  it('shows active mic in speech_detected state', () => {
    const tree = render('speech_detected');
    const btn = tree.root.findByProps({ testID: 'voice-input-button' });
    expect(btn.props.disabled).toBe(false);
  });

  it('shows error appearance in error state and is pressable', () => {
    const onPress = jest.fn();
    const tree = render('error', onPress);
    const btn = tree.root.findByProps({ testID: 'voice-input-button' });
    expect(btn.props.disabled).toBe(false);
  });

  it('disables button in done state', () => {
    const onPress = jest.fn();
    const tree = render('done', onPress);
    const btn = tree.root.findByProps({ testID: 'voice-input-button' });
    expect(btn).toBeTruthy();
    expect(btn.props.disabled).toBe(true);
  });
});
