// The stuck-fight net: no trainer is held for good by a fight that never started.
//
// The shot clock (br_battle.c) runs from the first choice menu on, so it cannot help before
// it: at the VS cards, under the intro, or when the room says I am fighting and my page has
// no fight up (a resync jumped past the event that would have opened it, net.ts). These two
// rules are the page's own, in real time, and say nothing about who is right: a fight that
// is stopped this way has no winner, and both sides go back to the field with nothing lost.
// main.ts watches them and rom.ts unwinds the fight; what is decided here is only when.

/** How long a fight may take to reach its first menu, and how slow a page may be meanwhile. */
export interface NetLimits {
  /** Real time from the fight being handed to the ROM (or the room saying I fight) to the net. */
  ms: number;
  /** ...and the emulator frames that must have run in it: a page that is merely slow (frames
   *  take long) is still making progress, so it is not cut before it has run this many.
   *  The intro is about 430 frames at normal speed, so the floor is four times that. */
  frames: number;
  /** Past this much real time the net fires whatever the frames: a page whose emulator is not
   *  running at all (a tab left hidden) cannot be waited on for ever, or the room holds its
   *  trainer (and the other's) for as long. */
  hardMs: number;
}

/** "Like a minute" (Cam, 2026-11-03). */
export const NET_LIMITS: NetLimits = { ms: 60_000, frames: 1800, hardMs: 300_000 };

export type Verdict = 'off' | 'wait' | 'fire';

/** The net over a fight handed to the ROM: it is off for good once the first menu has been up
 *  (what happens there is the shot clock's), and fires when `ms` of real time and `frames`
 *  emulator frames have both gone by without one, or `hardMs` of real time has. */
export class FirstMenuNet {
  seen = false;

  /** `elapsed` ms since the fight began, `frames` the emulator has run in it, `menu` whether a
   *  choice menu is up now. */
  tick(elapsed: number, frames: number, menu: boolean, l: NetLimits = NET_LIMITS): Verdict {
    if (menu) this.seen = true;
    if (this.seen) return 'off';
    if (elapsed >= l.hardMs) return 'fire';
    return elapsed >= l.ms && frames >= l.frames ? 'fire' : 'wait';
  }
}

/** The net over a room that says I am fighting while my page has no fight up (and nothing else
 *  that would explain it: a question, a screen, a cast): the same minute, and it starts over
 *  whenever the page is occupied again. */
export class LostNet {
  private since = -1;

  tick(now: number, lost: boolean, l: NetLimits = NET_LIMITS): Verdict {
    if (!lost) { this.since = -1; return 'off'; }
    if (this.since < 0) this.since = now;
    return now - this.since >= l.ms ? 'fire' : 'wait';
  }

  /** Waiting since this time (-1 for not). */
  get waitingSince(): number { return this.since; }
}
