import { describe, expect, it } from 'vitest';
import {
  BATTLE_ITEMS,
  ITEM,
  battleItems,
  dealBag,
  isMedicine,
  merge,
  potionFor,
  purse,
  quaff,
  restock,
  spend,
  take,
  units,
} from './bag';
import { Grade } from './roster';
import type { PackedMon } from '../net/wire';

function mon(hp: number, maxHp: number): PackedMon {
  return {
    species: 277, level: 5, hp, maxHp, status: 0,
    moves: [{ id: 1, pp: 35, ppUps: 0 }],
    heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'TREECKO', ot: 'BR',
  };
}

describe("a bot's own bag", () => {
  it('deals the same bag twice for the same seed and seat', () => {
    expect(dealBag(99, 3, 2, Grade.Ace)).toEqual(dealBag(99, 3, 2, Grade.Ace));
  });

  it('gives an ace more to spend than a rookie', () => {
    const ace = units(dealBag(4, 1, 0, Grade.Ace));
    const rookie = units(dealBag(4, 1, 0, Grade.Rookie));
    expect(ace).toBeGreaterThan(rookie);
  });

  it('carries the medicine of the rung it is on', () => {
    expect(potionFor(5)).toBe(ITEM.POTION);
    expect(potionFor(30)).toBe(ITEM.SUPER_POTION);
    expect(potionFor(50)).toBe(ITEM.HYPER_POTION);
    expect(potionFor(100)).toBe(ITEM.FULL_RESTORE);
    // Phase 0 is level 5, so a bot at the drop is carrying POTIONs.
    expect(dealBag(1, 0, 0, Grade.Regular).some((s) => s.id === ITEM.POTION)).toBe(true);
  });

  it('restocks one potion a ring, rather than dealing a fresh bag', () => {
    const bag = dealBag(1, 0, 0, Grade.Rookie);
    const before = units(bag);
    take(bag, bag[0].id);
    restock(bag, 0);
    // One out, one in: a bag that has been spent stays spent.
    expect(units(bag)).toBe(before);
  });

  it('drinks the weakest thing that helps, onto the worst-hurt mon', () => {
    const party = [mon(19, 19), mon(4, 20)];
    const bag = [{ id: ITEM.POTION, n: 1 }, { id: ITEM.HYPER_POTION, n: 1 }];
    expect(quaff(party, bag)).toBe(ITEM.POTION);
    expect(party[1].hp).toBe(20); // 4 + 20, capped at its own maximum
    expect(party[0].hp).toBe(19);
    expect(bag).toEqual([{ id: ITEM.HYPER_POTION, n: 1 }]);
  });

  it('leaves a scratch alone and a fainted mon alone', () => {
    const bag = [{ id: ITEM.POTION, n: 1 }];
    expect(quaff([mon(18, 20)], bag)).toBeNull();
    expect(quaff([mon(0, 20)], bag)).toBeNull();
    expect(units(bag)).toBe(1);
  });

  it('drinks nothing when there is nothing to drink', () => {
    expect(quaff([mon(1, 20)], [{ id: ITEM.X_ATTACK, n: 2 }])).toBeNull();
    expect(isMedicine(ITEM.X_ATTACK)).toBe(false);
  });

  it('hands over four units at most, medicine first', () => {
    const bag = [{ id: ITEM.X_ATTACK, n: 3 }, { id: ITEM.POTION, n: 3 }];
    const staked = battleItems(bag);
    expect(staked).toHaveLength(BATTLE_ITEMS);
    expect(staked.slice(0, 3)).toEqual([ITEM.POTION, ITEM.POTION, ITEM.POTION]);
    expect(staked[3]).toBe(ITEM.X_ATTACK);
    // Staking is not spending: a fight that ends on the first turn costs nothing.
    expect(units(bag)).toBe(6);
  });

  it('spends only what the fight says it used', () => {
    const bag = [{ id: ITEM.POTION, n: 2 }, { id: ITEM.X_ATTACK, n: 1 }];
    spend(bag, [ITEM.POTION, ITEM.X_ATTACK]);
    expect(bag).toEqual([{ id: ITEM.POTION, n: 1 }]);
  });

  it('folds a bag found on the ground into its own', () => {
    const bag = [{ id: ITEM.POTION, n: 1 }];
    merge(bag, [{ id: ITEM.POTION, n: 2 }, { id: ITEM.DIRE_HIT, n: 1 }]);
    expect(bag).toEqual([{ id: ITEM.POTION, n: 3 }, { id: ITEM.DIRE_HIT, n: 1 }]);
  });

  it('is worth more the later it falls', () => {
    expect(purse(3, Grade.Ace)).toBeGreaterThan(purse(0, Grade.Ace));
    expect(purse(3, Grade.Ace)).toBeGreaterThan(purse(3, Grade.Rookie));
  });
});
