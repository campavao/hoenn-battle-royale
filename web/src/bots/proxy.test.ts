import { describe, expect, it } from 'vitest';
import { ProxyDuels, type ProxyEmulator } from './proxy';
import { MAILBOX } from '../net/mailbox';
import { BR_CONT_FLAG, BR_MSG, packSlot } from '../net/slots';
import type { Msg, PackedMon } from '../net/wire';

const BASE = 0x0203d178; // gBrMailbox, per br-symbols.json

function mon(over: Partial<PackedMon> = {}): PackedMon {
  return {
    species: 277, level: 5, hp: 19, maxHp: 19, status: 0,
    moves: [{ id: 1, pp: 35, ppUps: 0 }],
    heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'TREECKO', ot: 'BR',
    ...over,
  };
}

/** A hidden instance, without a wasm core: RAM as an array, frames driven by hand, and
 *  a little of br_duel.c's behaviour -- it wakes its mailbox, reads a DUEL off the in
 *  ring, and after a few frames pushes a DRESULT back. */
function fakeInstance(opts: { wakes?: boolean; answers?: boolean; afterFrames?: number } = {}) {
  const { wakes = true, answers = true, afterFrames = 3 } = opts;
  const mem = new Uint8Array(0x40000);
  const at = (addr: number) => addr - 0x02000000;
  const read = (addr: number, width: 8 | 16 | 32 = 32) => {
    let v = 0;
    for (let i = width / 8 - 1; i >= 0; i--) v = (v << 8) | mem[at(addr) + i];
    return v >>> 0;
  };
  const write = (addr: number, value: number, width: 8 | 16 | 32 = 32) => {
    for (let i = 0; i < width / 8; i++) mem[at(addr) + i] = (value >>> (8 * i)) & 0xff;
  };
  const bytes = (addr: number, len: number) => mem.subarray(at(addr), at(addr) + len);

  let listeners: (() => void)[] = [];
  const taps: boolean[] = [];
  let held = false;
  let sawDuel = false;
  let duels = 0;
  let sinceDuel = 0;
  let stopped = false;
  let result: Msg | null = null;

  const emu: ProxyEmulator = {
    read, write, bytes,
    press: () => {
      if (!held) taps.push(true);
      held = true;
    },
    release: () => {
      held = false;
    },
    onFrame(listener) {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    },
    stop() {
      stopped = true;
    },
  };

  if (wakes) {
    write(BASE + MAILBOX.OFF_MAGIC, MAILBOX.MAGIC, 16);
    write(BASE + MAILBOX.OFF_SIZE, MAILBOX.SIZE, 16);
  }

  // The ROM's half of one frame: drain the in ring, and answer a DUEL a few frames on.
  const romFrame = () => {
    let tail = read(BASE + MAILBOX.OFF_IN_TAIL, 16);
    const head = read(BASE + MAILBOX.OFF_IN_HEAD, 16);
    while (tail !== head) {
      const slot = BASE + MAILBOX.OFF_IN + (tail % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      if ((read(slot, 8) & ~BR_CONT_FLAG) === BR_MSG.DUEL) {
        if (!sawDuel) duels++;
        sawDuel = true;
      }
      tail = (tail + 1) & 0xffff;
    }
    write(BASE + MAILBOX.OFF_IN_TAIL, tail, 16);
    if (!sawDuel || !answers) return;
    if (++sinceDuel !== afterFrames) return;
    // One answer per DUEL: the next one starts its own count, the way the instance
    // starts its next battle.
    sawDuel = false;
    sinceDuel = 0;
    for (const slot of packSlot(result ?? { t: 'dresult', seatA: 4, seatB: 7, winner: 1, a: [{ hp: 0, status: 0 }], b: [{ hp: 9, status: 0 }] })) {
      const outHead = read(BASE + MAILBOX.OFF_OUT_HEAD, 16);
      const addr = BASE + MAILBOX.OFF_OUT + (outHead % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      write(addr, slot.type, 8);
      write(addr + 1, slot.payload.length, 8);
      bytes(addr + MAILBOX.SLOT_HDR, slot.payload.length).set(slot.payload);
      write(BASE + MAILBOX.OFF_OUT_HEAD, (outHead + 1) & 0xffff, 16);
    }
  };

  return {
    emu,
    taps,
    get stopped() {
      return stopped;
    },
    get duels() {
      return duels;
    },
    answerWith(msg: Msg) {
      result = msg;
    },
    /** One emulated frame: the ROM runs, then the page's listeners do. */
    frame(n = 1) {
      for (let i = 0; i < n; i++) {
        romFrame();
        for (const l of listeners.slice()) l();
      }
    },
  };
}

function proxyOver(inst: ReturnType<typeof fakeInstance>, notes: string[] = [], deadlineMs = 50) {
  return new ProxyDuels({
    boot: async () => inst.emu,
    mailboxBase: BASE,
    writeBoot: () => {},
    deadlineMs,
    wakeFrames: 5,
    onNote: (w) => void notes.push(w),
  });
}

/** Runs frames until `p` settles, so a test never hangs on a promise the fake forgot
 *  to answer. */
async function settle<T>(p: Promise<T>, inst: ReturnType<typeof fakeInstance>, frames = 200): Promise<T> {
  let done = false;
  const wrapped = p.finally(() => {
    done = true;
  });
  for (let i = 0; i < frames && !done; i++) {
    inst.frame();
    // A real timer tick, not a microtask: the deadline is wall-clock, so a loop that
    // never lets time pass would never reach it.
    await new Promise((r) => setTimeout(r, 0));
  }
  return wrapped;
}

describe('the proxy duel instance', () => {
  it('hands both parties over and reads the winner back', async () => {
    const inst = fakeInstance();
    inst.answerWith({
      t: 'dresult', seatA: 4, seatB: 7, winner: 1,
      a: [{ hp: 0, status: 0 }],
      b: [{ hp: 11, status: 0 }],
    });
    const proxy = proxyOver(inst);
    const out = await settle(proxy.fight({ seat: 4, party: [mon()] }, { seat: 7, party: [mon({ species: 283 })] }), inst);

    expect(inst.duels).toBe(1);
    expect(out).toEqual({
      winner: 7,
      loser: 4,
      a: [{ hp: 0, status: 0 }],
      b: [{ hp: 11, status: 0 }],
      usedA: [],
      usedB: [],
    });
  });

  it('taps A rather than holding it, because a held button is one press', async () => {
    const inst = fakeInstance({ afterFrames: 40 });
    const proxy = proxyOver(inst, [], 5_000);
    await settle(proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] }), inst);
    // Several separate presses over those frames, not one long hold.
    expect(inst.taps.length).toBeGreaterThan(1);
  });

  it('gives up on a fight that will not end, and lets the instance go', async () => {
    const inst = fakeInstance({ answers: false });
    const notes: string[] = [];
    const proxy = proxyOver(inst, notes);
    const out = await settle(proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] }), inst, 400);

    expect(out).toBeNull();
    expect(notes).toContain('duel timed out');
    expect(inst.stopped).toBe(true);
  });

  it('falls back when the instance never wakes, and does not try again', async () => {
    const inst = fakeInstance({ wakes: false });
    const notes: string[] = [];
    const proxy = proxyOver(inst, notes);

    expect(await settle(proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] }), inst)).toBeNull();
    expect(proxy.failed).toBe(true);
    expect(notes.some((n) => n.includes('never woke'))).toBe(true);
    // A second caller is answered immediately, without booting anything.
    expect(await proxy.fight({ seat: 3, party: [mon()] }, { seat: 4, party: [mon()] })).toBeNull();
  });

  it('leaves a draw to the caller', async () => {
    const inst = fakeInstance();
    inst.answerWith({ t: 'dresult', seatA: 1, seatB: 2, winner: 2, a: [], b: [] });
    const proxy = proxyOver(inst);
    expect(await settle(proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] }), inst)).toBeNull();
  });

  it('sends the overflow to the cheap resolver rather than queue the whole room', async () => {
    const inst = fakeInstance({ answers: false });
    const notes: string[] = [];
    const proxy = proxyOver(inst, notes, 5_000);
    const running = proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] });
    // Two may wait; the fourth caller is told to settle it itself.
    const waiting = [proxy.fight({ seat: 3, party: [mon()] }, { seat: 4, party: [mon()] }), proxy.fight({ seat: 5, party: [mon()] }, { seat: 6, party: [mon()] })];
    const overflow = await settle(proxy.fight({ seat: 7, party: [mon()] }, { seat: 8, party: [mon()] }), inst, 5);

    expect(overflow).toBeNull();
    expect(notes).toContain('queue full: settling this one the cheap way');
    void running;
    void waiting;
  });

  it('fights one at a time, queueing the rest', async () => {
    const inst = fakeInstance({ afterFrames: 2 });
    const proxy = proxyOver(inst);
    const first = proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] });
    const second = proxy.fight({ seat: 3, party: [mon()] }, { seat: 4, party: [mon()] });
    const [a, b] = await settle(Promise.all([first, second]), inst, 400);

    // The fake answers under one pair of seats; what matters is that both callers are
    // served and neither is left hanging behind the other.
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });
});
