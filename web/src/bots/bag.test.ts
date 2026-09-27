import { describe, expect, it } from 'vitest';
import {
  BATTLE_ITEMS,
  ITEM,
  battleItems,
  isMedicine,
  merge,
  purse,
  quaff,
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

  it('hands over two units at most: one medicine, then a booster', () => {
    const bag = [{ id: ITEM.X_ATTACK, n: 3 }, { id: ITEM.POTION, n: 3 }];
    const staked = battleItems(bag);
    expect(staked).toHaveLength(BATTLE_ITEMS);
    // One potion, and then the X ATTACK gets to exist -- a bag of six potions must not
    // crowd the boosters out of every fight, and a bot that drinks four in one fight is
    // a wall rather than an opponent.
    expect(staked).toEqual([ITEM.POTION, ITEM.X_ATTACK]);
    // Staking is not spending: a fight that ends on the first turn costs nothing.
    expect(units(bag)).toBe(6);
  });

  it('fills the rest with medicine when there are no boosters', () => {
    expect(battleItems([{ id: ITEM.POTION, n: 9 }])).toEqual([ITEM.POTION, ITEM.POTION]);
  });

  it('never hands over more than the bag holds (POK-322)', () => {
    // The last pour used to pour the first one's POTION again: one in the bag, two in
    // the fight, and the second spent out of nothing.
    expect(battleItems([{ id: ITEM.POTION, n: 1 }])).toEqual([ITEM.POTION]);
    expect(battleItems([{ id: ITEM.POTION, n: 1 }, { id: ITEM.X_ATTACK, n: 1 }])).toEqual([ITEM.POTION, ITEM.X_ATTACK]);
    expect(battleItems([{ id: ITEM.POTION, n: 1 }, { id: ITEM.SUPER_POTION, n: 1 }])).toEqual([
      ITEM.POTION,
      ITEM.SUPER_POTION,
    ]);
    expect(battleItems([])).toEqual([]);
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
