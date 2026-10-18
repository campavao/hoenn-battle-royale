// What the phone's bag lists (Cam's mockup v3, approved 2026-10-14): the battle's own
// BAG, read off the ROM. Three pockets -- ITEMS, POKe BALLS, BERRIES -- and in each only
// what a battle can use (gItems[].battleUsage), with the game's own name, description
// and icon. A USE is the ROM's BAG doing it (src/br/br_bag.c): the page writes the
// pocket into gBagPosition and the item into gBrBag, and presses BAG.
import { decodeGen3Display } from '../text/gen3';
import type { Rom } from '../battle/movebook';
import { POCKET_CAPACITY, POCKET_SIZE, SLOT_SIZE } from './phonehud';

const ROM_BASE = 0x08000000;

/** include/constants/item.h's pockets, as gBagPockets and gBagPosition.pocket number
 *  them. The ones a battle has anything in. */
export const POCKET_ITEMS = 0;
export const POCKET_BALLS = 1;
export const POCKET_BERRIES = 3;
export const BAG_POCKETS: { pocket: number; label: string }[] = [
  { pocket: POCKET_ITEMS, label: 'ITEMS' },
  { pocket: POCKET_BALLS, label: 'POKé BALLS' },
  { pocket: POCKET_BERRIES, label: 'BERRIES' },
];

/** `struct Item` (include/item.h): the name, the description pointer, and how a battle
 *  uses it. 44 bytes under both compilers. */
export const ITEM_SIZE = 44;
const ITEM_NAME = 0;
const ITEM_NAME_SIZE = 14;
const ITEM_DESC = 20;
const ITEM_BATTLE_USAGE = 32;
/** SaveBlock2's encryptionKey: a bag count is stored XORed with its low half. */
const SAVE2_ENCRYPTION_KEY = 0xac;
/** gBagPosition.pocket (include/item_menu.h: the exit callback, then location). */
export const BAG_POSITION_POCKET = 5;

export interface ItemInfo {
  id: number;
  name: string;
  desc: string;
  /** gItems[].battleUsage: 0 is no use in a battle. */
  battleUsage: number;
}

export interface Stack {
  item: number;
  n: number;
}

export interface BagRead {
  read(addr: number, bits: 8 | 16 | 32): number;
}

function u8(rom: Rom, addr: number): number {
  return rom.bytes[addr - ROM_BASE] ?? 0;
}

function u32(rom: Rom, addr: number): number {
  const o = addr - ROM_BASE;
  const b = rom.bytes;
  return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
}

function text(rom: Rom, addr: number, max: number): string {
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const c = u8(rom, addr + i);
    if (c === 0xff) break;
    // A description breaks its lines where the bag's box does; ours wraps its own.
    out.push(c === 0xfe ? 0x00 : c);
  }
  try {
    return decodeGen3Display(Uint8Array.from(out));
  } catch {
    return '';
  }
}

const infos = new WeakMap<Uint8Array, Map<number, ItemInfo | null>>();

/** An item as gItems has it, read once a ROM. Null without the table. */
export function itemInfo(rom: Rom, id: number): ItemInfo | null {
  let m = infos.get(rom.bytes);
  if (!m) infos.set(rom.bytes, (m = new Map()));
  if (m.has(id)) return m.get(id) ?? null;
  const items = rom.sym('gItems');
  let info: ItemInfo | null = null;
  if (items !== undefined && id > 0) {
    const at = items + id * ITEM_SIZE;
    const descAt = u32(rom, at + ITEM_DESC);
    info = {
      id,
      name: text(rom, at + ITEM_NAME, ITEM_NAME_SIZE),
      desc: descAt >= ROM_BASE ? text(rom, descAt, 120).replace(/\s+/g, ' ').trim() : '',
      battleUsage: u8(rom, at + ITEM_BATTLE_USAGE),
    };
  }
  m.set(id, info);
  return info;
}

/** A pocket's stacks, in the bag's order, with their counts. Empty without the symbols. */
export function readPocket(emu: BagRead, sym: (name: string) => number | undefined, pocket: number): Stack[] {
  const pockets = sym('gBagPockets');
  const save2 = sym('gSaveBlock2Ptr');
  if (pockets === undefined || save2 === undefined) return [];
  const key = emu.read(emu.read(save2, 32) + SAVE2_ENCRYPTION_KEY, 16);
  const p = pockets + pocket * POCKET_SIZE;
  const slots = emu.read(p, 32);
  const cap = emu.read(p + POCKET_CAPACITY, 8);
  const out: Stack[] = [];
  for (let i = 0; i < cap; i++) {
    const item = emu.read(slots + i * SLOT_SIZE, 16);
    const n = (emu.read(slots + i * SLOT_SIZE + 2, 16) ^ key) & 0xffff;
    if (item !== 0 && n > 0) out.push({ item, n });
  }
  return out;
}

/** What each of the bag's battle pockets holds that a battle can use. */
export function readBattleBag(emu: BagRead, sym: (name: string) => number | undefined, rom: Rom | null): Map<number, Stack[]> {
  const bag = new Map<number, Stack[]>();
  for (const { pocket } of BAG_POCKETS) {
    bag.set(
      pocket,
      rom ? readPocket(emu, sym, pocket).filter((s) => (itemInfo(rom, s.item)?.battleUsage ?? 0) !== 0) : [],
    );
  }
  return bag;
}
