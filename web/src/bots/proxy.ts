// The proxy duel (POK-238, Kanto BR-28): a second, hidden copy of the ROM that the
// host's tab keeps around to fight bot-vs-bot meetings properly.
//
// Two bots meeting is settled by duel.ts today -- team weight against the match seed.
// That is fair and instant and it is still a coin flip with arithmetic in front of it:
// it owes nothing to type matchups, to the moves either side actually knows, or to the
// bag they are carrying. So the real thing: hand both parties to an instance of the
// game and let Emerald fight it.
//
// The instance is nobody's game. It has no seat, no relay and no room; it boots to
// Littleroot like a driver does, and the only thing it is ever asked is "who wins".
// `BrDuel_IsProxy` on the ROM side keeps it from behaving like a contestant -- a side
// losing here is a duel result, not somebody going out of a match.
//
// Everything about it is best-effort. One instance, one duel at a time, a hard
// deadline; anything that goes wrong (no core, a crash, a fight that will not end)
// falls back to the seeded resolver, which is why this can be an upgrade rather than a
// dependency.
import { Mailbox } from '../net/mailbox';
import { packSlot, reassembleSlots, unpackSlot, type BinarySlot } from '../net/slots';
import { BR_MSG, BR_CONT_FLAG } from '../net/slots';
import type { DresultMsg, PackedMon } from '../net/wire';

/** What the caller gets back: who won, and what each side has left. */
export interface DuelOutcome {
  winner: number; // the seat that took it
  loser: number;
  a: { hp: number; status: number }[];
  b: { hp: number; status: number }[];
}

/** The emulator surface this needs. A subset of `Emulator` so a test can stand in a
 *  plain object without a wasm core. */
export interface ProxyEmulator {
  read(addr: number, width?: 8 | 16 | 32): number;
  write(addr: number, value: number, width?: 8 | 16 | 32): void;
  bytes(addr: number, len: number): Uint8Array;
  press(key: 'a'): void;
  release(key: 'a'): void;
  onFrame(listener: () => void): () => void;
  stop(): void;
}

export interface ProxyOptions {
  /** Boots a hidden instance and hands it back, already running the patched ROM. */
  boot: () => Promise<ProxyEmulator>;
  /** gBrMailbox, the same address the visible instance uses. */
  mailboxBase: number;
  /** Writes the boot block into a freshly booted instance (app.ts's writeBootBlock). */
  writeBoot: (emu: ProxyEmulator, mailboxBase: number) => void;
  /** Give up on a duel after this long and let the caller fall back. */
  deadlineMs?: number;
  /** Frames to wait for the mailbox to wake before giving up on the instance. */
  wakeFrames?: number;
  /** Told about anything worth knowing: a timeout, a crash, a fallback. */
  onNote?: (what: string) => void;
}

/** A battle has message boxes that wait for a press (POK-269's rule) -- the intro's
 *  "would like to battle!" among them -- and nobody is holding this GBA. So the proxy
 *  taps A the whole time it is duelling. Tap, not hold: a held button is one press.
 *  With both battlers on the AI there is no menu a press could go wrong in. */
const TAP_EVERY_FRAMES = 12;
const TAP_HELD_FRAMES = 4;
const DEADLINE_MS = 30_000;
/** How many duels may be waiting behind the one in flight before the rest are sent to
 *  the seeded resolver. One instance fights one battle at a time and a battle takes
 *  real seconds; a room where everybody meets at once would otherwise leave half the
 *  field standing still, which is worse than a coin flip nobody can see. */
const MAX_QUEUED = 2;
const WAKE_FRAMES = 600;

export class ProxyDuels {
  private emu: ProxyEmulator | null = null;
  private mailbox: Mailbox | null = null;
  private booting: Promise<void> | null = null;
  private unframe: (() => void) | null = null;
  /** The duel in flight, and everyone waiting behind it. */
  private busy = false;
  private queue: (() => void)[] = [];
  private frames = 0;
  private broken = false;

  constructor(private readonly opts: ProxyOptions) {}

  /** Has the instance given up? Once it has, every duel falls back and nothing here
   *  tries to boot again -- a core that failed once fails every time. */
  get failed(): boolean {
    return this.broken;
  }

  /** Fights one, or answers null when the proxy could not (and the caller should fall
   *  back to the seeded resolver). Duels queue: one instance, one fight at a time. */
  async fight(seatA: number, seatB: number, a: PackedMon[], b: PackedMon[]): Promise<DuelOutcome | null> {
    if (this.broken || a.length === 0 || b.length === 0) return null;
    if (this.busy && this.queue.length >= MAX_QUEUED) {
      this.note('queue full: settling this one the cheap way');
      return null;
    }
    if (this.busy) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.busy = true;
    try {
      return await this.run(seatA, seatB, a, b);
    } catch (err) {
      this.note(`duel failed: ${String(err)}`);
      return null;
    } finally {
      this.busy = false;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  /** Lets the instance go. The next duel boots a fresh one. */
  dispose(): void {
    this.unframe?.();
    this.unframe = null;
    try {
      this.emu?.stop();
    } catch {
      /* already gone */
    }
    this.emu = null;
    this.mailbox = null;
    this.booting = null;
  }

  private note(what: string): void {
    this.opts.onNote?.(what);
  }

  private async run(seatA: number, seatB: number, a: PackedMon[], b: PackedMon[]): Promise<DuelOutcome | null> {
    await this.ensure();
    const emu = this.emu;
    const mailbox = this.mailbox;
    if (!emu || !mailbox) return null;

    // Drain whatever the instance said while it was idle -- it walks around Littleroot
    // like any other boot and has been talking to nobody.
    mailbox.poll();
    for (const slot of packSlot({ t: 'duel', seatA, seatB, a, b })) {
      if (!mailbox.push(slot.type, slot.payload)) {
        this.note('mailbox full: the instance is not draining');
        return null;
      }
    }

    const deadline = this.opts.deadlineMs ?? DEADLINE_MS;
    const result = await this.awaitResult(emu, mailbox, deadline);
    if (!result) {
      // A fight that will not end is worse than no proxy at all: the instance is left
      // in a battle nobody can finish, so it goes and the next duel boots a new one.
      this.note('duel timed out');
      this.dispose();
      return null;
    }
    if (result.winner > 1) return null; // a draw is the caller's to settle
    return {
      winner: result.winner === 0 ? result.seatA : result.seatB,
      loser: result.winner === 0 ? result.seatB : result.seatA,
      a: result.a,
      b: result.b,
    };
  }

  /** Runs the instance until a `dresult` comes back or the deadline passes, tapping A
   *  through the boxes the whole time. */
  private awaitResult(emu: ProxyEmulator, mailbox: Mailbox, deadlineMs: number): Promise<DresultMsg | null> {
    return new Promise((resolve) => {
      const started = Date.now();
      // Slots of a message that spans several, held until the last one lands.
      let parts: BinarySlot[] = [];
      const stop = emu.onFrame(() => {
        this.tap(emu);
        for (const raw of mailbox.poll()) {
          if ((raw.type & ~BR_CONT_FLAG) !== BR_MSG.DRESULT) continue;
          parts.push({ type: raw.type, payload: raw.payload });
          let msg;
          try {
            const { type, payload } = reassembleSlots(parts);
            msg = unpackSlot(type, payload) as DresultMsg;
          } catch {
            continue; // more slots to come
          }
          parts = [];
          stop();
          emu.release('a');
          resolve(msg);
          return;
        }
        if (Date.now() - started > deadlineMs) {
          stop();
          emu.release('a');
          resolve(null);
        }
      });
    });
  }

  private tap(emu: ProxyEmulator): void {
    this.frames++;
    const phase = this.frames % TAP_EVERY_FRAMES;
    if (phase === 0) emu.press('a');
    else if (phase === TAP_HELD_FRAMES) emu.release('a');
  }

  /** Boots the instance if it is not up, at most once at a time. */
  private ensure(): Promise<void> {
    if (this.emu && this.mailbox) return Promise.resolve();
    if (this.booting) return this.booting;
    this.booting = (async () => {
      try {
        const emu = await this.opts.boot();
        this.opts.writeBoot(emu, this.opts.mailboxBase);
        const mailbox = new Mailbox(
          {
            read: (addr, width) => emu.read(addr, width),
            write: (addr, value, width) => emu.write(addr, value, width),
            bytes: (addr, len) => emu.bytes(addr, len),
          },
          this.opts.mailboxBase,
        );
        await this.awaitWake(emu, mailbox);
        this.emu = emu;
        this.mailbox = mailbox;
      } catch (err) {
        this.broken = true;
        this.note(`no proxy instance: ${String(err)}`);
        throw err;
      } finally {
        this.booting = null;
      }
    })();
    return this.booting;
  }

  private awaitWake(emu: ProxyEmulator, mailbox: Mailbox): Promise<void> {
    return new Promise((resolve, reject) => {
      let frames = 0;
      const limit = this.opts.wakeFrames ?? WAKE_FRAMES;
      const stop = emu.onFrame(() => {
        if (mailbox.isAwake()) {
          stop();
          resolve();
          return;
        }
        if (++frames > limit) {
          stop();
          reject(new Error('the instance never woke its mailbox'));
        }
      });
    });
  }
}
