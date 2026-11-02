import { describe, expect, it } from 'vitest';
import { ITEM_SIZE, POCKET_BALLS, POCKET_ITEMS, asksMove, itemInfo, medicineHelps, readBattleBag, readPocket, usedOnOne } from './bag';
import { POCKET_CAPACITY, POCKET_SIZE, SLOT_SIZE } from './phonehud';
import { encodeGen3 } from '../text/gen3';

const SYM: Record<string, number> = { gBagPockets: 0x5000, gSaveBlock2Ptr: 0x6000 };
const SAVE2 = 0x6100;
const KEY = 0x1234;

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
  put(SYM.gSaveBlock2Ptr, SAVE2, 4);
  put(SAVE2 + 0xac, KEY, 2);
  return { emu, put };
}

/** gItems at 0x08000000 with two items: 1 POTION (used in a battle), 2 ROPE (not). */
function fakeRom() {
  const bytes = new Uint8Array(0x400);
  const name = (id: number, s: string) => [...encodeGen3(s), 0xff].forEach((b, i) => (bytes[id * ITEM_SIZE + i] = b));
  name(1, 'POTION');
  name(2, 'ROPE');
  bytes[1 * ITEM_SIZE + 32] = 1;
  // POTION's description, two lines, at 0x08000300
  const desc = [...encodeGen3('Heals'), 0xfe, ...encodeGen3('20 HP.'), 0xff];
  desc.forEach((b, i) => (bytes[0x300 + i] = b));
  new DataView(bytes.buffer).setUint32(1 * ITEM_SIZE + 20, 0x08000300, true);
  return { bytes, sym: (n: string) => (n === 'gItems' ? 0x08000000 : undefined) };
}

function stock(put: (a: number, v: number, b: number) => void, pocket: number, slots: number, items: [number, number][]) {
  const p = SYM.gBagPockets + pocket * POCKET_SIZE;
  put(p, slots, 4);
  put(p + POCKET_CAPACITY, items.length + 1, 1);
  items.forEach(([item, n], i) => {
    put(slots + i * SLOT_SIZE, item, 2);
    put(slots + i * SLOT_SIZE + 2, n ^ KEY, 2);
  });
}

describe("the phone's bag", () => {
  it('reads a pocket with its counts unscrambled, empty slots left out', () => {
    const { emu, put } = fakeEmu();
    stock(put, POCKET_BALLS, 0x7000, [[4, 3], [0, 0], [3, 2]]);
    expect(readPocket(emu, (n) => SYM[n], POCKET_BALLS)).toEqual([{ item: 4, n: 3 }, { item: 3, n: 2 }]);
    expect(readPocket(emu, () => undefined, POCKET_BALLS)).toEqual([]);
  });

  it("an item's name, its description on one line, and whether a battle can use it", () => {
    const rom = fakeRom();
    expect(itemInfo(rom, 1)).toEqual({ id: 1, name: 'POTION', desc: 'Heals 20 HP.', battleUsage: 1 });
    expect(itemInfo(rom, 2)?.battleUsage).toBe(0);
    expect(itemInfo(rom, 0)).toBeNull();
  });

  it('lists only what a battle can use', () => {
    const { emu, put } = fakeEmu();
    stock(put, POCKET_ITEMS, 0x7000, [[2, 1], [1, 5]]);
    const bag = readBattleBag(emu, (n) => SYM[n], fakeRom());
    expect(bag.get(POCKET_ITEMS)).toEqual([{ item: 1, n: 5 }]);
    expect(readBattleBag(emu, (n) => SYM[n], null).get(POCKET_ITEMS)).toEqual([]);
  });
});

describe('who a medicine would help', () => {
  const fx = (status: number, more: number) => Uint8Array.from([0, 0, 0, status, more, 0]);
  const POTION = fx(0, 0x4), REVIVE = fx(0, 0x44), ANTIDOTE = fx(0x10, 0), FULL_RESTORE = fx(0x3f, 0x4), ETHER = fx(0, 0x18), ELIXIR = fx(0, 0x8), X_ATTACK = fx(0, 0);
  const mon = (hp: number, status = 0, active = false) => ({ hp, maxHp: 20, status, active });

  it('asks on the party for what is simply given to one', () => {
    for (const e of [POTION, REVIVE, ANTIDOTE, FULL_RESTORE, ETHER, ELIXIR]) expect(usedOnOne(e)).toBe(true);
    for (const e of [X_ATTACK, null]) expect(usedOnOne(e)).toBe(false);
  });
  it('a revive is for the fainted, and nothing else is', () => {
    expect(medicineHelps(REVIVE, mon(0))).toBe(true);
    expect(medicineHelps(REVIVE, mon(5))).toBe(false);
    expect(medicineHelps(POTION, mon(0))).toBe(false);
    expect(medicineHelps(FULL_RESTORE, mon(0, 0x10))).toBe(false);
  });
  it('a potion is for the hurt', () => {
    expect(medicineHelps(POTION, mon(5))).toBe(true);
    expect(medicineHelps(POTION, mon(20))).toBe(false);
  });
  it('a cure is for what it cures, sleep and bad poison included', () => {
    expect(medicineHelps(ANTIDOTE, mon(20, 0x8))).toBe(true);
    expect(medicineHelps(ANTIDOTE, mon(20, 0x80))).toBe(true);
    expect(medicineHelps(ANTIDOTE, mon(20, 0x10))).toBe(false);
    expect(medicineHelps(FULL_RESTORE, mon(20, 0x3))).toBe(true);
    expect(medicineHelps(FULL_RESTORE, mon(20))).toBe(false);
  });
  it('PP is for who has spent some, and an ETHER goes on to ask which move', () => {
    const spent = { ...mon(20), moves: [{ pp: 3, maxPp: 10 }] }, full = { ...mon(20), moves: [{ pp: 10, maxPp: 10 }] };
    expect(medicineHelps(ETHER, spent)).toBe(true);
    expect(medicineHelps(ELIXIR, full)).toBe(false);
    expect(asksMove(ETHER)).toBe(true);
    expect(asksMove(ELIXIR)).toBe(false);
  });
  it('confusion is only known of the one out', () => {
    const PERSIM = fx(0x1, 0);
    expect(medicineHelps(PERSIM, mon(20, 0, true))).toBe(true);
    expect(medicineHelps(PERSIM, mon(20))).toBe(false);
  });
});
