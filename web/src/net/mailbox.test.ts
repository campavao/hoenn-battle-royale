import { describe, expect, it } from 'vitest';
import { MAILBOX, Mailbox, MailboxError, type RamAccess } from './mailbox';

const BASE = 0x0203cf6c;

// EWRAM-shaped fake: a flat buffer, bus-addressed, little-endian, plus the ROM's
// side of the protocol (BrMailbox_Init and BrNet_Tick) so both directions are covered.
function fakeRam() {
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
  const romInit = () => {
    ram.write(BASE + MAILBOX.OFF_PROTOCOL, 1, 16);
    ram.write(BASE + MAILBOX.OFF_PATCH, 1, 16);
    ram.write(BASE + MAILBOX.OFF_SIZE, MAILBOX.SIZE, 16);
    ram.write(BASE + MAILBOX.OFF_MAGIC, MAILBOX.MAGIC, 16);
  };
  // BrNet_Tick with only the ECHO handler: drains up to 16, echoes type 1.
  const romTick = () => {
    ram.write(BASE + MAILBOX.OFF_FRAME, ram.read(BASE + MAILBOX.OFF_FRAME, 32) + 1, 32);
    let budget = 16;
    let tail = ram.read(BASE + MAILBOX.OFF_IN_TAIL, 16);
    const head = ram.read(BASE + MAILBOX.OFF_IN_HEAD, 16);
    while (tail !== head && budget-- > 0) {
      const slot = BASE + MAILBOX.OFF_IN + (tail % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      if (ram.read(slot, 8) === 1) romPush(1, ram.bytes(slot + 2, ram.read(slot + 1, 8)).slice());
      tail = (tail + 1) & 0xffff;
      ram.write(BASE + MAILBOX.OFF_IN_TAIL, tail, 16);
    }
  };
  const romPush = (type: number, payload: Uint8Array) => {
    const head = ram.read(BASE + MAILBOX.OFF_OUT_HEAD, 16);
    const tail = ram.read(BASE + MAILBOX.OFF_OUT_TAIL, 16);
    if (((head - tail) & 0xffff) >= MAILBOX.RING_SLOTS) {
      ram.write(BASE + MAILBOX.OFF_DROPPED, ram.read(BASE + MAILBOX.OFF_DROPPED, 32) + 1, 32);
      return;
    }
    const slot = BASE + MAILBOX.OFF_OUT + (head % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
    ram.write(slot, type, 8);
    ram.write(slot + 1, payload.length, 8);
    ram.bytes(slot + 2, payload.length).set(payload);
    ram.write(BASE + MAILBOX.OFF_OUT_HEAD, (head + 1) & 0xffff, 16);
  };
  return { ram, mem, romInit, romTick, romPush };
}

describe('Mailbox layout', () => {
  it('matches include/br/br_mailbox.h', () => {
    expect(MAILBOX.OFF_OUT).toBe(0x18);
    expect(MAILBOX.OFF_IN).toBe(MAILBOX.OFF_OUT + MAILBOX.RING_SLOTS * MAILBOX.SLOT_BYTES);
    expect(MAILBOX.SIZE).toBe(MAILBOX.OFF_IN + MAILBOX.RING_SLOTS * MAILBOX.SLOT_BYTES);
    expect(MAILBOX.PAYLOAD_MAX).toBe(MAILBOX.SLOT_BYTES - MAILBOX.SLOT_HDR);
  });
});

describe('Mailbox', () => {
  it('is asleep until the ROM initialises, then compatible', () => {
    const { ram, romInit } = fakeRam();
    const mb = new Mailbox(ram, BASE);
    expect(mb.isAwake()).toBe(false);
    expect(() => mb.assertCompatible(1)).toThrow(MailboxError);
    romInit();
    expect(mb.isAwake()).toBe(true);
    mb.assertCompatible(1);
    expect(() => mb.assertCompatible(2)).toThrow(/protocol 1/);
    expect(mb.header()).toMatchObject({ patch: 1, size: MAILBOX.SIZE, frame: 0, dropped: 0 });
  });

  it('round-trips an echo through the ROM tick', () => {
    const { ram, romInit, romTick } = fakeRam();
    romInit();
    const mb = new Mailbox(ram, BASE);
    expect(mb.push(1, [0xde, 0xad, 0xbe, 0xef])).toBe(true);
    expect(mb.pending()).toBe(1);
    expect(mb.poll()).toEqual([]);
    romTick();
    expect(mb.pending()).toBe(0);
    const got = mb.poll();
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe(1);
    expect([...got[0].payload]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(mb.poll()).toEqual([]);
    expect(mb.header().frame).toBe(1);
  });

  it('keeps payload copies after the slot is reused', () => {
    const { ram, romInit, romPush } = fakeRam();
    romInit();
    const mb = new Mailbox(ram, BASE);
    romPush(7, new Uint8Array([1, 2, 3]));
    const [m] = mb.poll();
    for (let i = 0; i < MAILBOX.RING_SLOTS; i++) romPush(9, new Uint8Array([0xff]));
    expect([...m.payload]).toEqual([1, 2, 3]);
  });

  it('refuses to overfill the ROM ring and counts the drop', () => {
    const { ram, romInit, romTick } = fakeRam();
    romInit();
    const mb = new Mailbox(ram, BASE);
    for (let i = 0; i < MAILBOX.RING_SLOTS; i++) expect(mb.push(1, [i])).toBe(true);
    expect(mb.push(1, [0])).toBe(false);
    expect(mb.droppedOut).toBe(1);
    romTick(); // drains 16
    expect(mb.pending()).toBe(MAILBOX.RING_SLOTS - 16);
    expect(mb.push(1, [0])).toBe(true);
    expect(() => mb.push(1, new Uint8Array(63))).toThrow(MailboxError);
  });

  it('survives the u16 index wrap', () => {
    const { ram, romInit, romTick } = fakeRam();
    romInit();
    // Pretend 65,530 messages already went through each ring.
    ram.write(BASE + MAILBOX.OFF_IN_HEAD, 0xfffa, 16);
    ram.write(BASE + MAILBOX.OFF_IN_TAIL, 0xfffa, 16);
    ram.write(BASE + MAILBOX.OFF_OUT_HEAD, 0xfffa, 16);
    ram.write(BASE + MAILBOX.OFF_OUT_TAIL, 0xfffa, 16);
    const mb = new Mailbox(ram, BASE);
    for (let i = 0; i < 10; i++) mb.push(1, [i]);
    romTick();
    const got = mb.poll();
    expect(got.map((m) => m.payload[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ram.read(BASE + MAILBOX.OFF_OUT_TAIL, 16)).toBe(4);
    expect(mb.pending()).toBe(0);
  });
});
