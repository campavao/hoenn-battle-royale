import { describe, expect, it } from 'vitest';
import { MAILBOX } from './mailbox';
import { BR_CONT_FLAG, BR_MSG, packSlot, reassembleSlots, unpackSlot, type BinarySlot } from './slots';
import type { Msg, PackedMon } from './wire';
import { PROTOCOL } from './wire';

// Pack -> (simulate the ring) -> reassemble -> unpack, the same round trip a real
// mailbox poll does across however many slots a message took.
function roundTrip(msg: Msg): Msg {
  const slots = packSlot(msg);
  for (const s of slots) {
    expect(s.payload.length).toBeLessThanOrEqual(MAILBOX.PAYLOAD_MAX);
  }
  const { type, payload } = reassembleSlots(slots);
  return unpackSlot(type, payload);
}

function mon(over: Partial<PackedMon> = {}): PackedMon {
  return {
    species: 1, level: 50, hp: 80, maxHp: 100, status: 0,
    moves: [{ id: 33, pp: 20, ppUps: 0 }], heldItem: 0, otId: 1,
    personality: 12345, exp: 5000, nickname: 'BULBY', ot: 'ASH',
    ...over,
  };
}

describe('slots round trip (single slot)', () => {
  const cases: Msg[] = [
    { t: 'place', v: PROTOCOL, seat: 3, map: { group: 0, num: 1 }, x: 10, y: -5, f: 1, st: 'alive' },
    { t: 'place', v: PROTOCOL, seat: 0, f: 2, st: 'lobby' },
    { t: 'step', seat: 1, d: 4, x: 20, y: -21, map: { group: 0, num: 1 } },
    { t: 'face', seat: 1, f: 3, map: { group: 0, num: 1 } },
    { t: 'challenge', seat: 2, opponent: 5, nonce: 7 },
    { t: 'faint', seat: 2, index: 3 },
    { t: 'out', seat: 2 },
    { t: 'pickup', seat: 2, key: 55 },
    { t: 'pickup', seat: 2, key: 55, item: 12, n: 3, cash: true },
    { t: 'ring', seat: 0, phase: 1, sx: -12, sy: 12, r: 10, place: 'Littleroot', elapsed: 0 },
    { t: 'ring', seat: 0, phase: 64, sx: 0, sy: 0, r: -1 },
    { t: 'clock', seat: 0, left: 120 },
    { t: 'result', seat: 1, outcome: 'forfeit' },
    { t: 'ticker', seat: 1, kind: 'kill', text: 'ASH KO MISTY' },
    { t: 'ticker', seat: 1, text: 'the fog is closing in' },
    {
      t: 'start', seed: 42, safari: 300, fog: 60,
      spawns: [{ seat: 0, map: { group: 0, num: 1 }, x: 1, y: 1 }],
      pace: { textSpeed: 5, animations: false },
    },
  ];

  for (const msg of cases) {
    it(`round-trips ${msg.t} ${JSON.stringify(msg).slice(0, 50)}`, () => {
      expect(packSlot(msg)).toHaveLength(1);
      expect(roundTrip(msg)).toEqual(msg);
    });
  }
});

describe('slots round trip (spans multiple slots)', () => {
  it('a 6-mon party (~600 bytes)', () => {
    const msg: Msg = {
      t: 'party', seat: 4,
      mons: [mon(), mon({ species: 4 }), mon({ species: 7 }), mon({ species: 25 }), mon({ species: 39 }), mon({ species: 150, traded: true })],
    };
    const slots = packSlot(msg);
    expect(slots.length).toBeGreaterThan(1);
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('a 256-byte battle block', () => {
    const data = Array.from({ length: 256 }, (_, i) => i & 0xff);
    const msg: Msg = { t: 'bt', seat: 9, seq: 500, data };
    const slots = packSlot(msg);
    expect(slots.length).toBeGreaterThan(1);
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('a full 32-seat start', () => {
    const spawns = Array.from({ length: 32 }, (_, i) => ({ seat: i, map: { group: 0, num: 1 }, x: i, y: i, st: i % 2 ? ('out' as const) : undefined }));
    const msg: Msg = { t: 'start', seed: 999, spawns, safari: 0, fog: 3600 };
    expect(packSlot(msg).length).toBeGreaterThan(1);
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('a spill with a full bag', () => {
    const msg: Msg = {
      t: 'spill', seat: 3, map: { group: 0, num: 5 },
      mons: [
        { key: 1, x: 1, y: 1, species: 1, level: 5 },
        { key: 2, x: 2, y: 2, species: 4, level: 6 },
      ],
      bag: {
        key: 99, x: 3, y: 3,
        items: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, n: i + 1 })),
        money: 12345, name: 'MISTY',
      },
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('the continuation flag marks every slot after the first', () => {
    const data = Array.from({ length: 256 }, () => 1);
    const slots = packSlot({ t: 'bt', seat: 0, seq: 0, data });
    expect(slots[0].type & BR_CONT_FLAG).toBe(0);
    for (const s of slots.slice(1)) expect(s.type & BR_CONT_FLAG).toBe(BR_CONT_FLAG);
  });
});

describe('reassembleSlots', () => {
  it('rejects a seq gap', () => {
    const slots = packSlot({ t: 'bt', seat: 0, seq: 0, data: Array.from({ length: 256 }, () => 1) });
    const tampered = [slots[0], slots[2]]; // drop the middle continuation
    expect(() => reassembleSlots(tampered)).toThrow(/seq/);
  });

  it('rejects a mismatched continuation type', () => {
    const a = packSlot({ t: 'bt', seat: 0, seq: 0, data: Array.from({ length: 256 }, () => 1) });
    const b = packSlot({ t: 'party', seat: 0, mons: [mon()] });
    const mixed: BinarySlot[] = [a[0], b[1] ?? a[1]];
    expect(() => reassembleSlots(mixed)).toThrow();
  });

  it('rejects starting on a continuation slot', () => {
    const slots = packSlot({ t: 'bt', seat: 0, seq: 0, data: Array.from({ length: 256 }, () => 1) });
    expect(() => reassembleSlots([slots[1]])).toThrow(/continuation/);
  });
});

describe('unpackSlot', () => {
  it('rejects a type still carrying the continuation flag', () => {
    expect(() => unpackSlot(BR_MSG.OUT | BR_CONT_FLAG, Uint8Array.of(0))).toThrow();
  });

  it('rejects an unknown message type', () => {
    expect(() => unpackSlot(0x7f, Uint8Array.of(0))).toThrow();
  });
});

// The layout table of record: fixed byte counts BEFORE slot-splitting, matching the
// per-message comment blocks in include/br/br_wire.h. A change to either side without
// the other fails here first.
const FIXED_LAYOUT_SIZES: Record<string, number> = {
  place: 11, // seat, hasMap, group, num, x:s16, y:s16, facing, status, spriteId
  step: 8, // seat, d, x:s16, y:s16, group, num
  face: 4, // seat, f, group, num
  challenge: 4, // seat, opponent, nonce:u16
  faint: 2, // seat, index
  out: 1, // seat
  clock: 3, // seat, left:u16
  result: 2, // seat, outcome
};

describe('fixed-layout byte counts', () => {
  for (const [t, size] of Object.entries(FIXED_LAYOUT_SIZES)) {
    it(`${t} packs to ${size} bytes before framing`, () => {
      const sample: Record<string, Msg> = {
        place: { t: 'place', v: PROTOCOL, seat: 0, map: { group: 0, num: 0 }, x: 0, y: 0, f: 1, st: 'alive' },
        step: { t: 'step', seat: 0, d: 1, x: 0, y: 0, map: { group: 0, num: 0 } },
        face: { t: 'face', seat: 0, f: 1, map: { group: 0, num: 0 } },
        challenge: { t: 'challenge', seat: 0, opponent: 1, nonce: 0 },
        faint: { t: 'faint', seat: 0, index: 0 },
        out: { t: 'out', seat: 0 },
        clock: { t: 'clock', seat: 0, left: 0 },
        result: { t: 'result', seat: 0, outcome: 'win' },
      };
      const slots = packSlot(sample[t]);
      // one slot, framed with the 3-byte first-slot header
      expect(slots).toHaveLength(1);
      expect(slots[0].payload.length).toBe(size + 3);
    });
  }

  it('a party mon packs to exactly 100 bytes', () => {
    const slots = packSlot({ t: 'party', seat: 0, mons: [mon()] });
    const { payload } = reassembleSlots(slots);
    // seat(1) + count(1) + 1 mon * 100
    expect(payload.length).toBe(2 + 100);
  });
});
