import { describe, expect, it } from 'vitest';
import { Bridge, type EmulatorLike } from './bridge';
import { MAILBOX, type RamAccess } from './mailbox';
import { BR_CONT_FLAG, packSlot, reassembleSlots, unpackSlot, type BinarySlot } from './slots';
import { PROTOCOL, type Msg } from './wire';
import { RelayClient, type WebSocketLike } from './relay';

const BASE = 0x0203d178; // gBrMailbox, per br-symbols.json

// ---- a fake WebSocket, so RelayClient needs no network (mirrors relay.test.ts) ----

class FakeSocket implements WebSocketLike {
  readyState = 1; // OPEN from the start -- these tests drive the bridge, not reconnect
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: Record<string, unknown>[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  receive(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function fakeRelay(): { relay: RelayClient; socket: FakeSocket } {
  let socket!: FakeSocket;
  const relay = new RelayClient((url) => {
    socket = new FakeSocket();
    return socket;
  });
  relay.connect('ws://relay.test');
  return { relay, socket };
}

// ---- a fake emulator: RamAccess over a plain Uint8Array, plus a manual frame() ----

function fakeEmulator(base: number) {
  const mem = new Uint8Array(0x40000);
  const at = (addr: number) => addr - 0x02000000;
  const ram: RamAccess = {
    read: (addr, width) => {
      let v = 0;
      for (let i = width / 8 - 1; i >= 0; i--) v = (v << 8) | mem[at(addr) + i];
      return v >>> 0;
    },
    write: (addr, value, width) => {
      for (let i = 0; i < width / 8; i++) mem[at(addr) + i] = (value >>> (8 * i)) & 0xff;
    },
    bytes: (addr, len) => mem.subarray(at(addr), at(addr) + len),
  };
  let listeners: (() => void)[] = [];
  const emu: EmulatorLike = {
    ...ram,
    onFrame(l: () => void) {
      listeners.push(l);
      return () => {
        listeners = listeners.filter((x) => x !== l);
      };
    },
  };

  const romInit = () => {
    ram.write(base + MAILBOX.OFF_PROTOCOL, PROTOCOL, 16);
    ram.write(base + MAILBOX.OFF_PATCH, 1, 16);
    ram.write(base + MAILBOX.OFF_SIZE, MAILBOX.SIZE, 16);
    ram.write(base + MAILBOX.OFF_MAGIC, MAILBOX.MAGIC, 16);
  };

  // As if the ROM's own BrNet had produced this message into the out-ring.
  const romEmit = (msg: Msg): void => {
    for (const slot of packSlot(msg)) {
      const head = ram.read(base + MAILBOX.OFF_OUT_HEAD, 16);
      const tail = ram.read(base + MAILBOX.OFF_OUT_TAIL, 16);
      if (((head - tail) & 0xffff) >= MAILBOX.RING_SLOTS) throw new Error('out ring full in test setup');
      const addr = base + MAILBOX.OFF_OUT + (head % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      ram.write(addr, slot.type, 8);
      ram.write(addr + 1, slot.payload.length, 8);
      ram.bytes(addr + 2, slot.payload.length).set(slot.payload);
      ram.write(base + MAILBOX.OFF_OUT_HEAD, (head + 1) & 0xffff, 16);
    }
  };

  // As if the ROM had drained up to `budget` slots off the in-ring.
  const romDrainIn = (budget = MAILBOX.RING_SLOTS): BinarySlot[] => {
    const out: BinarySlot[] = [];
    let tail = ram.read(base + MAILBOX.OFF_IN_TAIL, 16);
    const head = ram.read(base + MAILBOX.OFF_IN_HEAD, 16);
    while (tail !== head && budget-- > 0) {
      const addr = base + MAILBOX.OFF_IN + (tail % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      const type = ram.read(addr, 8);
      const len = ram.read(addr + 1, 8);
      out.push({ type, payload: ram.bytes(addr + 2, len).slice() });
      tail = (tail + 1) & 0xffff;
      ram.write(base + MAILBOX.OFF_IN_TAIL, tail, 16);
    }
    return out;
  };

  const frame = () => {
    for (const l of listeners.slice()) l();
  };

  return { emu, frame, romInit, romEmit, romDrainIn, ram };
}

function decodeReassembled(slots: BinarySlot[]): Msg {
  const r = reassembleSlots(slots);
  return unpackSlot(r.type, r.payload);
}

describe('Bridge', () => {
  it('forwards a place from the ROM to the relay as all(), stamped with our seat', () => {
    const { emu, frame, romInit, romEmit } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    // slots.ts's encodePlace/decodePlace round-trip `sprite` as a placeholder id (the
    // encoded string's own length, per its own comment) rather than the name itself,
    // so a 7-letter skin key comes back as "7" -- not a bridge bug, a documented gap
    // in the wire's sprite encoding.
    romEmit({ t: 'place', v: PROTOCOL, seat: 0, f: 1, st: 'alive', sprite: 'brendan' });
    frame();

    expect(socket.sent).toEqual([
      { type: 'all', m: { t: 'place', v: PROTOCOL, seat: 2, f: 1, st: 'alive', sprite: '7' } },
    ]);
    expect(bridge.stats.out).toBe(1);
  });

  it("leaves a report about somebody else's seat alone (POK-237)", () => {
    const { emu, frame, romInit, romEmit } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    // We fought bot 31. What it has left and what it spent are reported under ITS
    // seat: stamping ours on them threw both away, and the bot walked off whole.
    romEmit({ t: 'spent', seat: 31, items: [13] });
    frame();

    expect(socket.sent).toEqual([{ type: 'all', m: { t: 'spent', seat: 31, items: [13] } }]);
  });

  it('lands a step from the relay in the ROM in-ring as the right bytes', () => {
    const { emu, frame, romInit, romDrainIn } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    const stepMsg: Msg = { t: 'step', seat: 5, d: 2, x: 7, y: 8, map: { group: 0, num: 3 } };
    socket.receive({ type: 'recv', from: 5, m: stepMsg });
    frame(); // the queue set up by 'recv' is flushed into the mailbox on the next frame

    const decoded = decodeReassembled(romDrainIn());
    expect(decoded).toEqual(stepMsg);
  });

  it('drops our own echo without touching the roster or the ROM ring', () => {
    const { emu, frame, romInit, romDrainIn } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    socket.receive({ type: 'recv', from: 2, m: { t: 'step', seat: 2, d: 1, x: 1, y: 1, map: { group: 0, num: 1 } } });
    frame();

    expect(romDrainIn()).toEqual([]);
    expect(bridge.stats.in).toBe(0);
    expect(bridge.roster.get(2)).toBeUndefined();
  });

  it('queues a push while the ROM ring is full and drains it once room frees up', () => {
    const { emu, frame, romInit, romDrainIn, ram } = fakeEmulator(BASE);
    romInit();
    // Saturate the in-ring exactly the way a real full ring looks: head - tail == RING_SLOTS.
    ram.write(BASE + MAILBOX.OFF_IN_HEAD, MAILBOX.RING_SLOTS, 16);
    ram.write(BASE + MAILBOX.OFF_IN_TAIL, 0, 16);

    const { relay, socket } = fakeRelay();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    const outMsg: Msg = { t: 'out', seat: 9 };
    socket.receive({ type: 'recv', from: 9, m: outMsg });
    frame(); // ring is full: the slot stays queued, nothing pushed

    expect(bridge.stats.pending).toBe(MAILBOX.RING_SLOTS);
    expect(bridge.stats.in).toBe(0);

    // The ROM drains its whole backlog (a real Task_BrNet would do this a little at
    // a time; draining it all at once here just frees the ring for the next frame).
    ram.write(BASE + MAILBOX.OFF_IN_TAIL, MAILBOX.RING_SLOTS, 16);
    frame();

    expect(bridge.stats.in).toBe(1);
    const decoded = decodeReassembled(romDrainIn());
    expect(decoded).toEqual(outMsg);
  });

  it('broadcasts a challenge, then remembers that seat for bt', () => {
    const { emu, frame, romInit, romEmit } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    romEmit({ t: 'challenge', seat: 0, opponent: 7, nonce: 42 });
    frame();
    // Broadcast, not addressed: a bot is not a member of the room, so `to` its seat
    // reached nobody and the host walking it never heard the challenge (POK-238).
    expect(socket.sent[0]).toEqual({ type: 'all', m: { t: 'challenge', seat: 2, opponent: 7, nonce: 42 } });

    romEmit({ t: 'bt', seat: 0, seq: 1, data: [9, 9] });
    frame();
    expect(socket.sent[1]).toEqual({ type: 'to', id: 7, m: { t: 'bt', seat: 2, seq: 1, data: [9, 9] } });
  });

  it('updates the roster from both directions and from the relay roster event', () => {
    const { emu, frame, romInit, romEmit } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    socket.receive({ type: 'roster', code: 'ABC123', host: 2, open: true, max: 8, pass: false, members: [{ id: 2, name: 'ASH' }, { id: 7, name: 'MAY' }] });
    expect(bridge.roster.get(2)?.isMe).toBe(true);
    expect(bridge.roster.get(7)?.name).toBe('MAY');

    romEmit({ t: 'place', v: PROTOCOL, seat: 0, map: { group: 0, num: 9 }, x: 5, y: 8, f: 1, st: 'alive' });
    frame();
    expect(bridge.roster.get(2)).toMatchObject({ map: { group: 0, num: 9 }, x: 5, y: 8 });

    socket.receive({ type: 'recv', from: 7, m: { t: 'step', seat: 7, d: 4, x: 1, y: 1, map: { group: 0, num: 9 } } });
    expect(bridge.roster.get(7)).toMatchObject({ x: 1, y: 1, dir: 4 });
  });
});


// POK-274. Kanto sends a player's own battle text with the challenge itself, so "each
// side holds the other's before the locks". Ours picked three lines nobody else could
// see: the `lines` field was in the wire schema, had a decoder, and was put on a
// challenge by nobody.
describe("the battle lines you picked (POK-274)", () => {
  it('rides out on our own challenge', () => {
    const { relay, socket } = fakeRelay();
    const { emu, romEmit, frame, romInit } = fakeEmulator(BASE);
    romInit();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });
    bridge.myLines = { intro: 'FOUND YOU.', win: 'TOLD YOU.', lose: 'GOOD FIGHT.' };

    romEmit({ t: 'challenge', seat: 0, opponent: 5, nonce: 7 });
    frame();

    const sent = socket.sent.at(-1)!.m as Record<string, unknown>;
    expect(sent.t).toBe('challenge');
    expect(sent.lines).toEqual({ intro: 'FOUND YOU.', win: 'TOLD YOU.', lose: 'GOOD FIGHT.' });
  });

  it('is not stapled to everything else we send', () => {
    const { relay, socket } = fakeRelay();
    const { emu, romEmit, frame, romInit } = fakeEmulator(BASE);
    romInit();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });
    bridge.myLines = { intro: 'FOUND YOU.' };

    romEmit({ t: 'place', v: PROTOCOL, seat: 0, f: 1, st: 'alive', sprite: 'brendan' });
    frame();

    expect((socket.sent.at(-1)!.m as Record<string, unknown>).lines).toBeUndefined();
  });

  it('remembers what somebody else said, and never mistakes it for our own', () => {
    const { relay, socket } = fakeRelay();
    const { emu, romInit } = fakeEmulator(BASE);
    romInit();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    socket.receive({
      type: 'recv',
      from: 5,
      m: { t: 'challenge', v: PROTOCOL, seat: 5, opponent: 9, nonce: 1, lines: { win: 'NEXT!' } },
    });

    expect(bridge.linesFor(5)).toEqual({ win: 'NEXT!' });
    // A challenge that is about two other people still counts: the whole room hears
    // every duel announced, not only its own.
    expect(bridge.linesFor(9)).toBeUndefined();
    expect(bridge.linesFor(2)).toBeUndefined();
  });

  it('says nothing about a seat that has never challenged anybody', () => {
    const { relay } = fakeRelay();
    const { emu, romInit } = fakeEmulator(BASE);
    romInit();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });
    // A bot never sends one, which is why its lines stay the seed's.
    expect(bridge.linesFor(30)).toBeUndefined();
  });
});

/** Every message the ROM has been handed, one per base slot and its continuations. */
function drainMsgs(romDrainIn: () => BinarySlot[]): Msg[] {
  const slots = romDrainIn();
  const out: Msg[] = [];
  for (let i = 0; i < slots.length; ) {
    const group = [slots[i++]];
    while (i < slots.length && (slots[i].type & BR_CONT_FLAG) !== 0) group.push(slots[i++]);
    out.push(decodeReassembled(group));
  }
  return out;
}

/** A room we have joined as seat 2, with seat 1 its host and 7 and 9 in it too. */
function joined() {
  const gba = fakeEmulator(BASE);
  gba.romInit();
  const { relay, socket } = fakeRelay();
  socket.receive({ type: 'room_joined', code: 'ABC123', id: 2, host: 1, token: 't' });
  const bridge = new Bridge({ emu: gba.emu, mailboxBase: BASE, relay, seat: 2 });
  socket.receive({
    type: 'roster', code: 'ABC123', host: 1, open: true, max: 8, pass: false,
    members: [{ id: 1, name: 'HOST' }, { id: 2, name: 'ME' }, { id: 7, name: 'MAY' }, { id: 9, name: 'WALLY' }],
  });
  const heard: [Msg, number][] = [];
  bridge.onMessage((m, from) => void heard.push([m, from]));
  return { ...gba, relay, socket, bridge, heard };
}

// POK-330 #24. The relay stamps every `recv` with who sent it, and nothing read it: any
// member of a quick-play room could wipe every team with one `duel`, fill every bag with
// a `give`, or end the match with an `again`.
describe('who may say what (POK-330 #24)', () => {
  it('never hands the ROM a duel, a give or a follow off the relay', () => {
    const { socket, frame, romDrainIn, bridge, heard } = joined();
    const mon = { species: 1, level: 5, hp: 20, maxHp: 20, status: 0, moves: [], heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'ZIG', ot: 'MAY' };
    // Not even from the host: these are a page's word to its own ROM.
    socket.receive({ type: 'recv', from: 1, m: { t: 'duel', seatA: 30, seatB: 31, a: [mon], b: [mon] } });
    socket.receive({ type: 'recv', from: 7, m: { t: 'give', items: [{ id: 1, n: 99 }] } });
    socket.receive({ type: 'recv', from: 7, m: { t: 'follow', seat: 7 } });
    frame();
    expect(drainMsgs(romDrainIn)).toEqual([]);
    expect(heard).toEqual([]);
    expect(bridge.stats.refused).toBe(3);
  });

  it("takes the room's word only from the room's host", () => {
    const { socket, frame, romDrainIn, bridge, heard } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'again', seat: 7 } });
    socket.receive({ type: 'recv', from: 7, m: { t: 'win', seat: 7 } });
    socket.receive({ type: 'recv', from: 7, m: { t: 'clock', seat: 1, left: 1 } });
    frame();
    expect(heard).toEqual([]);
    expect(drainMsgs(romDrainIn)).toEqual([]);
    expect(bridge.stats.refused).toBe(3);

    socket.receive({ type: 'recv', from: 1, m: { t: 'again', seat: 1 } });
    socket.receive({ type: 'recv', from: 1, m: { t: 'clock', seat: 1, left: 90 } });
    frame();
    expect(heard).toEqual([[{ t: 'again', seat: 1 }, 1], [{ t: 'clock', seat: 1, left: 90 }, 1]]);
    expect(drainMsgs(romDrainIn)).toEqual([{ t: 'clock', seat: 1, left: 90 }]);
  });

  it('takes the host at its word when the relay moves it', () => {
    const { socket, heard } = joined();
    socket.receive({
      type: 'roster', code: 'ABC123', host: 7, open: true, max: 8, pass: false,
      members: [{ id: 2, name: 'ME' }, { id: 7, name: 'MAY' }],
    });
    socket.receive({ type: 'recv', from: 1, m: { t: 'win', seat: 1 } }); // the old host, too late
    socket.receive({ type: 'recv', from: 7, m: { t: 'win', seat: 7 } });
    expect(heard).toEqual([[{ t: 'win', seat: 7 }, 7]]);
  });

  it('lets a seat speak for itself, and the host for anybody', () => {
    const { socket, heard, bridge } = joined();
    const step = (seat: number) => ({ t: 'step', seat, d: 1, x: 1, y: 1, map: { group: 0, num: 1 } });
    socket.receive({ type: 'recv', from: 9, m: step(7) }); // 9 walking 7 about
    socket.receive({ type: 'recv', from: 7, m: step(7) });
    socket.receive({ type: 'recv', from: 1, m: step(30) }); // the host walks its bots
    expect(heard.map(([m, from]) => [(m as { seat: number }).seat, from])).toEqual([[7, 7], [30, 1]]);
    expect(bridge.roster.get(7)?.x).toBe(1);
    expect(bridge.stats.refused).toBe(1);
  });

  it("takes a report on a bot's fight from whoever fought it, and on a person's from nobody else", () => {
    const { socket, heard } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'spent', seat: 30, items: [13] } }); // 30: a bot
    socket.receive({ type: 'recv', from: 7, m: { t: 'result', seat: 30, outcome: 'lose' } });
    socket.receive({ type: 'recv', from: 7, m: { t: 'result', seat: 9, outcome: 'lose' } }); // 9: a person
    expect(heard.map(([m]) => m)).toEqual([
      { t: 'spent', seat: 30, items: [13] },
      { t: 'result', seat: 30, outcome: 'lose' },
    ]);
  });

  it('decodes once, hands on who sent it, and lets go on dispose', () => {
    const { socket, bridge, heard } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'out', seat: 7 } });
    expect(heard).toEqual([[{ t: 'out', seat: 7 }, 7]]);
    bridge.dispose();
    socket.receive({ type: 'recv', from: 9, m: { t: 'out', seat: 9 } });
    expect(heard).toHaveLength(1);
  });
});
