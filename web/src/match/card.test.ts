import { describe, expect, it } from 'vitest';
import { cardFor } from './card';
import type { RosterEntry } from './roster';

const base: RosterEntry = { seat: 3, name: 'MAY', skin: 'may', alive: true, dir: 1, isMe: false };

describe("a trainer's card (POK-268)", () => {
  it('says who they are and how they look', () => {
    const lines = cardFor(base);
    expect(lines[0]).toEqual({ label: 'TRAINER', value: 'MAY' });
    expect(lines.some((l) => l.value === 'MAY')).toBe(true);
    expect(lines.find((l) => l.label === 'STATUS')?.value).toBe('IN THE MATCH');
  });

  it('names a seat that never said its name', () => {
    expect(cardFor({ ...base, name: '' })[0].value).toBe('P3');
  });

  it('says where they were last seen, but only while they are in it', () => {
    expect(cardFor(base, 'MAP_ROUTE_104').find((l) => l.label === 'LAST SEEN')?.value).toBe('ROUTE 104');
    expect(cardFor({ ...base, alive: false }, 'MAP_ROUTE_104').find((l) => l.label === 'LAST SEEN')).toBeUndefined();
    expect(cardFor({ ...base, alive: false }).find((l) => l.label === 'STATUS')?.value).toBe('OUT');
  });

  it('marks your own', () => {
    expect(cardFor({ ...base, isMe: true }).some((l) => l.value === 'THIS IS YOU')).toBe(true);
  });
});
