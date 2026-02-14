interface LibraryNavState {
  ids: string[];
  index: number;
  active: boolean;
}

let _state: LibraryNavState = { ids: [], index: 0, active: false };

export function setNav(ids: string[], index: number): void {
  _state = { ids, index, active: true };
}

export function getNav(): LibraryNavState {
  return { ..._state };
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
