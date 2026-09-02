import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@/src/config/settings', () => ({ initSettings: jest.fn().mockResolvedValue(undefined), getToken: () => 'paired', subscribeIdentity: () => () => {} }));
jest.mock('@/src/db/client', () => ({ runMigrations: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/src/db/operations/sync', () => ({ syncFromServer: jest.fn() }));
jest.mock('expo-router', () => {
  const StackScreen = () => null;
  const Stack = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Stack.Screen = StackScreen;
  return { Stack };
});
jest.mock('@react-navigation/native', () => ({
  DarkTheme: {},
  DefaultTheme: {},
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { runMigrations } from '@/src/db/client';
import { syncFromServer } from '@/src/db/operations/sync';
import RootLayout from '../_layout';

function collectText(node: any): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node?.children) return collectText(node.children);
  if (node?.props?.children) return collectText(node.props.children);
  return '';
}

describe('RootLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls runMigrations and syncFromServer on mount', async () => {
    (syncFromServer as jest.Mock).mockResolvedValue(undefined);
    let tree: any;
    await act(async () => {
      tree = renderer.create(<RootLayout />);
    });
    await act(async () => {
      jest.advanceTimersByTime(2800);
    });
    expect(runMigrations).toHaveBeenCalled();
    expect(syncFromServer).toHaveBeenCalled();
  });

  it('proceeds with stale data when sync fails', async () => {
    (syncFromServer as jest.Mock).mockRejectedValue(new Error('network'));
    let tree: any;
    await act(async () => {
      tree = renderer.create(<RootLayout />);
    });
    await act(async () => {
      jest.advanceTimersByTime(2800);
    });
    const allText = collectText(tree.toJSON());
    expect(allText).toMatch(/Could not sync/i);
  });
});
