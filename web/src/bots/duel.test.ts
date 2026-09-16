import { describe, expect, it } from 'vitest';
import { duel, weight } from './duel';
import type { PackedMon } from '../net/wire';

function mon(level: number, hp = 20, maxHp = 20): PackedMon {
  return {
    species: 277, level, hp, maxHp, status: 0,
    moves: [{ id: 1, pp: 35, ppUps: 0 }],
    heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'T', ot: 'BR',
  };
}

describe('what a team is worth', () => {
  it('counts level and the health it still has, and ignores the fainted', () => {
    expect(weight([mon(50)])).toBeGreaterThan(weight([mon(10)]));
    expect(weight([mon(50, 2)])).toBeLessThan(weight([mon(50, 20)]));
    expect(weight([mon(50, 0)])).toBe(0);
  });
});

describe('two bots fighting', () => {
  it('gives the same answer whichever way round it is asked', () => {
    const a = { seat: 31, party: [mon(20)] };
    const b = { seat: 28, party: [mon(35)] };
    expect(duel(7, a, b, 1)).toEqual(duel(7, b, a, 1));
  });

  it('replays from the same seed, and the same pair meeting twice is two fights', () => {
    const a = { seat: 31, party: [mon(20)] };
    const b = { seat: 28, party: [mon(20)] };
    expect(duel(7, a, b, 1)).toEqual(duel(7, a, b, 1));
    // Evenly matched: over a run of meetings both of them win some.
    const winners = new Set(Array.from({ length: 40 }, (_, i) => duel(7, a, b, i).winner));
    expect(winners.size).toBe(2);
  });

  it('usually goes to the stronger team, over a run of them', () => {
    const strong = { seat: 31, party: [mon(60), mon(60)] };
    const weak = { seat: 28, party: [mon(5, 3)] };
    let wins = 0;
    for (let i = 0; i < 200; i++) if (duel(99, strong, weak, i).winner === 31) wins++;
    expect(wins).toBeGreaterThan(150);
  });

  it('leaves the winner hurt but never dead', () => {
    const a = { seat: 31, party: [mon(30), mon(30)] };
    const b = { seat: 28, party: [mon(30)] };
    const r = duel(5, a, b, 1);
    const before = r.winner === 31 ? a.party : b.party;
    expect(weight(r.winnerParty)).toBeLessThan(weight(before));
    for (const m of r.winnerParty) expect(m.hp).toBeGreaterThan(0);
  });
});
