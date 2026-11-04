import { describe, expect, it } from 'vitest';
import { BATTLE_STRUCT_PARTY_ORDERS, battleOrder, leadIndex } from './battleorder';

const SYM: Record<string, number> = {
  gBattleTypeFlags: 0x100,
  gBattleStruct: 0x200,
  gBattlePartyCurrentOrder: 0x300,
  gBattlerPositions: 0x400,
  gBattlerPartyIndexes: 0x500,
};
const STRUCT = 0x1000;
const sym = (n: string) => SYM[n];

function emu(bytes: Record<number, number>) {
  return { read: (addr: number, _bits: 8 | 16 | 32) => bytes[addr] ?? 0 };
}

/** Packed the ROM's way: slot 0 in the high nibble. */
const packed = (at: number, order: number[]) => ({
  [at]: (order[0] << 4) | order[1],
  [at + 1]: (order[2] << 4) | order[3],
  [at + 2]: (order[4] << 4) | order[5],
});

describe('battleOrder', () => {
  it("reads the local battler's own order, not what the last switch left in the current one", () => {
    const e = emu({
      [SYM.gBattleTypeFlags]: 1 << 2,
      [SYM.gBattleStruct]: STRUCT,
      // I stand at PLAYER_LEFT (0), the foe at OPPONENT_LEFT (1).
      [SYM.gBattlerPositions]: 0,
      [SYM.gBattlerPositions + 1]: 1,
      ...packed(STRUCT + BATTLE_STRUCT_PARTY_ORDERS, [3, 1, 2, 0, 4, 5]),
      // The foe's last switch.
      ...packed(STRUCT + BATTLE_STRUCT_PARTY_ORDERS + 3, [1, 0, 2, 3, 4, 5]),
      ...packed(SYM.gBattlePartyCurrentOrder, [1, 0, 2, 3, 4, 5]),
    });
    expect(battleOrder(e, sym)).toEqual([3, 1, 2, 0, 4, 5]);
  });

  it('on a link battle\'s slave, whose engine never runs, the current order is the true one', () => {
    const e = emu({
      [SYM.gBattleTypeFlags]: 1 << 1,
      [SYM.gBattleStruct]: STRUCT,
      [SYM.gBattlerPositions]: 1,
      [SYM.gBattlerPositions + 1]: 0,
      ...packed(STRUCT + BATTLE_STRUCT_PARTY_ORDERS + 3, [0, 1, 2, 3, 4, 5]),
      ...packed(SYM.gBattlePartyCurrentOrder, [2, 1, 0, 3, 4, 5]),
    });
    expect(battleOrder(e, sym)).toEqual([2, 1, 0, 3, 4, 5]);
  });

  it('a link battle\'s master reads the battler the positions make it', () => {
    const e = emu({
      [SYM.gBattleTypeFlags]: (1 << 1) | (1 << 2),
      [SYM.gBattleStruct]: STRUCT,
      [SYM.gBattlerPositions]: 0,
      [SYM.gBattlerPositions + 1]: 1,
      ...packed(STRUCT + BATTLE_STRUCT_PARTY_ORDERS, [1, 0, 2, 3, 4, 5]),
    });
    expect(battleOrder(e, sym)).toEqual([1, 0, 2, 3, 4, 5]);
  });

  it('off a battle, gBattleStruct is gone: in order', () => {
    expect(battleOrder(emu({ [SYM.gBattleTypeFlags]: 1 << 2 }), sym)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('leadIndex', () => {
  it("is the local battler's, on the challenged side of a link battle too", () => {
    const e = emu({
      [SYM.gBattlerPositions]: 1,
      [SYM.gBattlerPositions + 1]: 0,
      [SYM.gBattlerPartyIndexes]: 4,
      [SYM.gBattlerPartyIndexes + 2]: 2,
    });
    expect(leadIndex(e, sym)).toBe(2);
  });
});
