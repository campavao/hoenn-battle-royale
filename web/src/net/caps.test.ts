import { describe, expect, it } from 'vitest';
import wireHeader from '../../../include/br/br_wire.h?raw';
import idsHeader from '../../../include/br/br_wire_ids.h?raw';
import { BR_MSG, packSlot, reassembleSlots } from './slots';
import { BR_CAP } from './wire-ids';
import { PARTY_BAG_MAX } from './wire';
import type { Msg, PackedMon } from './wire';

// The ROM reassembles a message that spans slots into a buffer of a fixed size, and
// BrWire_Assemble drops one that claims more without a word. So every cap in the wire
// table (tools/br/wire-table.txt: BR_CAP here, BR_CAP_* in br_wire_ids.h) has to hold
// the page's largest encoding of its message -- which the TRAINER and DUEL caps did not,
// once the item tails arrived (POK-330 #11): a six-mon card with a seven-letter name, and
// every 6v6 duel, never reached the ROM at all.

const CAPS: Record<string, number> = { ...BR_CAP };
const define = (name: string): number => {
  const m = new RegExp(`^#define ${name} (\\d+)`, 'm').exec(`${wireHeader}\n${idsHeader}`);
  if (!m) throw new Error(`no ${name} in br_wire.h or br_wire_ids.h`);
  return Number(m[1]);
};

/** The packed length the ROM's assembler sees: the first slot's totalLen. */
const packedLength = (msg: Msg): number => reassembleSlots(packSlot(msg)).payload.length;

const NAME = 'WALLACE'; // seven letters: a trainer name box is full at seven
const mon = (species: number): PackedMon => ({
  species,
  level: 100,
  hp: 999,
  maxHp: 999,
  status: 0,
  moves: [1, 2, 3, 4].map((id) => ({ id, pp: 40, ppUps: 3 })),
  heldItem: 13,
  otId: 0xffff,
  personality: 0xffffffff,
  exp: 0xffffffff,
  nickname: 'ABCDEFGHIJ',
  ot: NAME,
});
const six = [277, 278, 279, 280, 281, 282].map(mon);
const fourItems = [13, 75, 22, 23];

/** The largest instance of every message the page packs into a ROM that spans slots. */
const LARGEST: Record<string, Msg> = {
  BT: { t: 'bt', seat: 31, seq: 0xffff, data: new Array(256).fill(0xff) },
  PARTY: {
    t: 'party',
    seat: 31,
    mons: six,
    bag: { money: 999_999, items: Array.from({ length: PARTY_BAG_MAX }, (_, i) => ({ id: i + 1, n: 99 })) },
  },
  SPILL: {
    t: 'spill',
    seat: 31,
    map: { group: 0, num: 9 },
    mons: six.map((m, i) => ({ key: 0x1f00 | i, x: -1000, y: 1000, species: m.species, level: 100 })),
    bag: {
      key: 0x1fff,
      x: -1000,
      y: 1000,
      items: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, n: 99 })),
      money: 999_999,
      name: NAME,
    },
  },
  START: {
    t: 'start',
    seed: 0xffffffff,
    spawns: Array.from({ length: 32 }, (_, seat) => ({ seat, map: { group: 0, num: 9 }, x: 1000, y: -1000 })),
    safari: 3600,
    fog: 3600,
    pace: { textSpeed: 5, animations: true },
  },
  TRAINER: { t: 'trainer', seat: 31, name: NAME, mons: six, items: fourItems },
  DUEL: { t: 'duel', seatA: 30, seatB: 31, a: six, b: six, itemsA: fourItems, itemsB: fourItems },
};

describe('the ROM holds the largest message the page sends it (BR_CAP_*)', () => {
  it('has a cap for every message that spans slots, and no others', () => {
    // bstart and turn are the fighter's ROM's bytes, relayed as they are; the rest the
    // page composes itself.
    expect(Object.keys(CAPS).sort()).toEqual([...Object.keys(LARGEST), 'BSTART', 'TURN'].sort());
  });

  for (const [name, msg] of Object.entries(LARGEST)) {
    it(`${name}: the page's largest fits the ROM's cap`, () => {
      expect(packedLength(msg)).toBeLessThanOrEqual(CAPS[name]);
    });
  }

  it('the two the page only relays come back out at the length the fighter sent', () => {
    // A bstart is battle u16 + data; the page keeps the id apart and puts it back, so a
    // ROM-sized bstart repacks to exactly the ROM's size and no more.
    expect(packedLength({ t: 'bstart', battle: 0x1f1e, data: new Array(CAPS.BSTART - 2).fill(1) })).toBe(CAPS.BSTART);
    expect(packedLength({ t: 'turn', battle: 0x1f1e, data: new Array(CAPS.TURN - 2).fill(1) })).toBe(CAPS.TURN);
  });

  it('the trainer and duel caps have room for the tails that were missing', () => {
    // 1 + 1 + 7 + 1 + 600 + 1 + 8, and 4 + 1200 + 2 * 9 -- the numbers the old caps were short of.
    expect(packedLength(LARGEST.TRAINER)).toBe(619);
    expect(packedLength(LARGEST.DUEL)).toBe(1222);
  });
});

describe('every message type fits the ROM dispatch table (br_wire.h BR_MSG_COUNT)', () => {
  it('has no type at or past the table, and LAST is the highest', () => {
    const count = define('BR_MSG_COUNT');
    const ids = Object.values(BR_MSG);
    expect(Math.max(...ids)).toBeLessThan(count);
    expect(idsHeader).toMatch(/^#define BR_MSG_LAST BR_MSG_(\w+)/m);
    const last = /^#define BR_MSG_LAST BR_MSG_(\w+)/m.exec(idsHeader)![1];
    expect(define(`BR_MSG_${last}`)).toBe(Math.max(...ids));
  });
});
