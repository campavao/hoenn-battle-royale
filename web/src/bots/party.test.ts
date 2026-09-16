import { describe, expect, it } from 'vitest';
import { dealParty, LADDER, rungForPhase, speciesAt } from './party';
import { packSlot, unpackSlot, reassembleSlots } from '../net/slots';
import type { PartyMsg } from '../net/wire';

describe('the one clock', () => {
  it('is the ring phase, floored at the first rung and capped at the last', () => {
    expect(rungForPhase(0)).toBe(LADDER[0]);
    expect(rungForPhase(1)).toBe(LADDER[0]);
    expect(rungForPhase(3)).toBe(LADDER[2]);
    expect(rungForPhase(99)).toBe(LADDER[LADDER.length - 1]);
  });
});

describe("a bot's team", () => {
  it('is one mon at the drop and grows to six, never past', () => {
    expect(dealParty(1, 31, 0)).toHaveLength(1);
    expect(dealParty(1, 31, 3)).toHaveLength(2);
    expect(dealParty(1, 31, 64).length).toBeLessThanOrEqual(6);
  });

  it('is levelled at the rung, every mon of it', () => {
    for (const phase of [0, 1, 4, 6]) {
      for (const mon of dealParty(9, 30, phase)) expect(mon.level).toBe(rungForPhase(phase));
    }
  });

  it('is the same team from the same seed and seat, and a different one from another seat', () => {
    expect(dealParty(77, 31, 3)).toEqual(dealParty(77, 31, 3));
    expect(dealParty(77, 30, 3)).not.toEqual(dealParty(77, 31, 3));
  });

  it('survives the wire: what goes out is what the ROM reads back', () => {
    const msg: PartyMsg = { t: 'party', seat: 31, mons: dealParty(5, 31, 5) };
    const slots = packSlot(msg);
    const { type, payload } = reassembleSlots(slots);
    const back = unpackSlot(type, payload) as PartyMsg;
    expect(back.mons).toHaveLength(msg.mons.length);
    expect(back.mons[0].species).toBe(msg.mons[0].species);
    expect(back.mons[0].level).toBe(msg.mons[0].level);
    expect(back.mons[0].nickname).toBe(msg.mons[0].nickname);
  });
});

describe("a bot's mons come from where it is", () => {
  it('knows what walks on a route the game has a table for', () => {
    // Route 101 is the first patch of grass in the game: Wurmple, Poochyena, Zigzagoon.
    const r101 = speciesAt('MAP_ROUTE101');
    expect(r101.length).toBeGreaterThan(0);
    expect(r101).toContain(290); // WURMPLE
    expect(r101).toContain(286); // POOCHYENA
  });

  it('has nothing for a map with no grass on it, and says so plainly', () => {
    expect(speciesAt('MAP_LITTLEROOT_TOWN')).toEqual([]);
    expect(speciesAt('MAP_NOWHERE_AT_ALL')).toEqual([]);
  });

  it('deals a team out of the local table when there is one', () => {
    const local = new Set(speciesAt('MAP_ROUTE101'));
    for (const mon of dealParty(5, 31, 4, 'MAP_ROUTE101')) {
      expect(local.has(mon.species)).toBe(true);
    }
  });

  it('falls back to the pool where there is no table, rather than dealing nothing', () => {
    const party = dealParty(5, 31, 4, 'MAP_LITTLEROOT_TOWN');
    expect(party.length).toBeGreaterThan(0);
    for (const mon of party) expect(mon.species).toBeGreaterThan(0);
  });

  it('still deals the same team from the same seed, map and all', () => {
    expect(dealParty(9, 30, 3, 'MAP_ROUTE110')).toEqual(dealParty(9, 30, 3, 'MAP_ROUTE110'));
    expect(dealParty(9, 30, 3, 'MAP_ROUTE110')).not.toEqual(dealParty(9, 30, 3, 'MAP_ROUTE119'));
  });
});
