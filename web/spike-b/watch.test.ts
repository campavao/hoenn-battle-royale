import { describe, expect, it } from 'vitest';
import { nextAfter, pickedBy } from './watch';

describe('the watcher is told what the trainer watched took (POK-268)', () => {
  it('tells each new key of theirs once, and nothing taken before the watch began', () => {
    const picked = new Map<number, number>([[1, 5], [2, 7]]);
    const seen = new Set(picked.keys());
    expect(pickedBy(picked, seen, 5)).toEqual([]);
    picked.set(3, 5);
    picked.set(4, 7);
    expect(pickedBy(picked, seen, 5)).toEqual([3]);
    expect(pickedBy(picked, seen, 5), 'once').toEqual([]);
  });

  it('a key taken while nobody was watched is never told later', () => {
    const picked = new Map<number, number>();
    const seen = new Set<number>();
    picked.set(9, 5);
    expect(pickedBy(picked, seen, 0)).toEqual([]);
    expect(pickedBy(picked, seen, 5)).toEqual([]);
  });
});

describe('the camera on a trainer who is out goes on to the next one still in', () => {
  it('the next in the strip, round to the first, none when nobody is left', () => {
    expect(nextAfter([2, 4, 9], 5)).toBe(9);
    expect(nextAfter([2, 4, 9], 9)).toBe(2);
    expect(nextAfter([], 3)).toBeNull();
  });
});
