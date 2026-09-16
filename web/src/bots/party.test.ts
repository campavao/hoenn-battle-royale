import { describe, expect, it } from 'vitest';
import { dealParty, LADDER, rungForPhase } from './party';
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
