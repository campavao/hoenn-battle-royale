import { describe, expect, it } from 'vitest';
import { ITEM_SIZE, POCKET_BALLS, POCKET_ITEMS, itemInfo, readBattleBag, readPocket } from './bag';
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
