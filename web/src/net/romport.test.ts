import { describe, expect, it } from 'vitest';
import { MAILBOX, Mailbox, type RamAccess } from './mailbox';
import { POSITIONAL_CAP, RomPort } from './romport';
import { BR_CONT_FLAG, BR_MSG, packSlot, reassembleSlots, unpackSlot, type BinarySlot } from './slots';
import type { BlockMsg, Msg, SpillMsg, StepMsg } from './wire';

const BASE = 0x0203d178;

/** EWRAM over a flat buffer, and the ROM's side of both rings as br_mailbox.c and
 *  br_wire.c have it: BrNet_Tick drains 16 slots a frame, and each base type has one
 *  assembler that starts over on a first slot or any seq it did not expect. */
function fakeRom() {
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
  ram.write(BASE + MAILBOX.OFF_SIZE, MAILBOX.SIZE, 16);
  ram.write(BASE + MAILBOX.OFF_MAGIC, MAILBOX.MAGIC, 16);

  const asm = new Map<number, { total: number; got: number[]; next: number }>();
  const heard: Msg[] = [];
  /** BrNet_Tick: up to `budget` slots off the in-ring, through BrWire_Assemble. */
  const tick = (budget = 16): void => {
    let tail = ram.read(BASE + MAILBOX.OFF_IN_TAIL, 16);
    const head = ram.read(BASE + MAILBOX.OFF_IN_HEAD, 16);
    while (tail !== head && budget-- > 0) {
      const slot = BASE + MAILBOX.OFF_IN + (tail % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      const type = ram.read(slot, 8);
      const p = ram.bytes(slot + 2, ram.read(slot + 1, 8)).slice();
      const base = type & ~BR_CONT_FLAG;
      let a = asm.get(base);
      if ((type & BR_CONT_FLAG) === 0 && p[2] === 0) {
        a = { total: p[0] | (p[1] << 8), got: [...p.subarray(3)], next: 1 };
        asm.set(base, a);
      } else if ((type & BR_CONT_FLAG) !== 0 && a && p[0] === a.next) {
        a.next++;
        a.got.push(...p.subarray(1));
      } else {
        asm.delete(base); // a gap, a stray continuation, or another message: start over
        a = undefined;
      }
      if (a && a.got.length >= a.total) {
        heard.push(unpackSlot(base, Uint8Array.from(a.got.slice(0, a.total))));
        asm.delete(base);
      }
      tail = (tail + 1) & 0xffff;
      ram.write(BASE + MAILBOX.OFF_IN_TAIL, tail, 16);
    }
  };
  /** Stops the ROM draining: the ring reads as full until `unwedge`. */
  const wedge = (free = 0) => {
    const tail = ram.read(BASE + MAILBOX.OFF_IN_TAIL, 16);
    ram.write(BASE + MAILBOX.OFF_IN_HEAD, (tail + MAILBOX.RING_SLOTS - free) & 0xffff, 16);
  };
  const unwedge = () => ram.write(BASE + MAILBOX.OFF_IN_TAIL, ram.read(BASE + MAILBOX.OFF_IN_HEAD, 16), 16);
  /** As if the ROM had sent this (BrWire_SendLarge), into the out-ring. */
  const send = (slots: BinarySlot[]) => {
    for (const s of slots) {
      const head = ram.read(BASE + MAILBOX.OFF_OUT_HEAD, 16);
      const addr = BASE + MAILBOX.OFF_OUT + (head % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      ram.write(addr, s.type, 8);
      ram.write(addr + 1, s.payload.length, 8);
      ram.bytes(addr + 2, s.payload.length).set(s.payload);
      ram.write(BASE + MAILBOX.OFF_OUT_HEAD, (head + 1) & 0xffff, 16);
    }
  };
  return { mailbox: new Mailbox(ram, BASE), tick, heard, wedge, unwedge, send };
}

const MAP = { group: 0, num: 9 };
/** A message as the ROM reads it back: what survives the binary codec. */
const asRomReads = (m: Msg): Msg => {
  const whole = reassembleSlots(packSlot(m));
  return unpackSlot(whole.type, whole.payload);
};
const step = (seat: number, x: number): StepMsg => ({ t: 'step', seat, d: 4, x, y: 5, map: MAP });
/** A spill that packs to more than one slot. */
const spill = (seat: number): SpillMsg => ({
  t: 'spill',
  seat,
  map: MAP,
  mons: [1, 2, 3, 4, 5, 6].map((k) => ({ key: seat * 16 + k, x: k, y: 2, species: 252 + k, level: 5 })),
  bag: { key: seat * 16, x: 1, y: 1, items: [{ id: 13, n: 2 }, { id: 14, n: 1 }, { id: 17, n: 3 }], money: 500, name: 'MAY' },
});

describe('RomPort', () => {
  it('pushes a message whole or not at all, and nothing jumps the queue past it', () => {
    const rom = fakeRom();
    const port = new RomPort(rom.mailbox);
    expect(packSlot(spill(3)).length).toBeGreaterThan(1);
    rom.wedge(1); // room for one slot, and the spill needs two

    port.push(spill(3));
    port.push({ t: 'out', seat: 9 }); // one slot, and it would fit
    expect(port.flush()).toBe(0);
    expect(rom.mailbox.pending()).toBe(MAILBOX.RING_SLOTS - 1);
    expect(port.queued).toBe(2);

    rom.unwedge();
    expect(port.flush()).toBe(2);
    rom.tick(MAILBOX.RING_SLOTS);
    expect(rom.heard).toEqual([asRomReads(spill(3)), { t: 'out', seat: 9 }]);
  });

  it("never puts one writer's spill between another's slots, however full the ring runs", () => {
    // The host's director and the room both spill into one ROM. Each has a turn at the
    // port between frames, the ring runs full, and the ROM takes 16 slots a frame.
    const rom = fakeRom();
    const port = new RomPort(rom.mailbox);
    const sent: Msg[] = [];
    for (let frame = 0; frame < 20; frame++) {
      for (let i = 0; i < 20; i++) {
        const m = spill((frame * 20 + i) % 32);
        port.push(m);
        sent.push(m);
      }
      port.flush();
      rom.tick();
    }
    for (let frame = 0; frame < 100 && port.queued > 0; frame++) {
      port.flush();
      rom.tick();
    }
    rom.tick(MAILBOX.RING_SLOTS);

    expect(port.queued).toBe(0);
    expect(rom.heard).toEqual(sent.map(asRomReads));
  });

  it("lets a seat's queued movement go when a newer place says where it is", () => {
    const rom = fakeRom();
    const port = new RomPort(rom.mailbox);
    rom.wedge();

    port.push(step(3, 1));
    port.push({ t: 'face', seat: 3, f: 2, map: MAP });
    port.push(step(5, 1));
    port.push({ t: 'out', seat: 9 });
    const place: Msg = { t: 'place', v: 1, seat: 3, map: MAP, x: 4, y: 4, f: 1, st: 'alive' };
    port.push(place);

    rom.unwedge();
    port.flush();
    rom.tick();
    expect(rom.heard.map((m) => [m.t, 'seat' in m ? m.seat : null])).toEqual([
      ['step', 5],
      ['out', 9],
      ['place', 3],
    ]);
    expect(port.stats.coalesced).toBe(2);
  });

  it('comes back from a long wait to a capped backlog, every event, and where everybody ended up', () => {
    // A tab in the background: frames stop, the room does not.
    const rom = fakeRom();
    const port = new RomPort(rom.mailbox);
    rom.wedge();
    const events: Msg[] = [];
    port.push(step(7, 100)); // seat 7 took one step and then stood still
    for (let i = 0; i < 3000; i++) {
      port.push(step(i % 3, i));
      if (i % 500 === 250) {
        const e: Msg = { t: 'out', seat: 20 + events.length };
        port.push(e);
        events.push(e);
      }
    }
    const ring: Msg = { t: 'ring', seat: 0, phase: 2, sx: 1, sy: 1, r: 3 };
    port.push(ring);
    events.push(ring);

    expect(port.queued).toBe(POSITIONAL_CAP + events.length);
    expect(port.stats.capped).toBe(3001 - POSITIONAL_CAP);

    rom.unwedge();
    for (let frame = 0; frame < 10; frame++) {
      port.flush();
      rom.tick();
    }
    expect(port.queued).toBe(0);
    // Every event, in order, and nothing held them past a handful of frames.
    expect(rom.heard.filter((m) => m.t !== 'step')).toEqual(events);
    const steps = rom.heard.filter((m): m is StepMsg => m.t === 'step');
    expect(steps.length).toBe(POSITIONAL_CAP);
    // Each seat's last word survives -- the lone early step as much as the busy seats'.
    expect(steps.find((m) => m.seat === 7)?.x).toBe(100);
    for (const seat of [0, 1, 2]) {
      expect(steps.filter((m) => m.seat === seat).at(-1)?.x).toBe(2997 + seat);
    }
  });

  // A seat's map-entry `place` was always its oldest moot entry, so it went first, and
  // with it the skin: a ROM that had not drawn that seat drew it from a step as skin 0.
  it("keeps a seat's place past the cap, moved to the step that made it moot", () => {
    const rom = fakeRom();
    const port = new RomPort(rom.mailbox, 3);
    rom.wedge();
    const place: Msg = { t: 'place', v: 1, seat: 3, map: MAP, x: 4, y: 4, f: 1, st: 'alive', sprite: '7' };
    port.push(place);
    port.push(step(3, 5));
    port.push(step(5, 1));
    port.push(step(6, 1)); // over the cap
    expect(port.stats.capped).toBe(1);

    rom.unwedge();
    port.flush();
    rom.tick();
    expect(rom.heard).toEqual([
      asRomReads({ ...place, x: 5, y: 5, f: 4 } as Msg),
      asRomReads(step(5, 1)),
      asRomReads(step(6, 1)),
    ]);
  });

  // A face was never moot, so a seat turning on the spot left nothing to let go, and the
  // fallback dropped the oldest movement: another seat's only step.
  it("lets a face go for the face after it, not another seat's only step", () => {
    const rom = fakeRom();
    const port = new RomPort(rom.mailbox, 4);
    rom.wedge();
    port.push(step(2, 9));
    port.push(step(1, 1));
    port.push({ t: 'face', seat: 1, f: 1, map: MAP });
    port.push({ t: 'face', seat: 1, f: 2, map: MAP });
    port.push({ t: 'face', seat: 1, f: 3, map: MAP }); // over the cap

    rom.unwedge();
    port.flush();
    rom.tick();
    expect(rom.heard.map((m) => [m.t, 'seat' in m ? m.seat : null, m.t === 'face' ? m.f : null])).toEqual([
      ['step', 2, null],
      ['step', 1, null],
      ['face', 1, 2],
      ['face', 1, 3],
    ]);
  });

  // br_netlink.c's HandleBt copies a link block into gBlockRecvBuffer, and the battle takes
  // it from there at VBlank, once a frame. A second block read in the same BrNet_Tick lands
  // on the first before the battle has seen it. The page flushes at every frame's end, and a
  // busy battle frame runs the ROM's main loop over two: a block pushed at the end of the
  // lag frame was read with the one before it, that one was lost, and both sides of the link
  // waited on each other for good (spectate.spec's fight that stopped mid-turn).
  it('hands the ROM one link block a tick, the next only once it has read the last', () => {
    const rom = fakeRom();
    const port = new RomPort(rom.mailbox);
    const block = (seq: number): BlockMsg => ({ t: 'bt', seat: 2, seq, data: [1, 0, 4, 0, 0, 0, 0, 0, seq] });
    port.push(block(1));
    port.push(block(2));
    port.push({ t: 'out', seat: 9 }); // and what came after them waits its turn
    port.flush(); // a frame's end
    port.flush(); // a lag frame's end: the ROM's main loop has not run since

    const perTick: number[][] = [];
    for (let frame = 0; frame < 3; frame++) {
      const before = rom.heard.length;
      rom.tick();
      perTick.push(rom.heard.slice(before).flatMap((m) => (m.t === 'bt' ? [m.seq] : [])));
      port.flush();
    }
    expect(perTick).toEqual([[1], [2], []]);
    expect(rom.heard.map((m) => m.t)).toEqual(['bt', 'bt', 'out']);
  });

  it('refuses what the ROM cannot take, and leaves the queue alone', () => {
    const port = new RomPort(fakeRom().mailbox);
    expect(port.push({ t: 'win', seat: 1 } as Msg)).toBe(false); // JSON-only
    expect(port.push({ t: 'step', seat: 1 } as unknown as Msg)).toBe(false); // will not pack
    expect(port.queued).toBe(0);
  });

  it('drains whole messages off the out-ring, and counts what it cannot read', () => {
    const rom = fakeRom();
    const port = new RomPort(rom.mailbox);
    rom.send(packSlot(spill(4)));
    rom.send(packSlot({ t: 'out', seat: 4 }));
    rom.send([{ type: BR_MSG.ECHO, payload: Uint8Array.of(0, 0, 0) }]); // the wire-up test: no Msg
    rom.send([{ type: 0x7f, payload: Uint8Array.of(1, 0, 0, 9) }]); // no such message
    rom.send(packSlot({ t: 'faint', seat: 4, index: 0 }));

    const got: Msg[] = [];
    expect(port.drain((m) => got.push(m))).toBe(1);
    expect(got).toEqual([asRomReads(spill(4)), { t: 'out', seat: 4 }, { t: 'faint', seat: 4, index: 0 }]);
  });

  it('hands on the rest of a batch when the handler throws on one, then throws', () => {
    // poll() has already taken the batch off the ring: whatever is not handled now never is.
    const rom = fakeRom();
    const port = new RomPort(rom.mailbox);
    rom.send(packSlot({ t: 'out', seat: 4 }));
    rom.send(packSlot({ t: 'out', seat: 5 }));

    const got: number[] = [];
    expect(() =>
      port.drain((m) => {
        if (m.t === 'out') got.push(m.seat);
        throw new Error('page bug');
      }),
    ).toThrow('page bug');
    expect(got).toEqual([4, 5]);
  });
});
