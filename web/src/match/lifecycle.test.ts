import { describe, expect, it } from 'vitest';
import { departedSeats } from './lifecycle';

describe('who has walked out of a running match (POK-271)', () => {
  // One human at seat 0 and bots at 31..25, the shape bots/roster.ts deals.
  const bots = new Set([31, 30, 29, 28, 27, 26, 25]);
  const field = [0, ...bots];

  // POK-330 #4: bots are never relay members, so a watcher walking in made the host
  // count every live bot as gone -- and ten seconds later eliminate them all.
  it('a watcher arriving mid-match takes nobody out', () => {
    const members = [0, 7]; // the host, and the watcher who just joined
    expect(departedSeats(field, bots, members, new Set())).toEqual([]);
  });

  it('a person who is no longer listed is gone', () => {
    const people = [0, 1, 2, ...bots];
    expect(departedSeats(people, bots, [0, 2], new Set())).toEqual([1]);
  });

  it('nor is anybody already out', () => {
    expect(departedSeats([0, 1, 2], new Set(), [0], new Set([1]))).toEqual([2]);
  });
});
