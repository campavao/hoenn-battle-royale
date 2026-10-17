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

  it("has another trainer's record when they said it (POK-339), and BEST once they finished one", () => {
    expect(cardFor({ ...base, record: { wins: 3, matches: 12, best: 2 } })).toEqual([
      { label: 'TRAINER', value: 'MAY' },
      { label: 'WINS', value: '3' },
      { label: 'PLAYED', value: '12' },
      { label: 'BEST', value: '2nd' },
    ]);
    expect(cardFor({ ...base, record: { wins: 0, matches: 0 } }).map((l) => l.label)).toEqual(['TRAINER', 'WINS', 'PLAYED']);
    // Your own card is still just yours (Cam's 2026-10-14 play-test).
    expect(cardFor({ ...base, isMe: true, record: { wins: 3, matches: 12 } }).map((l) => l.value)).toEqual(['MAY', 'THIS IS YOU']);
  });

  it('marks your own', () => {
    expect(cardFor({ ...base, isMe: true }).some((l) => l.value === 'THIS IS YOU')).toBe(true);
  });
});
