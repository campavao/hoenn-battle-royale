// The waits before the results go up (results.ts): the champion's for their Hall of Fame
// parade, a watcher's for the fight on their screen. The page holds these from the start
// of a match, and the screen itself stays out of main.js until it is wanted (POK-407).

/** The results wait for the Hall of Fame (BR_PHASE_DONE), then stay up for the grace
 *  everybody else gets. Everybody's, not only the champion's (POK-417): somebody else's
 *  win is paraded in our ROM too, once their team has reached it. EndGrace polls `finished` as its paradeDone, so the one
 *  poll does both: the first time the parade is seen over, the results are drawn
 *  (`onParaded`); the exit comes `graceMs` after that. A parade that never ends is given
 *  up on after `giveUpMs`, and the results go up anyway. */
export class ParadeHold {
  private seenAt: number | null = null;
  private waitingSince: number | null = null;
  /** Somebody else's win: their parade may never come (no team ever reached us), so it
   *  is waited for `startMs` to begin, a replay it waits behind not counted. */
  private other = false;
  private startWaited = 0;
  private pausedFor = 0;
  private lastLook: number | null = null;

  constructor(
    private readonly opts: {
      /** The ROM's parade is over. Undefined when the build cannot say (no gBrMatch), and
       *  then nothing is held: the results go up at the `win`, as anybody's do. */
      done?(): boolean;
      graceMs: number;
      /** How long the parade is waited for, from the grace's first look: EndGrace's
       *  winMaxMs less a grace and two polls, so the results are read for the grace and
       *  the poll takes the exit just ahead of that deadline. The deadline takes it
       *  regardless, and a stuck parade used to hold the results past it: its champion
       *  never saw them at all (POK-320 review). */
      giveUpMs: number;
      /** The parade is on (BR_PHASE_WIN) or over. Undefined: never asked. */
      started?(): boolean;
      /** How long somebody else's parade is given to begin. */
      startMs?: number;
      /** Our ROM is playing a fight back (gBrSpectate.watching), which its parade waits
       *  behind (br_hof.c): neither the start window nor the give-up runs meanwhile, up
       *  to `pauseMaxMs` in all. */
      paused?(): boolean;
      pauseMaxMs?: number;
      onParaded(): void;
      now?(): number;
    },
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : performance.now();
  }

  /** The parade has been seen over: the results are the champion's to read. */
  get paraded(): boolean {
    return this.seenAt !== null;
  }

  /** Waiting on a parade now: the grace's exit must not take the page away under it. */
  get holding(): boolean {
    return this.opts.done !== undefined && this.waitingSince !== null && this.seenAt === null;
  }

  /** Whether `seat`'s results wait: anybody's win, with the parade still to be seen
   *  over. The room and solo each asked this themselves, and nothing pinned either. */
  holds(winner: number | undefined, seat: number): boolean {
    if (this.opts.done === undefined || winner === undefined || this.paraded) return false;
    this.other = winner !== seat;
    return true;
  }

  /** For EndGrace: the parade over, and the results read for the grace since. */
  finished = (): boolean => {
    const now = this.now();
    if (this.seenAt === null) {
      this.waitingSince ??= now;
      if (!this.opts.done?.() && now - this.waitingSince - this.pausedFor < this.opts.giveUpMs && !this.noShow(now)) return false;
      this.seenAt = now;
      this.opts.onParaded();
    }
    return now - this.seenAt >= this.opts.graceMs;
  };

  /** Somebody else's parade has had its `startMs` to begin and has not. */
  private noShow(now: number): boolean {
    const since = this.lastLook ?? now;
    this.lastLook = now;
    if (this.opts.paused?.() && this.pausedFor < (this.opts.pauseMaxMs ?? 0)) this.pausedFor += now - since;
    if (!this.other || this.opts.startMs === undefined || this.opts.started?.()) return false;
    if (!this.opts.paused?.()) this.startWaited += now - since;
    return this.startWaited >= this.opts.startMs;
  }

  /** The next match's champion waits for the next parade. */
  reset(): void {
    this.seenAt = null;
    this.waitingSince = null;
    this.other = false;
    this.startWaited = 0;
    this.pausedFor = 0;
    this.lastLook = null;
  }
}

/** Holds a watcher's results while their ROM is still replaying a fight (POK-365), up to
 *  `maxMs` from the first ask, and draws them (`onOver`) the moment it stops. A watcher
 *  whose replay is not on yet gives it `startMs` to come on: the `win` can beat the
 *  `bstart` to the ROM. Nobody else waits at all. Once let go it stays let go until
 *  `reset`: a replay the watcher steps into after the results are up does not take them
 *  down again. */
export class ReplayHold {
  private since: number | null = null;
  private seen = false;
  /** Whether the first ask found this page watching somebody: only a watcher gets the start window. */
  private watcher = false;
  private released = false;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly opts: {
      /** Our ROM is playing a fight back (gBrSpectate.watching). */
      replaying(): boolean;
      /** This page is out and following a trainer, so a replay may still come on. */
      watching(): boolean;
      maxMs: number;
      /** How long a replay that has not started is waited for. */
      startMs: number;
      pollMs: number;
      onOver(): void;
      now?(): number;
    },
  ) {}

  /** Still waiting on a replay: the grace's exit must not take the page away under it. */
  get waiting(): boolean {
    return this.poll !== null;
  }

  /** Whether the results wait. The first `true` starts the poll that ends the wait. */
  holds(): boolean {
    if (this.released) return false;
    const now = this.opts.now ? this.opts.now() : performance.now();
    if (this.since === null) {
      this.since = now;
      this.watcher = this.opts.watching();
    }
    const on = this.opts.replaying();
    if (on) this.seen = true;
    const gone = !on && (this.seen || !this.watcher || now - this.since >= this.opts.startMs);
    if (gone || now - this.since >= this.opts.maxMs) {
      this.release();
      return false;
    }
    this.poll ??= setInterval(() => {
      if (this.holds()) return;
      this.opts.onOver();
    }, this.opts.pollMs);
    return true;
  }

  /** The next match's results wait for the next replay. */
  reset(): void {
    this.release();
    this.released = false;
    this.seen = false;
    this.watcher = false;
    this.since = null;
  }

  private release(): void {
    this.released = true;
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
  }
}
