// The mailbox binary codec (POK-217): the subset of `wire.ts` messages that cross
// between the page and the ROM -- everything the ROM must act on (place/step/face,
// an engaged challenge, a battle block, a party to build a trainer battle from,
// pickup/spill, ring, clock, start) or itself emits (faint, out, result, and the
// ticker/say text it prints). Everything else in `Msg` (accept/decline, late, win,
// again, busy, peek, botout/botrec, fame, ready, ping/pong) lives only in the JSON
// relay layer -- see docs/WIRE.md for the full table and the reasoning per message.
//
// Little-endian, fixed layouts, matching `include/br/br_wire.h`'s per-message byte
// comments field for field -- the C side is written from that header alone. A slot's
// payload is at most MAILBOX.PAYLOAD_MAX (62) bytes; a message that packs larger
// spans multiple slots with a continuation scheme (see below).
//
// Continuation scheme: every packed message, even a one-slot one, opens with a
// 3-byte header on its FIRST slot -- `totalLen: u16 LE` (the packed message's own
// byte length, before slot-splitting) and `seq: u8` (always 0 on the first slot).
// If `totalLen` fits in the first slot's remaining room, that is the whole message
// and there are no continuation slots. Otherwise the rest of the bytes follow in
// CONTINUATION slots: `type | BR_CONT_FLAG` (0x80), payload `seq: u8` (1, 2, 3, ...)
// followed by up to 61 more bytes. A single always-present header shape (rather than
// a special case for "fits in one slot") is what lets the ROM's C reader use one
// state machine for every message type instead of one path for framed and one for
// bare.
import { MAILBOX } from './mailbox';
import { packGen3String, unpackGen3String } from '../text/gen3';
import { PROTOCOL } from './wire';
import type {
  BlockMsg,
  BstartMsg,
  TurnMsg,
  FollowMsg,
  PeekMsg,
  ChallengeMsg,
  ClockMsg,
  Dir,
  FaceMsg,
  FaintMsg,
  MapRef,
  Msg,
  OutMsg,
  BusyMsg,
  Outcome,
  PackedMon,
  PickupMsg,
  PlaceMsg,
  RingMsg,
  SpillMsg,
  StartMsg,
  StepMsg,
  TickerKind,
  TickerMsg,
  PartyMsg,
  ResultMsg,
} from './wire';

// ---- the message-type table (mirrors include/br/br_wire.h) ----------------

export const BR_MSG = {
  NONE: 0,
  ECHO: 1,
  PLACE: 2,
  STEP: 3,
  FACE: 4,
  CHALLENGE: 5,
  BT: 6,
  PARTY: 7,
  FAINT: 8,
  OUT: 9,
  BUSY: 17,
  BSTART: 18,
  TURN: 19,
  FOLLOW: 20,
  PEEK: 21,
  PICKUP: 10,
  SPILL: 11,
  RING: 12,
  CLOCK: 13,
  START: 14,
  TICKER: 15,
  RESULT: 16,
} as const;

/** Set on a continuation slot's `type` byte; `type & ~BR_CONT_FLAG` names the message. */
export const BR_CONT_FLAG = 0x80;

export class SlotError extends Error {}

/** One binary message crossing the mailbox, as a fully-reassembled (type, payload)
 *  pair -- the shape `unpackSlot` consumes and `packBinary`'s first stage produces
 *  before slot-splitting. */
export interface BinarySlot {
  type: number;
  payload: Uint8Array;
}

// ---- byte-level helpers -----------------------------------------------------

class Writer {
  private bytes: number[] = [];
  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  s8(v: number): this {
    return this.u8(v < 0 ? v + 0x100 : v);
  }
  u16(v: number): this {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff);
    return this;
  }
  s16(v: number): this {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v: number): this {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  raw(v: Uint8Array | number[]): this {
    for (const b of v) this.bytes.push(b & 0xff);
    return this;
  }
  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private offset = 0;
  constructor(private bytes: Uint8Array) {}
  u8(): number {
    return this.bytes[this.offset++];
  }
  s8(): number {
    const v = this.u8();
    return v >= 0x80 ? v - 0x100 : v;
  }
  u16(): number {
    const v = this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8);
    this.offset += 2;
    return v >>> 0;
  }
  s16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  u32(): number {
    const v =
      (this.bytes[this.offset] |
        (this.bytes[this.offset + 1] << 8) |
        (this.bytes[this.offset + 2] << 16) |
        (this.bytes[this.offset + 3] << 24)) >>>
      0;
    this.offset += 4;
    return v;
  }
  raw(n: number): Uint8Array {
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  gen3String(): string {
    const { text, nextOffset } = unpackGen3String(this.bytes, this.offset);
    this.offset = nextOffset;
    return text;
  }
  get remaining(): number {
    return this.bytes.length - this.offset;
  }
}

function writeGen3(w: Writer, text: string, maxLen: number): void {
  w.raw(packGen3String(text, maxLen));
}

const MAP_REF_BYTES = 2; // an Emerald MapRef packs as group:u8, num:u8

const STATUS_ORDER = ['lobby', 'alive', 'battle', 'out'] as const;
const OUTCOME_ORDER: Outcome[] = ['win', 'lose', 'draw', 'forfeit'];
const TICKER_KIND_ORDER: TickerKind[] = ['system', 'kill', 'say'];
const TEXT_SPEED_ORDER = [1, 3, 5] as const;

// ---- per-message binary codecs ---------------------------------------------
// Each `encode*` takes a validated Msg (from wire.ts) and returns the packed bytes
// for that message BEFORE slot-splitting; each `decode*` is the inverse. Byte
// offsets and widths here are the ones documented in include/br/br_wire.h.

function encodePlace(m: PlaceMsg): Uint8Array {
  const w = new Writer();
  w.u8(m.seat);
  w.u8(m.map ? 1 : 0);
  w.u8(m.map?.group ?? 0);
  w.u8(m.map?.num ?? 0);
  w.s16(m.x ?? 0);
  w.s16(m.y ?? 0);
  w.u8(m.f);
  w.u8(STATUS_ORDER.indexOf(m.st));
  w.u8(m.sprite ? Math.min(255, m.sprite.length) : 0); // sprite id: string key length stands in for a real skin table index until one exists
  return w.toBytes();
}
function decodePlace(bytes: Uint8Array): PlaceMsg {
  const r = new Reader(bytes);
  const seat = r.u8();
  const hasMap = r.u8();
  const group = r.u8();
  const num = r.u8();
  const x = r.s16();
  const y = r.s16();
  const f = r.u8() as Dir;
  const st = STATUS_ORDER[r.u8()];
  const spriteId = r.u8();
  return {
    t: 'place',
    v: PROTOCOL,
    seat,
    map: hasMap ? { group, num } : undefined,
    x: hasMap ? x : undefined,
    y: hasMap ? y : undefined,
    f,
    st,
    sprite: spriteId ? String(spriteId) : undefined,
  };
}

function encodeStep(m: StepMsg): Uint8Array {
  return new Writer().u8(m.seat).u8(m.d).s16(m.x).s16(m.y).u8(m.map.group).u8(m.map.num).toBytes();
}
function decodeStep(bytes: Uint8Array): StepMsg {
  const r = new Reader(bytes);
  const seat = r.u8();
  const d = r.u8() as Dir;
  const x = r.s16();
  const y = r.s16();
  const map = { group: r.u8(), num: r.u8() };
  return { t: 'step', seat, d, x, y, map };
}

function encodeFace(m: FaceMsg): Uint8Array {
  return new Writer().u8(m.seat).u8(m.f).u8(m.map.group).u8(m.map.num).toBytes();
}
function decodeFace(bytes: Uint8Array): FaceMsg {
  const r = new Reader(bytes);
  const seat = r.u8();
  const f = r.u8() as Dir;
  const map = { group: r.u8(), num: r.u8() };
  return { t: 'face', seat, f, map };
}

function encodeChallenge(m: ChallengeMsg): Uint8Array {
  return new Writer().u8(m.seat).u8(m.opponent).u16(m.nonce & 0xffff).toBytes();
}
function decodeChallenge(bytes: Uint8Array): ChallengeMsg {
  const r = new Reader(bytes);
  return { t: 'challenge', seat: r.u8(), opponent: r.u8(), nonce: r.u16() };
}

function encodeBlock(m: BlockMsg): Uint8Array {
  // len is u16 (not u8): a full Emerald link block is 256 bytes, which does not
  // fit an 8-bit count.
  const w = new Writer().u8(m.seat).u16(m.seq).u16(m.data.length);
  w.raw(m.data);
  return w.toBytes();
}
function decodeBlock(bytes: Uint8Array): BlockMsg {
  const r = new Reader(bytes);
  const seat = r.u8();
  const seq = r.u16();
  const len = r.u16();
  const data = Array.from(r.raw(len));
  return { t: 'bt', seat, seq, data };
}

// bstart/turn (POK-233): a battle id then opaque bytes the spectator's ROM decodes.
function encodeBstart(m: BstartMsg): Uint8Array {
  return new Writer().u16(m.battle).raw(m.data).toBytes();
}
function decodeBstart(bytes: Uint8Array): BstartMsg {
  const r = new Reader(bytes);
  const battle = r.u16();
  return { t: 'bstart', battle, data: Array.from(r.raw(bytes.length - 2)) };
}
function encodePeek(m: PeekMsg): Uint8Array {
  return new Writer().u8(m.seat).u8(m.target).toBytes();
}
function decodePeek(bytes: Uint8Array): PeekMsg {
  const r = new Reader(bytes);
  return { t: 'peek', seat: r.u8(), target: r.u8() };
}
// seat 0xFF is "stop following" -- the ROM's BR_NO_SEAT.
function encodeFollow(m: FollowMsg): Uint8Array {
  return new Writer().u8(m.seat === null ? 0xff : m.seat).toBytes();
}
function decodeFollow(bytes: Uint8Array): FollowMsg {
  const seat = new Reader(bytes).u8();
  return { t: 'follow', seat: seat === 0xff ? null : seat };
}
function encodeTurn(m: TurnMsg): Uint8Array {
  return new Writer().u16(m.battle).raw(m.data).toBytes();
}
function decodeTurn(bytes: Uint8Array): TurnMsg {
  const r = new Reader(bytes);
  const battle = r.u16();
  return { t: 'turn', battle, data: Array.from(r.raw(bytes.length - 2)) };
}

const MON_BYTES = 100;
function encodeMon(mon: PackedMon): Uint8Array {
  const w = new Writer();
  w.u16(mon.species).u8(mon.level).u16(mon.hp).u16(mon.maxHp).u8(mon.status);
  for (let i = 0; i < 4; i++) {
    const mv = mon.moves[i];
    if (mv) w.u16(mv.id).u8(mv.pp).u8(mv.ppUps);
    else w.u16(0).u8(0).u8(0);
  }
  w.u16(mon.heldItem).u16(mon.otId).u32(mon.personality).u32(mon.exp);
  writeGen3(w, mon.nickname, 10);
  writeGen3(w, mon.ot, 7);
  w.u8(mon.traded ? 1 : 0);
  const bytes = w.toBytes();
  const padded = new Uint8Array(MON_BYTES);
  padded.set(bytes.subarray(0, MON_BYTES));
  return padded;
}
function decodeMon(bytes: Uint8Array): PackedMon {
  const r = new Reader(bytes);
  const species = r.u16();
  const level = r.u8();
  const hp = r.u16();
  const maxHp = r.u16();
  const status = r.u8();
  const moves = [];
  for (let i = 0; i < 4; i++) {
    const id = r.u16();
    const pp = r.u8();
    const ppUps = r.u8();
    if (id !== 0) moves.push({ id, pp, ppUps });
  }
  const heldItem = r.u16();
  const otId = r.u16();
  const personality = r.u32();
  const exp = r.u32();
  const nickname = r.gen3String();
  const ot = r.gen3String();
  const traded = r.u8() === 1;
  return {
    species, level, hp, maxHp, status, moves, heldItem, otId, personality, exp,
    nickname, ot, traded: traded ? true : undefined,
  };
}

function encodeParty(m: PartyMsg): Uint8Array {
  const w = new Writer().u8(m.seat).u8(m.mons.length);
  for (const mon of m.mons) w.raw(encodeMon(mon));
  return w.toBytes();
}
function decodeParty(bytes: Uint8Array): PartyMsg {
  const r = new Reader(bytes);
  const seat = r.u8();
  const count = r.u8();
  const mons: PackedMon[] = [];
  for (let i = 0; i < count; i++) mons.push(decodeMon(r.raw(MON_BYTES)));
  return { t: 'party', seat, mons };
}

function encodeFaint(m: FaintMsg): Uint8Array {
  return new Writer().u8(m.seat).u8(m.index).toBytes();
}
function decodeFaint(bytes: Uint8Array): FaintMsg {
  const r = new Reader(bytes);
  return { t: 'faint', seat: r.u8(), index: r.u8() };
}

function encodeOut(m: OutMsg): Uint8Array {
  return new Writer().u8(m.seat).toBytes();
}
function decodeOut(bytes: Uint8Array): OutMsg {
  return { t: 'out', seat: new Reader(bytes).u8() };
}

const BUSY_KINDS = [undefined, 'menu', 'battle'] as const;
function encodeBusy(m: BusyMsg): Uint8Array {
  const kind = m.kind === 'battle' ? 2 : m.kind === 'menu' ? 1 : 0;
  return new Writer().u8(m.seat).u8(kind).toBytes();
}
function decodeBusy(bytes: Uint8Array): BusyMsg {
  const r = new Reader(bytes);
  const seat = r.u8();
  const kind = BUSY_KINDS[r.u8()];
  return kind ? { t: 'busy', seat, kind } : { t: 'busy', seat };
}

function encodePickup(m: PickupMsg): Uint8Array {
  const hasItem = m.item !== undefined;
  return new Writer()
    .u8(m.seat)
    .u16(m.key)
    .u8(hasItem ? 1 : 0)
    .u16(m.item ?? 0)
    .u8(m.n ?? 0)
    .u8(m.cash ? 1 : 0)
    .toBytes();
}
function decodePickup(bytes: Uint8Array): PickupMsg {
  const r = new Reader(bytes);
  const seat = r.u8();
  const key = r.u16();
  const hasItem = r.u8() === 1;
  const item = r.u16();
  const n = r.u8();
  const cash = r.u8() === 1;
  return { t: 'pickup', seat, key, item: hasItem ? item : undefined, n: hasItem ? n : undefined, cash: hasItem ? cash : undefined };
}

const MAX_SPILL_ITEMS = 8;
function encodeSpill(m: SpillMsg): Uint8Array {
  const w = new Writer().u8(m.seat).u8(m.map.group).u8(m.map.num).u8(m.mons.length);
  for (const mon of m.mons.slice(0, 6)) {
    w.u16(mon.key).s16(mon.x).s16(mon.y).u16(mon.species).u8(mon.level);
  }
  w.u8(m.bag ? 1 : 0);
  if (m.bag) {
    w.u16(m.bag.key).s16(m.bag.x).s16(m.bag.y);
    const items = m.bag.items.slice(0, MAX_SPILL_ITEMS);
    w.u8(items.length);
    for (const it of items) w.u16(it.id).u8(it.n);
    w.u32(m.bag.money);
    writeGen3(w, m.bag.name ?? '', 7);
  }
  return w.toBytes();
}
function decodeSpill(bytes: Uint8Array): SpillMsg {
  const r = new Reader(bytes);
  const seat = r.u8();
  const map = { group: r.u8(), num: r.u8() };
  const count = r.u8();
  const mons = [];
  for (let i = 0; i < count; i++) {
    mons.push({ key: r.u16(), x: r.s16(), y: r.s16(), species: r.u16(), level: r.u8() });
  }
  const hasBag = r.u8() === 1;
  let bag: SpillMsg['bag'];
  if (hasBag) {
    const key = r.u16();
    const x = r.s16();
    const y = r.s16();
    const itemCount = r.u8();
    const items = [];
    for (let i = 0; i < itemCount; i++) items.push({ id: r.u16(), n: r.u8() });
    const money = r.u32();
    const name = r.gen3String();
    bag = { key, x, y, items, money, name: name.length ? name : undefined };
  }
  return { t: 'spill', seat, map, mons, bag };
}

function encodeRing(m: RingMsg): Uint8Array {
  const w = new Writer().u8(m.seat).u8(m.phase).s8(m.sx).s8(m.sy).s8(m.r);
  writeGen3(w, m.place ?? '', 16);
  w.u8(m.elapsed !== undefined ? 1 : 0);
  w.u16(m.elapsed ?? 0);
  return w.toBytes();
}
function decodeRing(bytes: Uint8Array): RingMsg {
  const r = new Reader(bytes);
  const seat = r.u8();
  const phase = r.u8();
  const sx = r.s8();
  const sy = r.s8();
  const rad = r.s8();
  const place = r.gen3String();
  const hasElapsed = r.u8() === 1;
  const elapsed = r.u16();
  return { t: 'ring', seat, phase, sx, sy, r: rad, place: place.length ? place : undefined, elapsed: hasElapsed ? elapsed : undefined };
}

function encodeClock(m: ClockMsg): Uint8Array {
  return new Writer().u8(m.seat).u16(m.left).toBytes();
}
function decodeClock(bytes: Uint8Array): ClockMsg {
  const r = new Reader(bytes);
  return { t: 'clock', seat: r.u8(), left: r.u16() };
}

function encodeStart(m: StartMsg): Uint8Array {
  const w = new Writer();
  w.u32(m.seed);
  w.u8(m.spawns.length);
  w.u16(m.safari ?? 0);
  w.u16(m.fog ?? 0);
  const speedIdx = m.pace ? TEXT_SPEED_ORDER.indexOf(m.pace.textSpeed) : 0;
  const paceFlags = (m.pace ? 1 : 0) | ((m.pace?.animations ? 1 : 0) << 1) | (speedIdx << 2);
  w.u8(paceFlags);
  for (const s of m.spawns) {
    w.u8(s.seat).u8(s.map.group).u8(s.map.num).s16(s.x).s16(s.y).u8(s.st === 'out' ? 1 : 0);
  }
  return w.toBytes();
}
function decodeStart(bytes: Uint8Array): StartMsg {
  const r = new Reader(bytes);
  const seed = r.u32();
  const count = r.u8();
  const safari = r.u16();
  const fog = r.u16();
  const paceFlags = r.u8();
  const hasPace = (paceFlags & 1) !== 0;
  const animations = (paceFlags & 2) !== 0;
  const speedIdx = (paceFlags >> 2) & 0x3;
  const spawns = [];
  for (let i = 0; i < count; i++) {
    const seat = r.u8();
    const map = { group: r.u8(), num: r.u8() };
    const x = r.s16();
    const y = r.s16();
    const out = r.u8() === 1;
    spawns.push({ seat, map, x, y, st: out ? ('out' as const) : undefined });
  }
  return {
    t: 'start',
    seed,
    spawns,
    // safari's valid JSON range includes 0 ("off" is a real value, not "absent"); fog's
    // does not (>= 1), so 0 there really does mean "no field was sent".
    safari,
    fog: fog || undefined,
    pace: hasPace ? { textSpeed: TEXT_SPEED_ORDER[speedIdx], animations } : undefined,
  };
}

function encodeTicker(m: TickerMsg): Uint8Array {
  const w = new Writer().u8(m.seat).u8(TICKER_KIND_ORDER.indexOf(m.kind ?? 'system'));
  writeGen3(w, m.text, 96);
  return w.toBytes();
}
function decodeTicker(bytes: Uint8Array): TickerMsg {
  const r = new Reader(bytes);
  const seat = r.u8();
  const kind = TICKER_KIND_ORDER[r.u8()];
  const text = r.gen3String();
  return { t: 'ticker', seat, kind: kind === 'system' ? undefined : kind, text };
}

function encodeResult(m: ResultMsg): Uint8Array {
  return new Writer().u8(m.seat).u8(OUTCOME_ORDER.indexOf(m.outcome)).toBytes();
}
function decodeResult(bytes: Uint8Array): ResultMsg {
  const r = new Reader(bytes);
  return { t: 'result', seat: r.u8(), outcome: OUTCOME_ORDER[r.u8()] };
}

type Codec = { type: number; encode: (m: Msg) => Uint8Array; decode: (bytes: Uint8Array) => Msg };

const CODECS: Record<string, Codec> = {
  place: { type: BR_MSG.PLACE, encode: (m) => encodePlace(m as PlaceMsg), decode: decodePlace },
  step: { type: BR_MSG.STEP, encode: (m) => encodeStep(m as StepMsg), decode: decodeStep },
  face: { type: BR_MSG.FACE, encode: (m) => encodeFace(m as FaceMsg), decode: decodeFace },
  challenge: { type: BR_MSG.CHALLENGE, encode: (m) => encodeChallenge(m as ChallengeMsg), decode: decodeChallenge },
  bt: { type: BR_MSG.BT, encode: (m) => encodeBlock(m as BlockMsg), decode: decodeBlock },
  bstart: { type: BR_MSG.BSTART, encode: (m) => encodeBstart(m as BstartMsg), decode: decodeBstart },
  turn: { type: BR_MSG.TURN, encode: (m) => encodeTurn(m as TurnMsg), decode: decodeTurn },
  follow: { type: BR_MSG.FOLLOW, encode: (m) => encodeFollow(m as FollowMsg), decode: decodeFollow },
  peek: { type: BR_MSG.PEEK, encode: (m) => encodePeek(m as PeekMsg), decode: decodePeek },
  party: { type: BR_MSG.PARTY, encode: (m) => encodeParty(m as PartyMsg), decode: decodeParty },
  faint: { type: BR_MSG.FAINT, encode: (m) => encodeFaint(m as FaintMsg), decode: decodeFaint },
  out: { type: BR_MSG.OUT, encode: (m) => encodeOut(m as OutMsg), decode: decodeOut },
  busy: { type: BR_MSG.BUSY, encode: (m) => encodeBusy(m as BusyMsg), decode: decodeBusy },
  pickup: { type: BR_MSG.PICKUP, encode: (m) => encodePickup(m as PickupMsg), decode: decodePickup },
  spill: { type: BR_MSG.SPILL, encode: (m) => encodeSpill(m as SpillMsg), decode: decodeSpill },
  ring: { type: BR_MSG.RING, encode: (m) => encodeRing(m as RingMsg), decode: decodeRing },
  clock: { type: BR_MSG.CLOCK, encode: (m) => encodeClock(m as ClockMsg), decode: decodeClock },
  start: { type: BR_MSG.START, encode: (m) => encodeStart(m as StartMsg), decode: decodeStart },
  ticker: { type: BR_MSG.TICKER, encode: (m) => encodeTicker(m as TickerMsg), decode: decodeTicker },
  result: { type: BR_MSG.RESULT, encode: (m) => encodeResult(m as ResultMsg), decode: decodeResult },
};

const CODEC_BY_TYPE = new Map<number, Codec & { t: string }>(
  Object.entries(CODECS).map(([t, c]) => [c.type, { ...c, t }]),
);

/** True for a `Msg.t` that has a binary counterpart and crosses into the ROM. */
export function crossesToRom(t: string): boolean {
  return t in CODECS;
}

// ---- slot framing (the continuation scheme) --------------------------------

const FIRST_HDR = 3; // totalLen: u16, seq: u8
const CONT_HDR = 1; // seq: u8
const FIRST_CHUNK_MAX = MAILBOX.PAYLOAD_MAX - FIRST_HDR; // 59
const CONT_CHUNK_MAX = MAILBOX.PAYLOAD_MAX - CONT_HDR; // 61

function frameToSlots(type: number, bytes: Uint8Array): BinarySlot[] {
  if (bytes.length > 0xffff) throw new SlotError(`message too large: ${bytes.length} bytes`);
  const slots: BinarySlot[] = [];
  const firstChunk = bytes.subarray(0, FIRST_CHUNK_MAX);
  const first = new Writer().u16(bytes.length).u8(0).raw(firstChunk).toBytes();
  slots.push({ type, payload: first });
  let offset = firstChunk.length;
  let seq = 1;
  while (offset < bytes.length) {
    const chunk = bytes.subarray(offset, offset + CONT_CHUNK_MAX);
    const payload = new Writer().u8(seq & 0xff).raw(chunk).toBytes();
    slots.push({ type: type | BR_CONT_FLAG, payload });
    offset += chunk.length;
    seq++;
  }
  return slots;
}

/** Packs a `Msg` into the mailbox ring slots it takes to send it: one call, any
 *  number of slots (1 for everything but a party or a wide spill/block/start). */
export function packSlot(msg: Msg): BinarySlot[] {
  const codec = CODECS[msg.t];
  if (!codec) throw new SlotError(`'${msg.t}' does not cross into the ROM mailbox`);
  return frameToSlots(codec.type, codec.encode(msg));
}

/** Strips the continuation framing off an ordered run of raw ring slots (the first
 *  slot's type with no BR_CONT_FLAG bit, followed by zero or more continuations of
 *  `type | BR_CONT_FLAG` with seq 1, 2, 3, ...) and returns the base type and the
 *  reassembled message bytes, ready for `unpackSlot`. Throws on a seq gap/duplicate
 *  or a totalLen that the collected bytes do not match -- a dropped mailbox slot
 *  must never silently reassemble into a different message. */
export function reassembleSlots(slots: BinarySlot[]): BinarySlot {
  if (slots.length === 0) throw new SlotError('no slots to reassemble');
  const first = slots[0];
  if ((first.type & BR_CONT_FLAG) !== 0) throw new SlotError('first slot is a continuation');
  const baseType = first.type;
  const r0 = new Reader(first.payload);
  const totalLen = r0.u16();
  const seq0 = r0.u8();
  if (seq0 !== 0) throw new SlotError(`first slot seq ${seq0}, expected 0`);
  const out = new Uint8Array(totalLen);
  const firstChunk = r0.raw(Math.min(FIRST_CHUNK_MAX, totalLen));
  out.set(firstChunk, 0);
  let offset = firstChunk.length;
  let expectedSeq = 1;
  for (let i = 1; i < slots.length; i++) {
    const slot = slots[i];
    if ((slot.type & ~BR_CONT_FLAG) !== baseType || (slot.type & BR_CONT_FLAG) === 0) {
      throw new SlotError(`slot ${i} is not a continuation of type ${baseType}`);
    }
    const r = new Reader(slot.payload);
    const seq = r.u8();
    if (seq !== (expectedSeq & 0xff)) throw new SlotError(`continuation seq ${seq}, expected ${expectedSeq & 0xff}`);
    const remaining = totalLen - offset;
    const chunk = r.raw(Math.min(CONT_CHUNK_MAX, Math.max(0, remaining)));
    out.set(chunk, offset);
    offset += chunk.length;
    expectedSeq++;
  }
  if (offset !== totalLen) throw new SlotError(`reassembled ${offset} bytes, expected ${totalLen}`);
  return { type: baseType, payload: out };
}

/** Decodes one fully-reassembled (type, payload) pair -- see `reassembleSlots` --
 *  back into a `Msg`. `type` must not carry BR_CONT_FLAG. */
export function unpackSlot(type: number, payload: Uint8Array): Msg {
  if (type & BR_CONT_FLAG) throw new SlotError(`type 0x${type.toString(16)} carries the continuation flag`);
  const codec = CODEC_BY_TYPE.get(type);
  if (!codec) throw new SlotError(`unknown mailbox message type ${type}`);
  return codec.decode(payload);
}

export { MON_BYTES, MAP_REF_BYTES };
