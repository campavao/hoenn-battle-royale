import { describe, expect, it } from 'vitest';
import { noteInMatch, noteOutOfMatch, reloadedMidMatch, type TabStore } from './left';

function memory(): TabStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe('reloadedMidMatch (POK-433)', () => {
  it('a reload during a match is one, once', () => {
    const store = memory();
    noteInMatch('XDGUWY', store);
    expect(reloadedMidMatch(store)).toBe(true);
    expect(reloadedMidMatch(store)).toBe(false);
  });
  it('a match that ended, or was left, is not', () => {
    const store = memory();
    noteInMatch('XDGUWY', store);
    noteOutOfMatch(store);
    expect(reloadedMidMatch(store)).toBe(false);
  });
  it('a first load is not, and no store at all is never', () => {
    expect(reloadedMidMatch(memory())).toBe(false);
    noteInMatch('XDGUWY', null);
    expect(reloadedMidMatch(null)).toBe(false);
  });
  it('a store that throws is a plain load', () => {
    const angry: TabStore = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => noteInMatch('A', angry)).not.toThrow();
    expect(reloadedMidMatch(angry)).toBe(false);
  });
});
