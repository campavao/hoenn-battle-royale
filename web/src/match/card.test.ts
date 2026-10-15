import { describe, expect, it } from 'vitest';
import { cardFor } from './card';
import type { RosterEntry } from './roster';

const base: RosterEntry = { seat: 3, name: 'MAY', skin: 'may', alive: true, dir: 1, isMe: false };

describe("a trainer's card (POK-268)", () => {
  it('says who they are, and nothing the room cannot vouch for (POK-343)', () => {
    expect(cardFor(base)).toEqual([{ label: 'TRAINER', value: 'MAY' }]);
    expect(cardFor({ ...base, alive: false, map: { group: 0, num: 16 } })).toEqual([{ label: 'TRAINER', value: 'MAY' }]);
  });

  it('names a seat that never said its name', () => {
    expect(cardFor({ ...base, name: '' })[0].value).toBe('P3');
  });

  it('marks your own', () => {
    expect(cardFor({ ...base, isMe: true }).some((l) => l.value === 'THIS IS YOU')).toBe(true);
  });
});
