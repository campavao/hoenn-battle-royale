import { describe, expect, it } from 'vitest';
import { admits, TRUST } from './trust';
import type { Msg } from './wire';

// Seat 1 hosts; 2, 7 and 9 are people; 30 and 31 are bots, which no relay roster lists.
const ctx = { host: 1, members: new Set([1, 2, 7, 9]) };
const out = (seat: number): Msg => ({ t: 'out', seat });

describe('the trust table (POK-330 #24)', () => {
  it('lets nobody hand another page a message meant for its own ROM', () => {
    for (const t of ['duel', 'give', 'follow'] as const) expect(TRUST[t]).toBe('never');
    expect(admits({ t: 'give', items: [{ id: 1, n: 1 }] }, 1, ctx)).toBe(false);
    expect(admits({ t: 'follow', seat: 1 }, 1, ctx)).toBe(false);
  });

  it("takes the room's word from its host and nobody else", () => {
    const words: Msg[] = [
      { t: 'again', seat: 7 },
      { t: 'win', seat: 7 },
      { t: 'win' },
      { t: 'ring', seat: 7, phase: 1, sx: 0, sy: 0, r: 3 },
      { t: 'clock', seat: 7, left: 10 },
      { t: 'land', seat: 7, map: { group: 0, num: 1 }, x: 1, y: 1 },
      { t: 'start', seed: 1, spawns: [{ seat: 7, map: { group: 0, num: 1 }, x: 1, y: 1 }] },
      { t: 'ticker', seat: 7, text: 'HI' },
    ];
    for (const msg of words) {
      expect(admits(msg, 7, ctx), msg.t).toBe(false);
      expect(admits(msg, 1, ctx), msg.t).toBe(true);
    }
    // With no room there is no host to hear from.
    expect(admits({ t: 'again', seat: 1 }, 1, { ...ctx, host: null })).toBe(false);
  });

  it('lets a seat speak for itself, and the host for anybody', () => {
    expect(admits(out(7), 7, ctx)).toBe(true);
    expect(admits(out(7), 9, ctx)).toBe(false);
    expect(admits(out(30), 1, ctx)).toBe(true); // a bot, walked by the host
    expect(admits(out(7), 1, ctx)).toBe(true); // a seat that left, announced by the host
    expect(admits({ t: 'challenge', seat: 7, opponent: 2, nonce: 1 }, 9, ctx)).toBe(false);
    expect(admits({ t: 'bt', seat: 7, seq: 1, data: [] }, 9, ctx)).toBe(false);
  });

  it('takes a fight stream from either fighter, or the host, and nobody watching it', () => {
    const battle = 2 | (7 << 8);
    expect(admits({ t: 'turn', battle, data: [0] }, 7, ctx)).toBe(true);
    expect(admits({ t: 'bstart', battle, data: [0] }, 2, ctx)).toBe(true);
    expect(admits({ t: 'turn', battle, data: [0] }, 9, ctx)).toBe(false);
    expect(admits({ t: 'bstart', battle: 30 | (31 << 8), data: [0] }, 1, ctx)).toBe(true); // a proxy duel
  });

  it("takes a report on a bot's fight from whoever fought it, and on a person's from nobody else", () => {
    expect(admits({ t: 'party', seat: 30, mons: [] }, 7, ctx)).toBe(true);
    expect(admits({ t: 'spent', seat: 31, items: [] }, 9, ctx)).toBe(true);
    expect(admits({ t: 'result', seat: 30, outcome: 'lose' }, 7, ctx)).toBe(true);
    expect(admits({ t: 'result', seat: 9, outcome: 'lose' }, 7, ctx)).toBe(false);
    expect(admits({ t: 'party', seat: 9, mons: [] }, 9, ctx)).toBe(true);
  });
});
