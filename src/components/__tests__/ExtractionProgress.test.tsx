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

    // Find the node with testID="retry-button" in the tree
    function findByTestId(node: any, testId: string): any {
      if (!node) return null;
      if (node.props?.testID === testId) return node;
      for (const child of (Array.isArray(node.children) ? node.children : [])) {
        const found = findByTestId(child, testId);
        if (found) return found;
      }
      return null;
    }

    const retryButton = findByTestId(instance.toJSON(), 'retry-button');
    expect(retryButton).not.toBeNull();
    // toJSON() nodes don't carry onPress; use the fiber tree to fire the press
    const retryFiber = instance.root.findAll(
      (node) => node.props?.testID === 'retry-button',
      { deep: true }
    )[0];
    expect(retryFiber).toBeDefined();
    retryFiber.props.onPress();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
