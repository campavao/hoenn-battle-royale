import { describe, expect, it } from 'vitest';
import {
  BATTLE_TYPE_LINK,
  BATTLE_TYPE_SAFARI,
  BATTLE_TYPE_TRAINER,
  ITEM_POKE_DOLL,
  MON_MOVES,
  MON_NICKNAME,
  MON_PP,
  MON_PP_BONUSES,
  MON_SIZE,
  MON_TYPES,
  actionLabels,
  ppWithBonus,
  readBattleView,
  type BattleView,
} from './battlemenu';
import { POCKET_CAPACITY, SLOT_SIZE } from './phonehud';
import { BATTLE_MENU, MAIN_IN_BATTLE_BYTE, MENU_ACTION, MENU_SAFARI } from '../touch';
import { encodeGen3 } from '../text/gen3';

const SYM: Record<string, number> = {
  gMain: 0x1000,
  gBrBattle: 0x2000,
  gBattleMons: 0x3000,
  gBattleTypeFlags: 0x4000,
  gBagPockets: 0x5000,
  gNumSafariBalls: 0x6000,
  gBattlerPositions: 0x6100,
};
const SLOTS = 0x7000;
const POUND = 1;
const WATER = 11;
const GROUND = 4;

function fakeEmu() {
  const ram = new Map<number, number>();
  const put = (addr: number, v: number, bytes: number) => {
    for (let i = 0; i < bytes; i++) ram.set(addr + i, (v >>> (8 * i)) & 0xff);
  };
  const emu = {
    read(addr: number, bits: 8 | 16 | 32) {
      let v = 0;
      for (let i = 0; i < bits / 8; i++) v |= (ram.get(addr + i) ?? 0) << (8 * i);
      return bits === 32 ? v >>> 0 : v;
    },
  };
  return { emu, put };
}

/** A ROM with POUND's 35 PP, as movebook reads it (gBattleMoves at 0x100, 12 a move;
 *  movebook wants the names' table too). */
function fakeRom() {
  const bytes = new Uint8Array(0x400);
  bytes[0x100 + POUND * 12 + 4] = 35;
  const at: Record<string, number> = { gBattleMoves: 0x08000100, gMoveNames: 0x08000300 };
  return { bytes, sym: (n: string) => at[n] };
}

describe("the battle, as the phone's menu reads it", () => {
  it('our moves with their PP and PP Ups, the foe, the menu, and a doll in the ITEMS pocket', () => {
    const { emu, put } = fakeEmu();
    put(SYM.gMain + MAIN_IN_BATTLE_BYTE, 0x02, 1);
    put(SYM.gBrBattle + BATTLE_MENU, MENU_ACTION, 1);
    put(SYM.gBattleTypeFlags, BATTLE_TYPE_TRAINER, 4);
    put(SYM.gBattleMons + MON_MOVES, POUND, 2);
    put(SYM.gBattleMons + MON_PP, 20, 1);
    put(SYM.gBattleMons + MON_PP_BONUSES, 0b10, 1); // two PP Ups on the first move
    const foe = SYM.gBattleMons + MON_SIZE;
    put(foe + MON_TYPES, WATER, 1);
    put(foe + MON_TYPES + 1, GROUND, 1);
    [...encodeGen3('WOOPER'), 0xff].forEach((b, i) => put(foe + MON_NICKNAME + i, b, 1));
    put(SYM.gBagPockets, SLOTS, 4);
    put(SYM.gBagPockets + POCKET_CAPACITY, 3, 1);
    put(SLOTS + 2 * SLOT_SIZE, ITEM_POKE_DOLL, 2);
    const v = readBattleView(emu, (n) => SYM[n], fakeRom())!;
    expect(v).toMatchObject({ menu: MENU_ACTION, trainer: true, dolls: true, foe: { name: 'WOOPER', types: [WATER, GROUND] } });
    expect(v.moves[0]).toEqual({ id: POUND, pp: 20, maxPp: 49 });
    expect(v.moves[1]).toEqual({ id: 0, pp: 0, maxPp: 0 });
    // the doll gone from the bag
    put(SLOTS + 2 * SLOT_SIZE, 0, 2);
    expect(readBattleView(emu, (n) => SYM[n], fakeRom())!.dolls).toBe(false);
    // out of the battle, nothing
    put(SYM.gMain + MAIN_IN_BATTLE_BYTE, 0, 1);
    expect(readBattleView(emu, (n) => SYM[n], fakeRom())).toBeNull();
    expect(readBattleView(emu, () => undefined, null)).toBeNull();
  });

  it('on the challenged side of a link battle we are battler 1, and the foe is 0', () => {
    const { emu, put } = fakeEmu();
    put(SYM.gMain + MAIN_IN_BATTLE_BYTE, 0x02, 1);
    put(SYM.gBattlerPositions, 1, 1); // battler 0: OPPONENT_LEFT
    put(SYM.gBattlerPositions + 1, 0, 1); // battler 1: PLAYER_LEFT
    put(SYM.gBattleMons + MON_MOVES, 33, 2); // theirs
    put(SYM.gBattleMons + MON_TYPES, WATER, 1);
    put(SYM.gBattleMons + MON_TYPES + 1, GROUND, 1);
    put(SYM.gBattleMons + MON_SIZE + MON_MOVES, POUND, 2); // ours
    const v = readBattleView(emu, (n) => SYM[n], null)!;
    expect(v.moves[0].id).toBe(POUND);
    expect(v.foe.types).toEqual([WATER, GROUND]);
  });

  it('a link battle is a fight with somebody; the Safari is not', () => {
    const { emu, put } = fakeEmu();
    put(SYM.gMain + MAIN_IN_BATTLE_BYTE, 0x02, 1);
    put(SYM.gBattleTypeFlags, BATTLE_TYPE_LINK, 4);
    expect(readBattleView(emu, (n) => SYM[n], null)!.trainer).toBe(true);
    put(SYM.gBattleTypeFlags, BATTLE_TYPE_SAFARI | BATTLE_TYPE_TRAINER, 4);
    expect(readBattleView(emu, (n) => SYM[n], null)!.trainer).toBe(false);
  });

  it('PP Ups: a fifth of the base each, rounded down (CalculatePPWithBonus)', () => {
    expect([0, 1, 2, 3].map((n) => ppWithBonus(35, n, 0))).toEqual([35, 42, 49, 56]);
    expect(ppWithBonus(5, 0b11 << 6, 3)).toBe(8);
    expect(ppWithBonus(5, 0b11 << 6, 2)).toBe(5);
  });
});

describe('the action windows', () => {
  const view = (over: Partial<BattleView> = {}): BattleView => ({
    menu: MENU_ACTION,
    trainer: false,
    dolls: false,
    safariBalls: 0,
    moves: [{ id: 1, pp: 1, maxPp: 1 }, { id: 2, pp: 1, maxPp: 1 }, { id: 0, pp: 0, maxPp: 0 }, { id: 0, pp: 0, maxPp: 0 }],
    foe: { name: 'WOOPER', types: [WATER, GROUND] },
    ...over,
  });

  it('a word each; RUN grey only in a fight with somebody and no POKé DOLL', () => {
    expect(actionLabels(view())).toEqual(['FIGHT', 'BAG', 'POKéMON', 'RUN'].map((label) => ({ label, enabled: true })));
    expect(actionLabels(view({ trainer: true, dolls: true }))[3].enabled).toBe(true);
    expect(actionLabels(view({ trainer: true }))[3]).toEqual({ label: 'RUN', enabled: false });
  });

  it("the Safari's four", () => {
    expect(actionLabels(view({ menu: MENU_SAFARI, safariBalls: 12 })).map((l) => l.label)).toEqual(['BALL', 'POKéBLOCK', 'GO NEAR', 'RUN']);
  });
});
