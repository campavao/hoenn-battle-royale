// How long a decided match stays on screen before the page lets go of it (POK-258).
//
// "If the game is over I should be kicked back to the main menu." Kanto's shape
// (main.lua, END_GRACE_SECONDS): everybody reads the result for a moment, then one exit
// takes them out. The room goes back to the room and solo to the lobby, with their own
// lengths, but it is one grace -- the room and solo each kept a copy of it, and the two
// had already drifted.
//
// No page here: the parade check is handed in, so vitest can drive it on a fake clock.

export interface EndGraceOptions {
  /** How long the result stays up. Kanto's END_GRACE_SECONDS. */
  graceMs: number;
  /** The champion waits for their own parade instead, and takes the exit regardless
   *  after this long. Kanto's END_DEADLINE_SECONDS, the same idea: a ROM that never
   *  finishes must not strand somebody in a match that is over. */
  winMaxMs: number;
  pollMs: number;
  /** Whether the Hall of Fame is over (BR_PHASE_DONE in gBrMatch). Undefined when the
   *  build has no such symbol, and a win then waits graceMs like anybody else's. */
  paradeDone?: () => boolean;
}

export class EndGrace {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: EndGraceOptions) {}

  /** A grace has been armed and not cancelled. Still true after a plain grace has run
   *  out: the exit it took is what cancels it (onAgain's graceArmed reads this). */
  get armed(): boolean {
    return this.timer !== null;
  }

  /** Start the grace, dropping any already running. `won` is this page's own seat taking
   *  the match, which waits for the parade rather than a timer. */
  arm(go: () => void, won = false): void {
    this.cancel();
    const { paradeDone } = this.opts;
    if (!won || paradeDone === undefined) {
      this.timer = setTimeout(go, this.opts.graceMs);
      return;
    }
    // BR_PHASE_DONE: BrMatch_HallOfFameDone sets it on the way back to the map. Polling
    // one byte beats guessing at a duration -- the parade is as long as the champion's
    // team is, and a four-second timer would reboot the ROM in the middle of it.
    this.timer = setTimeout(go, this.opts.winMaxMs);
    this.poll = setInterval(() => {
      if (!paradeDone()) return;
      this.cancel();
      go();
    }, this.opts.pollMs);
  }

  /** Cancel a grace that is in flight -- because the exit has already been taken, by a
   *  press of PLAY AGAIN. (Not by the host's `again`, which arrives right behind the
   *  `win` and used to cut every guest's grace short: onAgain.) */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.poll !== null) clearInterval(this.poll);
    this.timer = null;
    this.poll = null;
  }
}
