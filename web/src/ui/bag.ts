// What the phone's bag lists (Cam's mockup v3, approved 2026-10-14): the battle's own
// BAG, read off the ROM. Three pockets -- ITEMS, POKe BALLS, BERRIES -- and in each only
// what a battle can use (gItems[].battleUsage), with the game's own name, description
// and icon. A USE is the ROM's BAG doing it (src/br/br_bag.c): the page writes the
// pocket into gBagPosition and the item into gBrBag, and presses BAG.
import { TMHM_MOVES } from './tmhm';
import { decodeGen3Display } from '../text/gen3';
import { moveInfo, type Rom } from '../battle/movebook';
import { POCKET_CAPACITY, POCKET_SIZE, SLOT_SIZE } from './phonehud';

const ROM_BASE = 0x08000000;

/** include/constants/item.h's pockets, as gBagPockets and gBagPosition.pocket number
 *  them. The ones a battle has anything in. */
export const POCKET_ITEMS = 0;
export const POCKET_BALLS = 1;
export const POCKET_TMHM = 2;
export const POCKET_BERRIES = 3;
export const BAG_POCKETS: { pocket: number; label: string }[] = [
  { pocket: POCKET_ITEMS, label: 'ITEMS' },
  { pocket: POCKET_BALLS, label: 'POKé BALLS' },
  { pocket: POCKET_BERRIES, label: 'BERRIES' },
];

/** Every pocket, for the field's own BAG. */
export const FIELD_POCKETS: { pocket: number; label: string }[] = [
  { pocket: POCKET_ITEMS, label: 'ITEMS' },
  { pocket: POCKET_BALLS, label: 'POKé BALLS' },
  { pocket: POCKET_TMHM, label: 'TMs & HMs' },
  { pocket: POCKET_BERRIES, label: 'BERRIES' },
  { pocket: 4, label: 'KEY ITEMS' },
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

/** struct Item's type and fieldUseFunc, and ITEM_USE_PARTY_MENU (include/constants/item.h). */
const ITEM_TYPE = 27, ITEM_FIELD_FUNC = 28, ITEM_USE_PARTY_MENU = 1;
/** ITEM_POTION and ITEM_ENIGMA_BERRY: the ends of gItemEffectTable. */
const FIRST_EFFECT = 13, LAST_EFFECT = 175;
const EFFECT_STATUS = 3, EFFECT_MORE = 4;
/** include/constants/item_effects.h. */
const ITEM3_CONFUSION = 0x1, ITEM3_PARALYSIS = 0x2, ITEM3_FREEZE = 0x4, ITEM3_BURN = 0x8, ITEM3_POISON = 0x10, ITEM3_SLEEP = 0x20;
const ITEM3_ANY = ITEM3_CONFUSION | ITEM3_PARALYSIS | ITEM3_FREEZE | ITEM3_BURN | ITEM3_POISON | ITEM3_SLEEP;
const ITEM4_HEAL_HP = 0x4, ITEM4_HEAL_PP = 0x8, ITEM4_HEAL_PP_ONE = 0x10, ITEM4_REVIVE = 0x40;
/** struct Pokemon's status: sleep's turns, then a bit each. */
const STATUS_SLEEP = 0x7, STATUS_POISON = 0x8, STATUS_BURN = 0x10, STATUS_FREEZE = 0x20, STATUS_PARALYSIS = 0x40, STATUS_TOXIC = 0x80;

/** An item's gItemEffectTable row, or null for one without any. */
export function itemEffect(rom: Rom, id: number): Uint8Array | null {
  const table = rom.sym('gItemEffectTable');
  if (table === undefined || id < FIRST_EFFECT || id > LAST_EFFECT) return null;
  const at = u32(rom, table + (id - FIRST_EFFECT) * 4);
  return at >= ROM_BASE ? rom.bytes.subarray(at - ROM_BASE, at - ROM_BASE + 6) : null;
}

/** A medicine the ROM asks "on which POKeMON?" of. */
export function usedOnOne(effect: Uint8Array | null): boolean {
  if (!effect) return false;
  return (effect[EFFECT_STATUS] & ITEM3_ANY) !== 0 || (effect[EFFECT_MORE] & (ITEM4_HEAL_HP | ITEM4_REVIVE | ITEM4_HEAL_PP)) !== 0;
}

/** An ETHER or a LEPPA BERRY: and then, which of their moves. */
export function asksMove(effect: Uint8Array): boolean {
  return (effect[EFFECT_MORE] & ITEM4_HEAL_PP_ONE) !== 0;
}

/** Whether the ROM would take it for this one, as ExecuteTableBasedItemEffect goes. Who is
 *  confused is the battle's to know, so a cure for it counts for the one out. */
export function medicineHelps(effect: Uint8Array, m: { hp: number; maxHp: number; status: number; active: boolean; moves?: { pp: number; maxPp: number }[] }): boolean {
  const more = effect[EFFECT_MORE], cures = effect[EFFECT_STATUS];
  if (m.hp === 0) return (more & ITEM4_REVIVE) !== 0;
  if (more & ITEM4_REVIVE) return false;
  if ((more & ITEM4_HEAL_HP) && m.hp < m.maxHp) return true;
  if ((more & ITEM4_HEAL_PP) && m.moves?.some((v) => v.pp < v.maxPp)) return true;
  const s = m.status;
  return !!((cures & ITEM3_SLEEP && s & STATUS_SLEEP) || (cures & ITEM3_POISON && s & (STATUS_POISON | STATUS_TOXIC))
    || (cures & ITEM3_BURN && s & STATUS_BURN) || (cures & ITEM3_FREEZE && s & STATUS_FREEZE)
    || (cures & ITEM3_PARALYSIS && s & STATUS_PARALYSIS) || (cures & ITEM3_CONFUSION && m.active));
}

/** Used on one of the party, as gItems[].type has it, and a match's medicine that does not ask
 *  (src/br/br_items.c: all of them at once, but a revive and PP). */
export function asksWhoInField(rom: Rom, id: number, effect: Uint8Array | null): boolean {
  const items = rom.sym('gItems');
  if (items === undefined || u8(rom, items + id * ITEM_SIZE + ITEM_TYPE) !== ITEM_USE_PARTY_MENU) return false;
  if (!effect || !usedOnOne(effect)) return true;
  return (effect[EFFECT_MORE] & (ITEM4_REVIVE | ITEM4_HEAL_PP)) !== 0;
}

/** A TM or an HM: ITEM_TM01 to ITEM_HM08 (include/constants/items.h). */
const ITEM_TM01 = 289, ITEM_HM08 = 346;
export function isMachine(id: number): boolean {
  return id >= ITEM_TM01 && id <= ITEM_HM08;
}

/** Whether a machine goes on this mon: anyone (pokemon.c's CanMonLearnTMHM, Cam 2026-10-17)
 *  but one who knows its move already (party_menu.c's ALREADY_KNOWS_MOVE). */
export function takesMachine(m: { moves: readonly { id: number }[] }, id: number): boolean {
  return !m.moves.some((x) => x.id === TMHM_MOVES[id - ITEM_TM01]);
}

/** Whether the field's BAG says "not now" of it: a ball, say. */
export function usableInField(rom: Rom, id: number): boolean {
  const items = rom.sym('gItems'), cannot = rom.sym('ItemUseOutOfBattle_CannotUse');
  if (items === undefined) return true;
  const fn = u32(rom, items + id * ITEM_SIZE + ITEM_FIELD_FUNC);
  return fn !== 0 && (cannot === undefined || ((fn ^ cannot) & ~1) !== 0);
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
    // A machine is named by its move, as a pickup says it ("BRICK BREAK went in the BAG.")
    // and Classic's item.c does: Cam 11-02, "the name of the move, not the TM name".
    const machine = isMachine(id) ? moveInfo(rom, TMHM_MOVES[id - ITEM_TM01])?.name : undefined;
    info = {
      id,
      name: machine || text(rom, at + ITEM_NAME, ITEM_NAME_SIZE),
      desc: descAt >= ROM_BASE ? text(rom, descAt, 120).replace(/\s+/g, ' ').trim() : '',
      battleUsage: u8(rom, at + ITEM_BATTLE_USAGE),
    };
  }
  m.set(id, info);
  return info;
}

/** All of it, for the field's own BAG. */
export function readFieldBag(emu: BagRead, sym: (name: string) => number | undefined): Map<number, Stack[]> {
  return new Map(FIELD_POCKETS.map(({ pocket }) => [pocket, readPocket(emu, sym, pocket)]));
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
