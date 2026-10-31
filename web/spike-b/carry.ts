import type { MatchTally } from '../src/match/tally';
import type { addTotals } from '../src/match/career';
import HMS from '../src/data/hms.json';
import { MOVE_CUT, MOVE_STRENGTH, MOVE_SURF } from '../src/bots/party';
import { decodeGen3 } from '../src/text/gen3';
import type { FameMon } from '../src/ui/results';

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

/** The pockets' items, decrypted: id -> count. */
function pocketCounts(bag: Uint8Array, key: number): Map<number, number> {
  const v = new DataView(bag.buffer, bag.byteOffset, bag.byteLength);
  const out = new Map<number, number>();
  for (let at = POCKETS_AT; at < BAG_LEN; at += 4) {
    const id = v.getUint16(at, true);
    if (id) out.set(id, (out.get(id) ?? 0) + (v.getUint16(at + 2, true) ^ (key & 0xffff)));
  }
  return out;
}

/** What a GIVE did to the bag, as the ROM filed it: the items that went in (a POKé BALL
 *  as ROYALé BALLs, a FULL HEAL as a FULL RESTORE -- br_items.c's Apply) and money made
 *  (an item sold). Nothing either way: it did not fit. */
export function arrived(before: { bag: Uint8Array; key: number }, after: { bag: Uint8Array; key: number }): { items: { id: number; n: number }[]; money: number } {
  const was = pocketCounts(before.bag, before.key), now = pocketCounts(after.bag, after.key);
  const items: { id: number; n: number }[] = [];
  for (const [id, n] of now) if (n > (was.get(id) ?? 0)) items.push({ id, n: n - (was.get(id) ?? 0) });
  const money = (bytes: Uint8Array, key: number) => (new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) ^ key) >>> 0;
  return { items, money: money(after.bag, after.key) - money(before.bag, before.key) };
}

// The pockets a fallen trainer's bag spills (POK-232): items, balls and berries. Not key
// items (a trainer's own, every one already has the ITEMFINDER) and not machines (a TM
// off the ground is taught there and then, br_items.c's Found, which a GIVE would skip).
const SPILL_POCKETS: [number, number][] = [[0x560, 30], [0x650, 16], [0x790, 46]];

/** What a trainer who is out leaves on the ground: the spilling pockets' rows, in bag
 *  order, and the money, decrypted under `key`. */
export function spillOf(bag: Uint8Array, key: number): { items: { id: number; n: number }[]; money: number } {
  const v = new DataView(bag.buffer, bag.byteOffset, bag.byteLength);
  const items: { id: number; n: number }[] = [];
  for (const [at, slots] of SPILL_POCKETS)
    for (let i = 0; i < slots; i++) {
      const o = at - BAG_AT + 4 * i;
      const id = v.getUint16(o, true), n = v.getUint16(o + 2, true) ^ (key & 0xffff);
      if (id && n) items.push({ id, n });
    }
  return { items, money: (v.getUint32(0, true) ^ key) >>> 0 };
}

// Every pocket (global.h's SaveBlock1): items, key items, balls, machines, berries.
const POCKETS: [number, number][] = [[0x560, 30], [0x5d8, 30], [0x650, 16], [0x690, 64], [0x790, 46]];

/** The bag run with one `item` fewer, its pocket closed up behind it (RemoveBagItem and
 *  CompactItemsInBagPocket); null when it has none. */
export function withoutItem(bag: Uint8Array, key: number, item: number): Uint8Array | null {
  const out = bag.slice();
  const v = new DataView(out.buffer);
  for (const [at, slots] of POCKETS) {
    const base = at - BAG_AT;
    for (let i = 0; i < slots; i++) {
      const o = base + 4 * i;
      if (v.getUint16(o, true) !== item) continue;
      const n = v.getUint16(o + 2, true) ^ (key & 0xffff);
      if (!n) continue;
      if (n > 1) { v.setUint16(o + 2, (n - 1) ^ (key & 0xffff), true); return out; }
      for (let j = i; j < slots - 1; j++) v.setUint32(base + 4 * j, v.getUint32(base + 4 * (j + 1), true), true);
      v.setUint16(base + 4 * (slots - 1), 0, true);
      v.setUint16(base + 4 * (slots - 1) + 2, key & 0xffff, true);
      return out;
    }
  }
  return null;
}

/** The bag run with `more` money in it, capped at the game's 999,999 (AddMoney). */
export function withMoney(bag: Uint8Array, key: number, more: number): Uint8Array {
  const out = bag.slice();
  const v = new DataView(out.buffer);
  const now = (v.getUint32(0, true) ^ key) >>> 0;
  v.setUint32(0, (Math.min(now + more, 999999) ^ key) >>> 0, true);
  return out;
}

// Where each of a mon's four substructs sits, by personality % 24 (pokemon.c's
// GetSubstruct): the growth one, which holds the species, is G.
const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];

/** The team, as a dropped bag carries it: species and level, the way BrLoot_SpillOwn
 *  writes each row. Whoever takes one gets it made fresh at that species and level
 *  (br_loot.c's MakeTaken), as in the match (HBR-82). */
export function teamOf(party: Uint8Array, count: number): { species: number; level: number }[] {
  const v = new DataView(party.buffer, party.byteOffset, party.byteLength);
  const out: { species: number; level: number }[] = [];
  for (let i = 0; i < Math.min(count, 6); i++) {
    const at = i * 100;
    const personality = v.getUint32(at, true), key = (personality ^ v.getUint32(at + 4, true)) >>> 0;
    const growth = at + 32 + 12 * ORDERS[personality % 24].indexOf('G');
    const species = ((v.getUint32(growth, true) ^ key) >>> 0) & 0xffff;
    if (species) out.push({ species, level: party[at + 84] });
  }
  return out;
}

/** The team as the results screen's hall of fame shows it (ui/results.ts fameOf): each
 *  one's nickname, species, level, HP and moves, and whether it is shiny (pokemon.c's
 *  IsShinyOtIdPersonality), out of the party's bytes. */
export function fameTeam(party: Uint8Array, count: number): FameMon[] {
  const v = new DataView(party.buffer, party.byteOffset, party.byteLength);
  const out: FameMon[] = [];
  for (let i = 0; i < Math.min(count, 6); i++) {
    const at = i * 100;
    const personality = v.getUint32(at, true), otId = v.getUint32(at + 4, true);
    const key = (personality ^ otId) >>> 0;
    const order = ORDERS[personality % 24];
    const word = (sub: string, off: number) => (v.getUint32(at + 32 + 12 * order.indexOf(sub) + off, true) ^ key) >>> 0;
    const species = word('G', 0) & 0xffff;
    if (!species) continue;
    const a = word('A', 0), b = word('A', 4);
    const moves = [a & 0xffff, a >>> 16, b & 0xffff, b >>> 16].filter((id) => id > 0).map((id) => ({ id }));
    const raw = party.subarray(at + 8, at + 18);
    const end = raw.indexOf(0xff);
    let nickname: string | undefined;
    try { nickname = decodeGen3(end < 0 ? raw : raw.subarray(0, end)) || undefined; } catch { nickname = undefined; }
    const shiny = ((otId >>> 16) ^ (otId & 0xffff) ^ (personality >>> 16) ^ (personality & 0xffff)) < 8;
    out.push({ species, nickname, level: party[at + 84], hp: v.getUint16(at + 86, true), maxHp: v.getUint16(at + 88, true), shiny, moves, personality, otId });
  }
  return out;
}

/** The CENTER's heal on a party as rom.ts keeps it: pokemon.c's HealPlayerParty -- HP to
 *  the top, no status, every move's PP back to its most (CalculatePPWithBonus). PP lives
 *  in the encrypted Attacks substruct, so that one is decrypted, refilled, its checksum
 *  summed again and encrypted back. `basePp(move)` is gBattleMoves[move].pp. */
export function healed(party: Uint8Array, count: number, basePp: (move: number) => number): Uint8Array {
  const out = party.slice();
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < Math.min(count, 6); i++) {
    const at = i * 100;
    const personality = v.getUint32(at, true), key = (personality ^ v.getUint32(at + 4, true)) >>> 0;
    if (!personality && !key) continue;
    const plain = new DataView(new ArrayBuffer(48));
    for (let w = 0; w < 12; w++) plain.setUint32(w * 4, (v.getUint32(at + 32 + w * 4, true) ^ key) >>> 0, true);
    const order = ORDERS[personality % 24];
    const growth = 12 * order.indexOf('G'), attacks = 12 * order.indexOf('A');
    if (!plain.getUint16(growth, true)) continue; // no species: an empty slot
    const bonuses = plain.getUint8(growth + 8);
    for (let m = 0; m < 4; m++) {
      const move = plain.getUint16(attacks + m * 2, true);
      const base = move ? basePp(move) : 0;
      plain.setUint8(attacks + 8 + m, base + Math.floor((base * 20 * ((bonuses >> (2 * m)) & 3)) / 100));
    }
    let sum = 0;
    for (let h = 0; h < 24; h++) sum = (sum + plain.getUint16(h * 2, true)) & 0xffff;
    v.setUint16(at + 28, sum, true);
    for (let w = 0; w < 12; w++) v.setUint32(at + 32 + w * 4, (plain.getUint32(w * 4, true) ^ key) >>> 0, true);
    v.setUint32(at + 80, 0, true);
    v.setUint16(at + 86, v.getUint16(at + 88, true), true);
  }
  return out;
}

/** What a team could do on the field, as the room asks it (room.ts FIELD_*): CUT 1,
 *  STRENGTH 2, SURF 4, for a team with somebody who knows the move or whose species could
 *  learn the HM (br_hm.c BrHm_Slot; bots/brain.ts couldUse). */
export function fieldOf(party: Uint8Array, count: number): number {
  const v = new DataView(party.buffer, party.byteOffset, party.byteLength);
  const has = (hex: string, species: number) => {
    const byte = parseInt(hex.substr((species >> 3) * 2, 2), 16);
    return !Number.isNaN(byte) && ((byte >> (species & 7)) & 1) === 1;
  };
  let bits = 0;
  for (let i = 0; i < Math.min(count, 6); i++) {
    const at = i * 100;
    const personality = v.getUint32(at, true), key = (personality ^ v.getUint32(at + 4, true)) >>> 0;
    const word = (sub: string, off: number) => (v.getUint32(at + 32 + 12 * ORDERS[personality % 24].indexOf(sub) + off, true) ^ key) >>> 0;
    const species = word('G', 0) & 0xffff;
    if (!species) continue;
    const moves = [word('A', 0) & 0xffff, word('A', 0) >>> 16, word('A', 4) & 0xffff, word('A', 4) >>> 16];
    if (moves.includes(MOVE_CUT) || has(HMS.cut, species)) bits |= 1;
    if (moves.includes(MOVE_STRENGTH) || has(HMS.strength, species)) bits |= 2;
    if (moves.includes(MOVE_SURF) || has(HMS.surf, species)) bits |= 4;
  }
  return bits;
}

/** What a round added to MY STATS (career.ts's addTotals, POK-416): the hidden ROM's
 *  gBrTally now less what it had when the round began (it counts from boot here, not
 *  from a match's start), and the steps the page counted, since the ROM walks none. */
export function tallySince(from: MatchTally | null, now: MatchTally | null, steps: number): Parameters<typeof addTotals>[1] {
  const less = (a: Record<number, number>, b: Record<number, number> = {}) => {
    const out: Record<number, number> = {};
    for (const [id, n] of Object.entries(a)) { const d = n - (b[Number(id)] ?? 0); if (d > 0) out[Number(id)] = d; }
    return out;
  };
  const d = (k: 'won' | 'caught' | 'items') => Math.max(0, (now?.[k] ?? 0) - (from?.[k] ?? 0));
  return { won: d('won'), caught: d('caught'), items: d('items'), steps, trainers: 0, duelsWon: 0, took: 0, mons: now ? less(now.mons, from?.mons) : {}, moves: now ? less(now.moves, from?.moves) : {} };
}
