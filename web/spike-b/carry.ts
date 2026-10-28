// What a battle in spike B keeps (rom.ts): the ROM goes back to its parked state after
// every battle, and these are the trainer's own bytes carried across it.

// include/global.h's SaveBlock1: money, coins, the registered item, the PC's items and
// every bag pocket, one run from 0x490 to 0x848. Money, coins and the pockets' counts are
// kept XORed with SaveBlock2's key (0xAC), and every battle's start draws a new one
// (MoveSaveBlocks_ResetHeap), so they are carried from the battle's key to the parked one.
export const BAG_AT = 0x490;
export const BAG_LEN = 0x848 - 0x490;
export const KEY_AT = 0xac;
const POCKETS_AT = 0x560 - BAG_AT;
export const PARTY_LEN = 6 * 100;
// The Pokédex, plain bytes: SaveBlock2's from the Unown and Spinda personalities through
// owned and seen (0x1C..0x90), and SaveBlock1's two copies of seen. Without it every
// catch of a species is its first, and its page comes up again
// (Cmd_trysetcaughtmondexflags).
export const DEX2_AT = 0x1c;
export const DEX2_LEN = 0x90 - 0x1c;
export const SEEN1_AT = 0x988;
export const SEEN2_AT = 0x3b24;
export const SEEN_LEN = 52;

/** The bag run (BAG_LEN bytes from BAG_AT), kept under `from`, as it reads under `to`. */
export function rekey(bag: Uint8Array, from: number, to: number): Uint8Array {
  const out = bag.slice();
  const v = new DataView(out.buffer);
  const x = (from ^ to) >>> 0;
  v.setUint32(0, v.getUint32(0, true) ^ x, true); // money
  v.setUint16(4, v.getUint16(4, true) ^ (x & 0xffff), true); // coins
  // Each pocket slot is an item id and its count; only the count is keyed. The PC's
  // items, before the pockets, are not.
  for (let at = POCKETS_AT; at < BAG_LEN; at += 4) v.setUint16(at + 2, v.getUint16(at + 2, true) ^ (x & 0xffff), true);
  return out;
}
