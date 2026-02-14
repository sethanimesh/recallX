import { setNav, getNav, navigate, clearNav } from '../libraryNav';

describe('libraryNav store', () => {
  beforeEach(() => {
    clearNav();
  });

  it('starts inactive with empty ids', () => {
    const state = getNav();
    expect(state.active).toBe(false);
    expect(state.ids).toEqual([]);
    expect(state.index).toBe(0);
  });

  it('setNav marks active and stores ids/index', () => {
    setNav(['a', 'b', 'c'], 1);
    const state = getNav();
    expect(state.active).toBe(true);
    expect(state.ids).toEqual(['a', 'b', 'c']);
    expect(state.index).toBe(1);
  });

  it('navigate(1) moves forward and returns new id', () => {
    setNav(['a', 'b', 'c'], 0);
    const id = navigate(1);
    expect(id).toBe('b');
    expect(getNav().index).toBe(1);
  });

  it('navigate(-1) moves backward and returns new id', () => {
    setNav(['a', 'b', 'c'], 2);
    const id = navigate(-1);
    expect(id).toBe('b');
    expect(getNav().index).toBe(1);
  });

  it('navigate(1) returns null at last index and does not change index', () => {
    setNav(['a', 'b'], 1);
    const id = navigate(1);
    expect(id).toBeNull();
    expect(getNav().index).toBe(1);
  });

  it('navigate(-1) returns null at index 0 and does not change index', () => {
    setNav(['a', 'b'], 0);
    const id = navigate(-1);
    expect(id).toBeNull();
    expect(getNav().index).toBe(0);
  });

  it('clearNav resets to inactive empty state', () => {
    setNav(['a', 'b'], 1);
    clearNav();
    const state = getNav();
    expect(state.active).toBe(false);
    expect(state.ids).toEqual([]);
    expect(state.index).toBe(0);
  });

  it('setNav overwrites previous nav state', () => {
    setNav(['a', 'b'], 0);
    setNav(['x', 'y', 'z'], 2);
    const state = getNav();
    expect(state.ids).toEqual(['x', 'y', 'z']);
    expect(state.index).toBe(2);
  });

  it('getNav returns a copy — mutating ids does not affect store', () => {
    setNav(['a', 'b'], 0);
    getNav().ids.push('c');
    expect(getNav().ids).toEqual(['a', 'b']);
  });
});
