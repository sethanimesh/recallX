import React from 'react';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

import ExtractionProgress from '../ExtractionProgress';

describe('ExtractionProgress', () => {
  it("phase='uploading': renders all 3 step labels", async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ExtractionProgress phase="uploading" />);
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Uploading');
    expect(json).toContain('Analyzing');
    expect(json).toContain('Done');
  });

  it("phase='error': renders error message and Retry button", async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ExtractionProgress phase="error" errorMessage="Test error" />
      );
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Test error');
    expect(json).toContain('Retry');
  });

  it("phase='done': renders without crashing", async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ExtractionProgress phase="done" />);
    });
    expect(tree.toJSON()).toBeTruthy();
  });

  it("phase='error' with onRetry mock: pressing Retry calls onRetry", async () => {
    const onRetry = jest.fn();
    let instance!: renderer.ReactTestRenderer;
    await act(async () => {
      instance = renderer.create(
        <ExtractionProgress phase="error" errorMessage="Test error" onRetry={onRetry} />
      );
    });

    const root = instance.root;
    // TouchableOpacity renders as a View in the test environment;
    // find the host node that has an onPress prop
    const nodeWithPress = root.findAll(
      (node) => typeof node.props?.onPress === 'function',
      { deep: true }
    );
    expect(nodeWithPress.length).toBeGreaterThan(0);
    // Press the Retry button
    await act(async () => {
      nodeWithPress[0].props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
