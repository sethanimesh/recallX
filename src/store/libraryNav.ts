declare const __DEV__: boolean;

export interface LibraryNavState {
  ids: string[];
  index: number;
  active: boolean;
}

let _state: LibraryNavState = { ids: [], index: 0, active: false };

export function setNav(ids: string[], index: number): void {
  if (__DEV__ && (index < 0 || index >= ids.length)) {
    console.warn(`[libraryNav] index ${index} out of bounds for ids.length ${ids.length}`);
  }
  _state = { ids, index, active: true };
}

export function getNav(): LibraryNavState {
  return { ..._state, ids: [..._state.ids] };
}

export function navigate(delta: 1 | -1): string | null {
  const newIndex = _state.index + delta;
  if (newIndex < 0 || newIndex >= _state.ids.length) return null;
  _state = { ..._state, index: newIndex };
  return _state.ids[newIndex];
}

export function clearNav(): void {
  _state = { ids: [], index: 0, active: false };
}
