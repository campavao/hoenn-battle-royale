import { describe, expect, it } from 'vitest';
import { dealBots, gradeOf, Grade, MAX_SEATS, type BotSpawn } from './roster';
import { dealParty } from './party';

const spawns: BotSpawn[] = [{ mapId: 'MAP_ROUTE101', map: { group: 0, num: 16 }, x: 5, y: 5 }];

describe('bot grades (POK-265)', () => {
  it('are dealt from the seed and the seat, not rolled', () => {
    for (let seat = 0; seat < MAX_SEATS; seat++) {
      expect(gradeOf(1234, seat)).toBe(gradeOf(1234, seat));
    }
    // A different match deals a different field, or every match is the same match.
    const a = Array.from({ length: MAX_SEATS }, (_, s) => gradeOf(1234, s)).join('');
    const b = Array.from({ length: MAX_SEATS }, (_, s) => gradeOf(9876, s)).join('');
    expect(a).not.toBe(b);
  });

  it('are not all the same, and aces are the rare ones', () => {
    const tally = { [Grade.Rookie]: 0, [Grade.Regular]: 0, [Grade.Ace]: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      for (let seat = 16; seat < MAX_SEATS; seat++) tally[gradeOf(seed, seat)]++;
    }
    expect(tally[Grade.Rookie]).toBeGreaterThan(0);
    expect(tally[Grade.Regular]).toBeGreaterThan(0);
    expect(tally[Grade.Ace]).toBeGreaterThan(0);
    expect(tally[Grade.Ace]).toBeLessThan(tally[Grade.Rookie]);
  });

  it('ride on the bots the deal makes', () => {
    const dealt = dealBots(4242, 4, [0], spawns);
    expect(dealt).toHaveLength(4);
    for (const bot of dealt) expect(bot.grade).toBe(gradeOf(4242, bot.seat));
  });

  it('are worth a Pokemon either way', () => {
    // Phase 5 is three mons for a regular: one at the drop and one every two rungs.
    const rookie = dealParty(7, 31, 5, undefined, Grade.Rookie);
    const regular = dealParty(7, 31, 5, undefined, Grade.Regular);
    const ace = dealParty(7, 31, 5, undefined, Grade.Ace);
    expect(rookie.length).toBe(regular.length - 1);
    expect(ace.length).toBe(regular.length + 1);
    // Never nothing, however bad the grade and however early the phase.
    expect(dealParty(7, 31, 0, undefined, Grade.Rookie).length).toBeGreaterThan(0);
    // And never more than a party.
    expect(dealParty(7, 31, 99, undefined, Grade.Ace).length).toBeLessThanOrEqual(6);
  });

  it('leaves the default deal alone, so everything that does not ask keeps its team', () => {
    expect(dealParty(7, 31, 5)).toEqual(dealParty(7, 31, 5, undefined, Grade.Regular));
  });
});
