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
//
// And it runs only while it fights (POK-247). It used to boot on the first meeting and
// then run at 8x -- 480 frames a second, each a main-thread callback -- through the
// results, the lobby and PLAY AGAIN until the page closed, on a phone's battery. Now it
// is paused whenever no duel is in flight, and a fight that will not end power-cycles
// this same instance rather than making another.
import { MAILBOX, Mailbox } from '../net/mailbox';
import { packSlot, reassembleSlots, unpackSlot, type BinarySlot } from '../net/slots';
import { BR_MSG, BR_CONT_FLAG } from '../net/slots';
import type { BstartMsg, DresultMsg, Msg, PackedMon, TurnMsg } from '../net/wire';

/** What the caller gets back: who won, what each side has left, and what each spent
 *  out of its own bag (POK-237). */
export interface DuelOutcome {
  winner: number; // the seat that took it
  loser: number;
  a: { hp: number; status: number }[];
  b: { hp: number; status: number }[];
  usedA: number[];
  usedB: number[];
}

/** What the instance has done, for the `#perf` readout and the soak (POK-247): the
 *  only way to tell a match where the bots fought for real from one where every
 *  meeting fell back, and what the second core cost while it did. */
export interface ProxyCounts {
  booted: boolean;
  /** Frames the instance has run. */
  frames: number;
  fought: number;
  timedOut: number;
  /** Duels answered with null, for the caller's seeded resolver: a timeout, a full
   *  queue, a draw, an instance that never came up. */
  fellBack: number;
}

/** One side of a duel: the team, and the units it may spend in there. */
export interface DuelSide {
  seat: number;
  party: PackedMon[];
  items?: number[];
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
  /** Never from inside a frame listener: a pause waits on the core's thread, which is
   *  waiting on that listener. */
  pause(): void;
  resume(): void;
}

export interface ProxyOptions {
  /** Boots a hidden instance and hands it back, already running the patched ROM. */
  boot: () => Promise<ProxyEmulator>;
  /** gBrMailbox, the same address the visible instance uses. */
  mailboxBase: number;
  /** Power-cycles the instance in place, for a fight that would not end: the same core
   *  from the same image. Without it such an instance is let go, and the next duel
   *  boots another -- a whole second module, which is never freed. */
  restart?: (emu: ProxyEmulator) => Promise<void>;
  /** Writes the boot block into a freshly booted instance (app.ts's writeBootBlock). */
  writeBoot: (emu: ProxyEmulator, mailboxBase: number) => void;
  /** Give up on a duel after this many of the instance's own frames and let the caller
   *  fall back. */
  deadlineFrames?: number;
  /** ...or after this long, whatever the frames: an instance that stops sending any. */
  deadlineMs?: number;
  /** Frames to wait for the mailbox to wake before giving up on the instance. */
  wakeFrames?: number;
  /** Told about anything worth knowing: a timeout, a crash, a fallback. */
  onNote?: (what: string) => void;
  /** The fight as it happens (POK-300): the instance publishes its duel the way a
   *  player's ROM publishes a link battle -- a `bstart`, then `turn`s -- under the two
   *  bots' seats. Handed over as they land so the room can watch either bot into it. */
  onStream?: (msg: BstartMsg | TurnMsg) => void;
}

/** A battle has message boxes that wait for a press (POK-269's rule) -- the intro's
 *  "would like to battle!" among them -- and nobody is holding this GBA. So the proxy
 *  taps A the whole time it is duelling. Tap, not hold: a held button is one press.
 *  With both battlers on the AI there is no menu a press could go wrong in. */
const TAP_EVERY_FRAMES = 12;
const TAP_HELD_FRAMES = 4;
/** A duel's deadline is in the instance's own frames, not the page's seconds (POK-247).
 *  It was thirty seconds, which at 8x is 14,400 frames on a desktop -- and on a 4x-
 *  throttled one, where the instance runs at about 250 frames a second, 7,500: a 2v2
 *  at level 75 still trading blows was cut off and the instance power-cycled. The
 *  longest fight measured at full speed took 10,834 frames (3v4, level 75); five
 *  minutes of game time is room for six-a-side. */
const DEADLINE_FRAMES = 18_000;
/** And the wall-clock cap, for an instance that stops sending frames at all. */
const DEADLINE_MS = 90_000;
/** How many duels may be waiting behind the one in flight before the rest are sent to
 *  the seeded resolver. One instance fights one battle at a time and a battle takes
 *  real seconds; a room where everybody meets at once would otherwise leave half the
 *  field standing still, which is worse than a coin flip nobody can see. */
const MAX_QUEUED = 2;
const WAKE_FRAMES = 600;

/** Anything in the team still able to fight. */
function standing(party: PackedMon[]): boolean {
  return party.some((mon) => mon.hp > 0);
}

export class ProxyDuels {
  private emu: ProxyEmulator | null = null;
  private mailbox: Mailbox | null = null;
  private booting: Promise<void> | null = null;
  /** Cancels the duel in flight: unhooks its frame handler and answers its caller
   *  with null, so a dispose while a fight is running does not leave `run` waiting
   *  on frames from an emulator that has been stopped. */
  private unframe: (() => void) | null = null;
  /** The duel in flight, and everyone waiting behind it. */
  private busy = false;
  private queue: (() => void)[] = [];
  private frames = 0;
  private broken = false;
  /** The instance was left in a fight that would not end: the next duel restarts it. */
  private stale = false;
  private readonly counts: ProxyCounts = { booted: false, frames: 0, fought: 0, timedOut: 0, fellBack: 0 };

  constructor(private readonly opts: ProxyOptions) {}

  /** Has the instance given up? Once it has, every duel falls back and nothing here
   *  tries to boot again -- a core that failed once fails every time. */
  get failed(): boolean {
    return this.broken;
  }

  get stats(): ProxyCounts {
    return { ...this.counts };
  }

  /** Fights one, or answers null when the proxy could not (and the caller should fall
   *  back to the seeded resolver). Duels queue: one instance, one fight at a time. */
  async fight(a: DuelSide, b: DuelSide): Promise<DuelOutcome | null> {
    const out = await this.attempt(a, b);
    if (!out) this.counts.fellBack++;
    return out;
  }

  private async attempt(a: DuelSide, b: DuelSide): Promise<DuelOutcome | null> {
    if (this.broken || a.party.length === 0 || b.party.length === 0) return null;
    // A side with nothing standing is no fight: the ROM stages none (br_duel.c's
    // ParseDuel, BrBot_AnyStanding) and says nothing, so the duel sat out the whole
    // deadline and cost the instance a restart (POK-247).
    if (!standing(a.party) || !standing(b.party)) {
      this.note(`seat ${a.seat} vs seat ${b.seat}: a side with nothing standing`);
      return null;
    }
    if (this.busy && this.queue.length >= MAX_QUEUED) {
      this.note('queue full: settling this one the cheap way');
      return null;
    }
    if (this.busy) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.busy = true;
    try {
      return await this.run(a, b);
    } catch (err) {
      this.note(`duel failed: ${String(err)}`);
      return null;
    } finally {
      this.busy = false;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  /** Boots the instance now, ahead of any duel, and leaves it paused (POK-247): its
   *  first boot is a whole second core, 110-150 ms of main thread on a throttled phone,
   *  and it used to land on the first bot-vs-bot meeting of the match. Nobody fights
   *  in the Safari, so the page calls this there. Never throws: an instance that will
   *  not come up is noted and fallen back from, as a duel would have found. */
  async warm(): Promise<void> {
    if (this.broken) return;
    try {
      await this.ensure();
    } catch {
      /* noted in ensure(); every duel falls back */
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
    this.stale = false;
  }

  private note(what: string): void {
    this.opts.onNote?.(what);
  }

  private async run(a: DuelSide, b: DuelSide): Promise<DuelOutcome | null> {
    await this.ensure();
    const emu = this.emu;
    const mailbox = this.mailbox;
    if (!emu || !mailbox) return null;

    // Drain whatever the instance said while it was idle -- it walks around Littleroot
    // like any other boot and has been talking to nobody.
    mailbox.poll();
    const duel: Msg = { t: 'duel', seatA: a.seat, seatB: b.seat, a: a.party, b: b.party };
    if (a.items?.length) (duel as { itemsA?: number[] }).itemsA = a.items;
    if (b.items?.length) (duel as { itemsB?: number[] }).itemsB = b.items;
    for (const slot of packSlot(duel)) {
      if (!mailbox.push(slot.type, slot.payload)) {
        this.note('mailbox full: the instance is not draining');
        return null;
      }
    }

    const from = this.counts.frames;
    emu.resume();
    const result = await this.awaitResult(emu, mailbox, this.opts.deadlineFrames ?? DEADLINE_FRAMES, this.opts.deadlineMs ?? DEADLINE_MS);
    // Idle until the next meeting. Here, after the await, and not in the frame listener
    // that finished the duel: a pause from in there would wait on its own caller.
    if (this.emu === emu) emu.pause();
    if (!result) {
      // A fight that will not end is worse than no proxy at all: the instance is left
      // in a battle nobody can finish, so the next duel starts it over first.
      // Which fight, and how long it ran in its own frames: a soak's only lead on a
      // fight that runs past five minutes of game time, or one that stopped.
      this.note(`duel timed out: seat ${a.seat} vs seat ${b.seat}, ${this.counts.frames - from} frames`);
      this.counts.timedOut++;
      if (this.opts.restart && this.emu === emu) this.stale = true;
      else this.dispose();
      return null;
    }
    // Said out loud, once per duel: this is the only way anybody -- a soak, a host
    // watching their own console -- can tell a match where the bots fought for real
    // from one where every meeting fell back to the resolver. Failures say so below;
    // without this, silence meant both.
    this.note(`seat ${a.seat} vs seat ${b.seat}: fought, ${result.winner > 1 ? 'a draw' : `winner ${result.winner === 0 ? a.seat : b.seat}`}`);
    this.counts.fought++;
    if (result.winner > 1) return null; // a draw is the caller's to settle
    return {
      winner: result.winner === 0 ? result.seatA : result.seatB,
      loser: result.winner === 0 ? result.seatB : result.seatA,
      a: result.a,
      b: result.b,
      usedA: result.usedA ?? [],
      usedB: result.usedB ?? [],
    };
  }

  /** Runs the instance until a `dresult` comes back or the deadline passes -- its own
   *  frames, or the wall clock for an instance that stopped -- tapping A through the
   *  boxes the whole time. */
  private awaitResult(emu: ProxyEmulator, mailbox: Mailbox, deadlineFrames: number, deadlineMs: number): Promise<DresultMsg | null> {
    return new Promise((resolve) => {
      let frames = 0;
      // Slots of a message that spans several, held until the last one lands -- one
      // run per type, since a bstart spans a dozen slots and a turn can land between.
      let parts: BinarySlot[] = [];
      const streamParts = new Map<number, BinarySlot[]>();
      const finish = (value: DresultMsg | null) => {
        stop();
        clearTimeout(cap);
        this.unframe = null;
        try {
          emu.release('a');
        } catch {
          /* the instance has already gone */
        }
        resolve(value);
      };
      // A dispose while this is in flight -- the page tearing the room down, or the
      // timeout below on an earlier duel -- stops the emulator, and a stopped emulator
      // sends no more frames: without this the promise would never settle and `busy`
      // would hold the queue shut for the rest of the match.
      this.unframe = () => finish(null);
      const cap = setTimeout(() => finish(null), deadlineMs);
      const stop = emu.onFrame(() => {
        this.tap(emu);
        for (const raw of mailbox.poll()) {
          const base = raw.type & ~BR_CONT_FLAG;
          if (base === BR_MSG.BSTART || base === BR_MSG.TURN) {
            const run = streamParts.get(base) ?? [];
            run.push({ type: raw.type, payload: raw.payload });
            streamParts.set(base, run);
            try {
              const { type, payload } = reassembleSlots(run);
              streamParts.delete(base);
              this.opts.onStream?.(unpackSlot(type, payload) as BstartMsg | TurnMsg);
            } catch {
              /* more slots to come */
            }
            continue;
          }
          if (base !== BR_MSG.DRESULT) continue;
          parts.push({ type: raw.type, payload: raw.payload });
          let msg;
          try {
            const { type, payload } = reassembleSlots(parts);
            msg = unpackSlot(type, payload) as DresultMsg;
          } catch {
            continue; // more slots to come
          }
          parts = [];
          finish(msg);
          return;
        }
        if (++frames > deadlineFrames) finish(null);
      });
    });
  }

  private tap(emu: ProxyEmulator): void {
    this.frames++;
    const phase = this.frames % TAP_EVERY_FRAMES;
    if (phase === 0) emu.press('a');
    else if (phase === TAP_HELD_FRAMES) emu.release('a');
  }

  /** Boots the instance if it is not up, or restarts a stale one, at most once at a
   *  time; either way it is left awake and paused. */
  private ensure(): Promise<void> {
    if (this.emu && this.mailbox && !this.stale) return Promise.resolve();
    if (this.booting) return this.booting;
    this.booting = (async () => {
      let emu = this.emu;
      try {
        if (emu && this.stale && this.opts.restart) {
          this.stale = false;
          this.mailbox = null;
          // A reboot need not clear RAM, and the magic the old run left would read as a
          // ROM already awake (app.ts's rebootIntoBr does the same).
          emu.write(this.opts.mailboxBase + MAILBOX.OFF_MAGIC, 0, 16);
          emu.resume();
          await this.opts.restart(emu);
        } else {
          emu = await this.opts.boot();
          this.counts.booted = true;
          emu.onFrame(() => this.counts.frames++);
        }
        const up = emu;
        const mailbox = new Mailbox(
          {
            read: (addr, width) => up.read(addr, width),
            write: (addr, value, width) => up.write(addr, value, width),
            bytes: (addr, len) => up.bytes(addr, len),
          },
          this.opts.mailboxBase,
        );
        // The boot block goes in once the mailbox is up, the way the page's own core
        // does it (app.ts's rebootIntoBr), and the instance is ready when the ROM has
        // taken it (POK-247). Written before, it raced the ROM's mailbox init, which
        // clears the whole mailbox, boot block and all. Called ready at the wake -- the
        // copyright screen, before the boot -- the first DUEL was staged there and then
        // wiped with both parties by the boot's NewGameInitData: the first fight of
        // every match, and the first after every restart, was two empty teams and a
        // draw, settled by the coin flip.
        await this.awaitWake(up, mailbox);
        this.opts.writeBoot(up, this.opts.mailboxBase);
        await this.awaitBoot(up);
        up.pause(); // booted, and idle until a duel wants it
        this.emu = up;
        this.mailbox = mailbox;
      } catch (err) {
        this.broken = true;
        this.note(`no proxy instance: ${String(err)}`);
        // Nothing will ask it anything again, so it is not left running at 8x either.
        try {
          emu?.stop();
        } catch {
          /* never came up */
        }
        this.emu = null;
        this.mailbox = null;
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

  /** Until the ROM has taken its boot block: it clears `mode` when it starts the game
   *  the block describes (br_boot.c, BrBoot_Tick), after the copyright screen. */
  private awaitBoot(emu: ProxyEmulator): Promise<void> {
    const mode = this.opts.mailboxBase + MAILBOX.OFF_BOOT;
    return new Promise((resolve, reject) => {
      let frames = 0;
      const limit = this.opts.wakeFrames ?? WAKE_FRAMES;
      const stop = emu.onFrame(() => {
        if (emu.read(mode, 8) === 0) {
          stop();
          resolve();
          return;
        }
        if (++frames > limit) {
          stop();
          reject(new Error('the instance never took its boot block'));
        }
      });
    });
  }
}
