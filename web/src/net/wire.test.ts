import { describe, expect, it } from 'vitest';
import { decode, encode, PROTOCOL, WireError, type Msg } from './wire';
import { BR_MSG, unpackSlot } from './slots';
import { encodeGen3 } from '../text/gen3';

// One round-trip sample per message type. Every field a decoder normalizes gets
// exercised so a round trip catches a silently-dropped or silently-renamed field.
const SAMPLES: Msg[] = [
  {
    t: 'place', v: PROTOCOL, seat: 3, map: { group: 0, num: 1 }, x: 10, y: -5, f: 1,
    st: 'alive', sprite: 'may', wins: 4, fill: 8, seed: 12345, countdown: 30,
    build: { engine: '0.0.0-dev', mod: '1.0.0' },
  },
  { t: 'place', v: PROTOCOL, seat: 0, f: 2, st: 'lobby' },
  { t: 'step', seat: 1, d: 4, x: 20, y: 21, map: { group: 0, num: 1 } },
  { t: 'face', seat: 1, f: 3, map: { group: 0, num: 1 } },
  {
    t: 'start', seed: 42, safari: 300, fog: 60,
    spawns: [{ seat: 0, map: { group: 0, num: 1 }, x: 1, y: 1 }, { seat: 1, map: { group: 0, num: 1 }, x: 2, y: 2 }],
    pace: { textSpeed: 3, animations: true },
  },
  {
    t: 'late', seed: 42, fog: 60, spawns: [{ seat: 0, map: { group: 0, num: 1 }, x: 1, y: 1, st: 'out' }],
    ring: { t: 'ring', seat: 0, phase: 2, sx: 3, sy: -4, r: 5, place: 'Route 101', elapsed: 90 },
  },
  { t: 'challenge', seat: 2, opponent: 5, nonce: 7, lines: { intro: 'Go!' } },
  { t: 'accept', seat: 5, opponent: 2, nonce: 7 },
  { t: 'decline', seat: 5, opponent: 2, nonce: 7, why: 'busy' },
  { t: 'bt', seat: 2, seq: 9, data: [1, 2, 3, 255] },
  { t: 'bt', seat: 2, seq: 9, data: [1], fight: 7 * 0x10000 + 3 },
  {
    t: 'party', seat: 2, mons: [{
      species: 1, level: 50, hp: 80, maxHp: 100, status: 0,
      moves: [{ id: 33, pp: 20, ppUps: 1 }], heldItem: 0, otId: 1234,
      personality: 999, exp: 5000, nickname: 'BULBY', ot: 'ASH', traded: true,
    }],
  },
  { t: 'faint', seat: 2, index: 3 },
  { t: 'out', seat: 2 },
  { t: 'pickup', seat: 2, key: 55 },
  { t: 'pickup', seat: 2, key: 55, item: 12, n: 3, cash: true },
  {
    t: 'spill', seat: 2, map: { group: 0, num: 1 },
    mons: [{ key: 1, x: 5, y: 5, species: 1, level: 10 }],
    bag: { key: 2, x: 5, y: 6, items: [{ id: 1, n: 2 }], money: 500, name: 'ASH' },
  },
  { t: 'npcout', seat: 2, map: { group: 0, num: 1 }, localId: 7 },
  { t: 'ring', seat: 0, phase: 1, sx: 0, sy: 0, r: 10, place: 'Littleroot', elapsed: 0 },
  { t: 'clock', seat: 0, left: 120 },
  { t: 'win', seat: 4 },
  { t: 'win' },
  { t: 'again', seat: 0 },
  { t: 'busy', seat: 1, kind: 'menu' },
  { t: 'busy', seat: 1 },
  { t: 'peek', seat: 1, target: 2 },
  { t: 'peek', seat: 1, target: 2, have: 2 | (5 << 8) },
  { t: 'botout', seat: 1, target: 30 },
  { t: 'botrec', seat: 30, mons: [{ species: 1, hpFrac: 0.5 }], bag: { items: [], money: 0 } },
  { t: 'ticker', seat: 1, kind: 'kill', text: 'ASH knocked out MISTY!' },
  { t: 'ready', seat: 1, ready: true },
  { t: 'result', seat: 1, outcome: 'win' },
  { t: 'give', items: [{ id: 13, n: 2 }] },
  { t: 'ping', seat: 1, at: 1000 },
  { t: 'pong', seat: 1, at: 1000 },
];

describe('wire encode/decode round trip', () => {
  for (const msg of SAMPLES) {
    it(`round-trips ${msg.t} (${JSON.stringify(msg).slice(0, 40)})`, () => {
      const decoded = decode(encode(msg));
      expect(decoded).toEqual(msg);
    });
  }
});

describe('wire.decode rejects', () => {
  it('an unknown type', () => {
    expect(() => decode(JSON.stringify({ t: 'nonsense' }))).toThrow(WireError);
  });

  // POK-330 #24: the type was looked up with `in`, which walks the prototype, so these
  // found Object's own methods and came back as whatever those return.
  it("a type that only names something on Object's prototype", () => {
    for (const t of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
      expect(() => decode(JSON.stringify({ t })), t).toThrow(WireError);
    }
  });

  it('a missing seat', () => {
    expect(() => decode(JSON.stringify({ t: 'out' }))).toThrow(WireError);
  });

  it('an out-of-range seat', () => {
    expect(() => decode(JSON.stringify({ t: 'out', seat: 32 }))).toThrow(WireError);
    expect(() => decode(JSON.stringify({ t: 'out', seat: -1 }))).toThrow(WireError);
  });

  it('an out-of-range coordinate', () => {
    expect(() =>
      decode(JSON.stringify({ t: 'step', seat: 0, d: 1, x: 100000, y: 0, map: { group: 0, num: 0 } })),
    ).toThrow(WireError);
  });

  it('a non-integer coordinate', () => {
    expect(() =>
      decode(JSON.stringify({ t: 'step', seat: 0, d: 1, x: 1.5, y: 0, map: { group: 0, num: 0 } })),
    ).toThrow(WireError);
  });

  it('a bad facing', () => {
    expect(() =>
      decode(JSON.stringify({ t: 'face', seat: 0, f: 9, map: { group: 0, num: 0 } })),
    ).toThrow(WireError);
  });

  it('a protocol mismatch on place, distinguishably', () => {
    expect(() =>
      decode(JSON.stringify({ t: 'place', v: PROTOCOL + 1, seat: 0, f: 1, st: 'lobby' })),
    ).toThrow(/protocol/);
  });

  it('malformed JSON', () => {
    expect(() => decode('{not json')).toThrow(WireError);
  });

  it('a JSON array instead of an object', () => {
    expect(() => decode('[]')).toThrow(WireError);
  });

  it('an empty start (no spawns)', () => {
    expect(() => decode(JSON.stringify({ t: 'start', seed: 1, spawns: [] }))).toThrow(WireError);
  });

  it('a party of more than 6 mons', () => {
    const mon = { species: 1, level: 1, hp: 1, maxHp: 1, status: 0 };
    expect(() =>
      decode(JSON.stringify({ t: 'party', seat: 0, mons: [mon, mon, mon, mon, mon, mon, mon] })),
    ).toThrow(WireError);
  });

  it('a block payload over 256 bytes', () => {
    expect(() =>
      decode(JSON.stringify({ t: 'bt', seat: 0, seq: 0, data: new Array(257).fill(0) })),
    ).toThrow(WireError);
  });
});

// POK-331 #1. A party row the way a ROM packs one (br_spectate.c's PackOwnMon into
// br_wire.h's PackedMon): the 100 bytes zeroed, then species, level, HP, status code,
// moves and PP, the held item, the flags and the nickname. Nothing where the OT goes.
function romRow(species: number, level: number, hp: number, maxHp: number, moves: [number, number][], nickname: string): Uint8Array {
  const row = new Uint8Array(100);
  const u16 = (at: number, v: number) => {
    row[at] = v & 0xff;
    row[at + 1] = v >> 8;
  };
  u16(0, species);
  row[2] = level;
  u16(3, hp);
  u16(5, maxHp);
  moves.forEach(([id, pp], i) => {
    u16(8 + i * 4, id);
    row[10 + i * 4] = pp;
  });
  row[55] = 0x02; // BR_MON_ROM_MOVES: every row a ROM sends says so
  const name = encodeGen3(nickname, 10);
  row[36] = name.length;
  row.set(name, 37);
  return row;
}

describe('a party a ROM sent (POK-331 #1)', () => {
  it('is taken by every other page, OT blank and all', () => {
    // What a ROM reports after a fight with bot 30 (POK-238): the bot's team, under its seat.
    const payload = new Uint8Array(2 + 200);
    payload.set([30, 2]);
    payload.set(romRow(277, 12, 30, 34, [[1, 35], [98, 28]], 'TREECKO'), 2);
    payload.set(romRow(288, 10, 0, 29, [[33, 35]], 'ZIGZAGOON'), 102);
    const fromRom = unpackSlot(BR_MSG.PARTY, payload); // the Bridge, off the out-ring

    const heard = decode(encode(fromRom)); // every other page, off the relay
    expect(heard).toMatchObject({
      t: 'party',
      seat: 30,
      mons: [
        { species: 277, level: 12, hp: 30, maxHp: 34, nickname: 'TREECKO', ot: '' },
        { species: 288, level: 10, hp: 0, maxHp: 29, nickname: 'ZIGZAGOON', ot: '' },
      ],
    });
  });

  it('still refuses an OT or a nickname too long for its field', () => {
    const mon = { species: 1, level: 1, hp: 1, maxHp: 1, status: 0 };
    expect(() => decode(JSON.stringify({ t: 'party', seat: 0, mons: [{ ...mon, ot: 'ABCDEFGH' }] }))).toThrow(WireError);
    expect(() => decode(JSON.stringify({ t: 'party', seat: 0, mons: [{ ...mon, nickname: 'ABCDEFGHIJK' }] }))).toThrow(WireError);
    expect(() => decode(JSON.stringify({ t: 'party', seat: 0, mons: [{ ...mon, ot: 7 }] }))).toThrow(WireError);
  });
});
