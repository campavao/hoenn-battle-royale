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
 *  ring, and after a few frames pushes a DRESULT back.
 *
 *  With `bootFrames` it boots like the ROM: the mailbox wakes `wakeAfter` frames in,
 *  clearing the whole mailbox as BrMailbox_Init does (a boot block written before then
 *  is gone); a boot block is taken `bootFrames` frames after it lands; a DUEL that
 *  arrived before the boot is wiped by it, as NewGameInitData wipes the parties; and
 *  nothing is fought until a boot has been taken -- there is no field before one. */
function fakeInstance(opts: { wakes?: boolean; answers?: boolean; afterFrames?: number; bootFrames?: number; wakeAfter?: number } = {}) {
  const { wakes = true, afterFrames = 3, bootFrames, wakeAfter = 0 } = opts;
  const boots = bootFrames !== undefined;
  let answering = opts.answers ?? true;
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
  let booting = 0;
  let wiped = 0;
  let booted = 0;
  let frame = 0;
  /** pause / resume / reboot, in order: the instance's lifecycle as the proxy drives it. */
  const life: string[] = [];

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
    pause() {
      life.push('pause');
    },
    resume() {
      life.push('resume');
    },
  };

  const wake = () => {
    bytes(BASE, MAILBOX.OFF_BOOT + MAILBOX.BOOT_BYTES).fill(0);
    write(BASE + MAILBOX.OFF_MAGIC, MAILBOX.MAGIC, 16);
    write(BASE + MAILBOX.OFF_SIZE, MAILBOX.SIZE, 16);
  };
  if (wakes && wakeAfter === 0) wake();

  // The ROM's half of one frame: wake, take a boot block, drain the in ring, and answer
  // a DUEL a few frames on.
  const romFrame = () => {
    if (wakes && wakeAfter > 0 && ++frame === wakeAfter) wake();
    if (boots && read(BASE + MAILBOX.OFF_MAGIC, 16) === MAILBOX.MAGIC && read(BASE + MAILBOX.OFF_BOOT, 8) !== 0 && ++booting >= bootFrames) {
      write(BASE + MAILBOX.OFF_BOOT, 0, 8);
      booting = 0;
      booted++;
      if (sawDuel) wiped++;
      sawDuel = false;
      sinceDuel = 0;
    }
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
    // A duel waits for the field (BrDuel_Tick), and there is no field before a boot.
    if (boots && (booted === 0 || read(BASE + MAILBOX.OFF_BOOT, 8) !== 0)) return;
    if (!sawDuel || !answering) return;
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
    life,
    /** A power cycle in place: whatever the ROM was doing is gone, and it wakes again. */
    reboot() {
      life.push('reboot');
      sawDuel = false;
      sinceDuel = 0;
      mem.fill(0);
      if (wakes) {
        write(BASE + MAILBOX.OFF_MAGIC, MAILBOX.MAGIC, 16);
        write(BASE + MAILBOX.OFF_SIZE, MAILBOX.SIZE, 16);
      }
    },
    set answers(on: boolean) {
      answering = on;
    },
    get stopped() {
      return stopped;
    },
    get duels() {
      return duels;
    },
    /** DUELs the boot wiped: handed over before the ROM had taken its boot block. */
    get wiped() {
      return wiped;
    },
    /** Boot blocks the ROM took. */
    get booted() {
      return booted;
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
    expect(notes.some((n) => n.startsWith('duel timed out: seat 1 vs seat 2'))).toBe(true);
    expect(inst.stopped).toBe(true);
  });

  it('counts what it fought, what fell back and the frames it ran (POK-247)', async () => {
    const inst = fakeInstance();
    const proxy = proxyOver(inst);
    expect(proxy.stats).toEqual({ booted: false, frames: 0, fought: 0, timedOut: 0, fellBack: 0 });
    await settle(proxy.fight({ seat: 4, party: [mon()] }, { seat: 7, party: [mon()] }), inst);
    expect(await proxy.fight({ seat: 4, party: [] }, { seat: 7, party: [mon()] })).toBeNull();
    const { frames, ...rest } = proxy.stats;
    expect(rest).toEqual({ booted: true, fought: 1, timedOut: 0, fellBack: 1 });
    expect(frames).toBeGreaterThan(0);
  });

  it('runs the instance only while it fights: paused once awake, resumed for a duel, paused after (POK-247)', async () => {
    const inst = fakeInstance();
    const proxy = proxyOver(inst);
    await settle(proxy.fight({ seat: 4, party: [mon()] }, { seat: 7, party: [mon()] }), inst);
    expect(inst.life).toEqual(['pause', 'resume', 'pause']);
    await settle(proxy.fight({ seat: 5, party: [mon()] }, { seat: 6, party: [mon()] }), inst);
    expect(inst.life).toEqual(['pause', 'resume', 'pause', 'resume', 'pause']);
  });

  it('restarts the same instance in place after a fight that would not end, never a second core (POK-247)', async () => {
    const inst = fakeInstance({ answers: false });
    const notes: string[] = [];
    let boots = 0;
    let restarts = 0;
    const proxy = new ProxyDuels({
      boot: async () => (boots++, inst.emu),
      restart: async (emu) => {
        expect(emu).toBe(inst.emu);
        restarts++;
        inst.reboot();
      },
      mailboxBase: BASE,
      writeBoot: () => {},
      deadlineMs: 50,
      wakeFrames: 5,
      onNote: (w) => void notes.push(w),
    });
    expect(await settle(proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] }), inst, 400)).toBeNull();
    expect(notes.some((n) => n.startsWith('duel timed out'))).toBe(true);
    expect(inst.stopped, 'the instance is kept, not let go').toBe(false);
    expect(inst.life.at(-1)).toBe('pause');
    expect(restarts, 'nothing is restarted until there is a duel for it').toBe(0);

    // The next meeting power-cycles it, waits for it to wake, and fights on it.
    inst.answers = true;
    const out = await settle(proxy.fight({ seat: 4, party: [mon()] }, { seat: 7, party: [mon()] }), inst);
    expect(out).not.toBeNull();
    expect({ boots, restarts }).toEqual({ boots: 1, restarts: 1 });
    expect(inst.life).toEqual(['pause', 'resume', 'pause', 'resume', 'reboot', 'pause', 'resume', 'pause']);
    expect(proxy.stats).toMatchObject({ fought: 1, timedOut: 1, fellBack: 1 });
  });

  it('falls back when the instance never wakes, and does not try again', async () => {
    const inst = fakeInstance({ wakes: false });
    const notes: string[] = [];
    const proxy = proxyOver(inst, notes);

    expect(await settle(proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] }), inst)).toBeNull();
    expect(proxy.failed).toBe(true);
    expect(notes.some((n) => n.includes('never woke'))).toBe(true);
    expect(inst.stopped, 'and it is not left running at 8x for nothing (POK-247)').toBe(true);
    // A second caller is answered immediately, without booting anything.
    expect(await proxy.fight({ seat: 3, party: [mon()] }, { seat: 4, party: [mon()] })).toBeNull();
  });

  it('leaves a draw to the caller, and calls it a draw', async () => {
    const inst = fakeInstance();
    inst.answerWith({ t: 'dresult', seatA: 1, seatB: 2, winner: 2, a: [], b: [] });
    const notes: string[] = [];
    const proxy = proxyOver(inst, notes);
    expect(await settle(proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] }), inst)).toBeNull();
    // It used to say "winner 2" -- seat B -- for a fight nobody won.
    expect(notes).toContain('seat 1 vs seat 2: fought, a draw');
  });

  it('writes its boot block once the mailbox is up, and fights nothing until the ROM has taken it (POK-247)', async () => {
    // Written before the wake, the block was cleared by the ROM's mailbox init and the
    // instance never booted; handed a duel at the wake, the boot that came after wiped
    // both parties. Either way the first fight of every match, and the first after
    // every restart, was two empty teams and a draw.
    const inst = fakeInstance({ wakeAfter: 10, bootFrames: 30 });
    inst.answerWith({ t: 'dresult', seatA: 4, seatB: 7, winner: 0, a: [{ hp: 12, status: 0 }], b: [{ hp: 0, status: 0 }] });
    const proxy = new ProxyDuels({
      boot: async () => inst.emu,
      mailboxBase: BASE,
      writeBoot: (emu, base) => emu.write(base + MAILBOX.OFF_BOOT, 1, 8),
      deadlineMs: 2_000,
      wakeFrames: 100,
    });
    const out = await settle(proxy.fight({ seat: 4, party: [mon()] }, { seat: 7, party: [mon()] }), inst);

    expect(inst.booted, 'the boot block survived the wake and was taken').toBe(1);
    expect(inst.wiped, 'no duel reached the ROM before its boot').toBe(0);
    expect(out?.winner).toBe(4);
  });

  it('counts its deadline in the instance frames, not the page seconds (POK-247)', async () => {
    // A throttled host runs the instance at half speed: thirty seconds were half a
    // fight, and a fight still going was cut off. The frames are the fight's own time.
    const inst = fakeInstance({ afterFrames: 100 });
    const notes: string[] = [];
    const proxy = new ProxyDuels({
      boot: async () => inst.emu,
      mailboxBase: BASE,
      writeBoot: () => {},
      deadlineFrames: 50,
      deadlineMs: 60_000,
      wakeFrames: 5,
      onNote: (w) => void notes.push(w),
    });
    const out = await settle(proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] }), inst, 400);

    expect(out).toBeNull();
    // ...and says which fight, and how far it got in its own frames.
    expect(notes).toContain('duel timed out: seat 1 vs seat 2, 51 frames');
  });

  it('sends no duel with a side that has nothing standing, and does not wait on one (POK-247)', async () => {
    // The ROM stages no such fight and says nothing, so the page waited out the whole
    // deadline for an answer that was never coming, then restarted the instance.
    const inst = fakeInstance();
    const notes: string[] = [];
    const proxy = proxyOver(inst, notes, 60_000);
    const out = await settle(proxy.fight({ seat: 1, party: [mon({ hp: 0 }), mon({ hp: 0 })] }, { seat: 2, party: [mon()] }), inst);

    expect(out).toBeNull();
    expect(inst.duels).toBe(0);
    expect(notes).toContain('seat 1 vs seat 2: a side with nothing standing');
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

  it('lets go of a fight in flight when the instance is disposed', async () => {
    // A stopped emulator sends no more frames, so a duel waiting on one would wait for
    // ever -- and `busy` would hold every later meeting behind it for the rest of the
    // match. Disposing has to answer the caller, not just drop the instance.
    const inst = fakeInstance({ answers: false });
    const proxy = proxyOver(inst, [], 60_000);
    const running = proxy.fight({ seat: 1, party: [mon()] }, { seat: 2, party: [mon()] });

    // Far enough in to be waiting on frames rather than still booting. (`settle`
    // stops as soon as its promise does, which an already-resolved one has.)
    for (let i = 0; i < 40; i++) {
      inst.frame();
      await new Promise((r) => setTimeout(r, 0));
    }
    proxy.dispose();
    expect(await running, 'the caller is told to settle it itself').toBeNull();
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
