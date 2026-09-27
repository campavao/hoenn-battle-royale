// The game stopping under the player, and saying so (POK-328).
//
// Cam's phone play-test on 2026-09-18: a Mossdeep Gym trainer beaten, then a black
// screen, the music looping garbage, the pad still up and no way out. No driver has
// reproduced it (gym-trainer, gym-trainer-real and gym-out all come back to the field),
// and its likeliest cause has been fixed since: a frame listener that threw never
// finished the core thread's synchronous call, so the core waited on it for good -- the
// last frame left on screen, the audio looping its last buffer, the page alive around it
// (POK-330 #35). But nothing on the page would have said so. Nobody heard emu.onCrash,
// and nothing noticed the frames stopping.
//
// So the page watches its emulator for three stops, and names the one it sees:
//  - 'core':  no emulated frame for CORE_STALL_MS, with the page running and on screen;
//  - 'rom':   frames arriving, but the ROM's heartbeat -- gBrMailbox.frame, which BrFrame
//             bumps on every pass of the main loop (src/main.c) -- still for
//             ROM_STALL_FRAMES of them: the ROM stuck inside one pass;
//  - 'crash': the core said it crashed.
// None of them is a stop the page made itself. The boot block's hold and a reboot pause
// the core on purpose (Emulator.isPaused, pauses), a hidden tab's frames stop, and a page
// that did not get to run its own timer -- a long task, a throttled tab -- did not see
// the frames either, so a late tick starts the count over. The proxy's headless core is
// never watched: it is paused between duels by design, and the duel's own timeout is its
// watchdog (bots/proxy.ts).
//
// A stop is called once. A game that comes back -- frames arriving and the heartbeat
// moving again -- takes the verdict back (onBack), so a false alarm costs the player a
// moment and not the match.
//
// It reads the ROM through the symbol table like every other page module; the offsets
// are field.ts's and touch.ts's, which parity.test.ts holds to the C.
import { SB1_MAP_GROUP, SB1_MAP_NUM, MAIN_CALLBACK2 } from '../field';
import { MAILBOX } from '../net/mailbox';
import { MAIN_IN_BATTLE_BIT, MAIN_IN_BATTLE_BYTE } from '../touch';

export type StallKind = 'core' | 'rom' | 'crash';

/** Checked this often. */
export const TICK_MS = 500;
/** No frame for this long is a core that stopped. A phone at its slowest makes a frame
 *  every 50 ms; the page's own holds are excluded, not waited out. */
export const CORE_STALL_MS = 3000;
/** Frames with the heartbeat still. BrFrame runs every pass of the main loop, and the
 *  ROM's longest single pass (a map load) is a handful of frames. */
export const ROM_STALL_FRAMES = 180;
/** Frames of the game running again, the heartbeat moving, before a stop is over. */
export const BACK_FRAMES = 60;
/** A tick this far behind the last one means the page itself was not running. */
const LATE_MS = 2 * TICK_MS;

/** `struct Main` (include/main.h) starts with callback1. */
const MAIN_CALLBACK1 = 0;
/** `struct BrMatch` (include/br/br_match.h) starts with phase. */
const MATCH_PHASE = 0;

/** What the watchdog needs of the emulator; Emulator has all of it. */
export interface Watched {
  onFrame(listener: () => void): () => void;
  onCrash(listener: () => void): () => void;
  isRunning(): boolean;
  isPaused(): boolean;
  /** Goes up across every boot, pause, stop and crash (Emulator.pauses). */
  readonly pauses: number;
}

export interface WatchdogDeps {
  emu: Watched;
  /** The ROM's heartbeat, read after every frame; null when it cannot be read. Left out
   *  (an unpatched ROM, no symbols), only the core and a crash are watched. */
  heartbeat?(): number | null;
  /** The tab is on screen. */
  visible(): boolean;
  now(): number;
  onStall(kind: StallKind): void;
  onBack?(): void;
}

export class Watchdog {
  private frames = 0;
  private lastFrameAt: number;
  private lastTickAt: number;
  private pauses: number;
  /** The heartbeat as last read, and whether it has moved since the count started over:
   *  after a boot, EWRAM may hold the last run's value until BrMailbox_Init clears it. */
  private beat: number | null = null;
  private beatMoved = false;
  /** Frames since the heartbeat last moved. */
  private still = 0;
  private stalled: StallKind | null = null;
  /** Frames, and whether the heartbeat moved, since the stop was called. */
  private framesSince = 0;
  private movedSince = false;
  private readonly offs: (() => void)[];

  constructor(private readonly deps: WatchdogDeps) {
    const now = deps.now();
    this.lastFrameAt = now;
    this.lastTickAt = now;
    this.pauses = deps.emu.pauses;
    this.offs = [deps.emu.onFrame(() => this.frame()), deps.emu.onCrash(() => this.fire('crash'))];
  }

  /** The stop called and not yet taken back, or null. */
  get verdict(): StallKind | null {
    return this.stalled;
  }

  dispose(): void {
    for (const off of this.offs) off();
  }

  private frame(): void {
    this.frames++;
    this.framesSince++;
    this.lastFrameAt = this.deps.now();
    const beat = this.deps.heartbeat?.() ?? null;
    if (beat === null) return;
    if (beat === this.beat) {
      this.still++;
      return;
    }
    if (this.beat !== null) {
      this.beatMoved = true;
      this.movedSince = true;
    }
    this.beat = beat;
    this.still = 0;
  }

  /** Every TICK_MS, from the page's own timer. */
  tick(): void {
    const { emu } = this.deps;
    const now = this.deps.now();
    const late = now - this.lastTickAt > LATE_MS;
    this.lastTickAt = now;
    if (this.stalled === 'crash') return;
    if (late || !emu.isRunning() || emu.isPaused() || !this.deps.visible() || emu.pauses !== this.pauses) {
      this.pauses = emu.pauses;
      this.startOver(now);
      return;
    }
    if (this.stalled) {
      if (this.framesSince >= BACK_FRAMES && (!this.deps.heartbeat || this.movedSince)) {
        this.stalled = null;
        this.deps.onBack?.();
      }
      return;
    }
    if (now - this.lastFrameAt >= CORE_STALL_MS) this.fire('core');
    else if (this.beatMoved && this.still >= ROM_STALL_FRAMES) this.fire('rom');
  }

  private startOver(now: number): void {
    this.lastFrameAt = now;
    this.beat = null;
    this.beatMoved = false;
    this.still = 0;
  }

  private fire(kind: StallKind): void {
    if (this.stalled === kind || this.stalled === 'crash') return;
    this.stalled = kind;
    this.framesSince = 0;
    this.movedSince = false;
    this.deps.onStall(kind);
  }
}

/** A stop, and what the ROM was doing when it was called: what a screenshot of the
 *  overlay has to carry, since the next one may never happen in front of a driver. */
export interface StallReport {
  kind: StallKind;
  /** gMain.callback2 and callback1, by the symbol table's name when it has one. */
  cb2: string | null;
  cb1: string | null;
  /** The map, `group:num`. */
  map: string | null;
  /** gBrMatch.phase. */
  phase: number | null;
  /** gMain.inBattle. */
  battle: boolean | null;
  /** Frame listeners that have thrown so far. */
  threw: number;
}

type Symbols = ReadonlyMap<string, number> | null;

/** A callback as the symbol table names it, or its address: `CB2_Overworld`,
 *  `0x080862FD`. The Thumb bit is the pointer's, not the function's. */
export function callbackName(ptr: number, symbols: Symbols): string {
  const addr = (ptr & ~1) >>> 0;
  if (addr && symbols) {
    for (const [name, at] of symbols) if (at === addr) return name;
  }
  return `0x${(ptr >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

/** Reads what can be read. A crashed core may have no RAM to read at all. */
export function readStall(kind: StallKind, emu: { read(addr: number, width: 8 | 16 | 32): number; readonly threw?: number }, symbols: Symbols): StallReport {
  const at = (name: string) => symbols?.get(name);
  const safe = <T>(base: number | undefined, read: (base: number) => T): T | null => {
    if (base === undefined) return null;
    try {
      return read(base);
    } catch {
      return null;
    }
  };
  const main = at('gMain');
  return {
    kind,
    cb2: safe(main, (m) => callbackName(emu.read(m + MAIN_CALLBACK2, 32), symbols)),
    cb1: safe(main, (m) => callbackName(emu.read(m + MAIN_CALLBACK1, 32), symbols)),
    map: safe(at('gSaveBlock1Ptr'), (sb) => {
      const p = emu.read(sb, 32);
      return p ? `${emu.read(p + SB1_MAP_GROUP, 8)}:${emu.read(p + SB1_MAP_NUM, 8)}` : null;
    }),
    phase: safe(at('gBrMatch'), (m) => emu.read(m + MATCH_PHASE, 8)),
    battle: safe(main, (m) => (emu.read(m + MAIN_IN_BATTLE_BYTE, 8) & MAIN_IN_BATTLE_BIT) !== 0),
    threw: emu.threw ?? 0,
  };
}

/** The overlay's line, and the log's: the stop, the build, and where the ROM was.
 *  `rom · patch 3 · shell 5f24422 · rom d8db607 · cb2 CB2_Overworld · cb1 0x08085E25 · map 14:0 · phase 3 · in battle` */
export function stallLine(r: StallReport, version: string): string {
  const parts = [r.kind, version.trim()];
  if (r.cb2 !== null) parts.push(`cb2 ${r.cb2}`);
  if (r.cb1 !== null) parts.push(`cb1 ${r.cb1}`);
  if (r.map !== null) parts.push(`map ${r.map}`);
  if (r.phase !== null) parts.push(`phase ${r.phase}`);
  if (r.battle) parts.push('in battle');
  if (r.threw) parts.push(`${r.threw} listener${r.threw === 1 ? '' : 's'} threw`);
  return parts.filter(Boolean).join(' · ');
}

export interface WatchOptions {
  emu: Watched & { read(addr: number, width: 8 | 16 | 32): number; readonly threw?: number; readonly headless?: boolean };
  symbols: Symbols;
  onStall(report: StallReport): void;
  onBack?(): void;
  visible?(): boolean;
  now?(): number;
  /** The page's timer; returns its clear. */
  every?(fn: () => void, ms: number): () => void;
}

/** Watches the page's own emulator from now on. A headless core -- the proxy's -- is not
 *  watched at all. Returns a stop. */
export function watch(opts: WatchOptions): () => void {
  const { emu, symbols } = opts;
  if (emu.headless) return () => {};
  const mailbox = symbols?.get('gBrMailbox');
  const dog = new Watchdog({
    emu,
    heartbeat:
      mailbox === undefined
        ? undefined
        : () => {
            try {
              return emu.read(mailbox + MAILBOX.OFF_FRAME, 32);
            } catch {
              return null;
            }
          },
    visible: opts.visible ?? (() => !document.hidden),
    now: opts.now ?? (() => performance.now()),
    onStall: (kind) => opts.onStall(readStall(kind, emu, symbols)),
    onBack: () => opts.onBack?.(),
  });
  const every =
    opts.every ??
    ((fn: () => void, ms: number) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    });
  const stop = every(() => dog.tick(), TICK_MS);
  return () => {
    stop();
    dog.dispose();
  };
}
