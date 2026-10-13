// A room whose host has walked away from it comes off the list.
//
// Between matches a room waits on its host's START (READY UP in a room that starts
// itself), and a host who tabs out keeps the room -- on purpose, so it can paste the code
// somewhere. But a tab left open for hours is a room LOBBIES keeps offering and QUICK PLAY
// keeps seating strangers in, with nobody to start it (the play log, 2026-10-13: a room
// kept open six hours by one idle tab, and two joins that left again inside twenty
// seconds). So after a while hidden the host takes its room off the list, and puts it
// back the moment it is looked at again. A code still opens the door: the friend the code
// was pasted to gets in either way. An heir who takes the room over while it is off the
// list inherits it that way, with its door saying so, one press from open again.
//
// No page here: the page's state is handed in, so vitest can drive it on a fake clock.

export interface AwayDoorOptions {
  /** How long hidden before the room comes off the list. */
  awayMs: number;
  /** How often, once that long has passed, the room is looked at again: a match can end,
   *  or a room be handed to this page, while it is still hidden. */
  pollMs: number;
  /** This page is the host of a room that is waiting on it to start a match. */
  waitingOnUs: () => boolean;
  /** The room is listed now (the roster's `open`). */
  listed: () => boolean;
  setOpen: (open: boolean) => void;
}

export class AwayDoor {
  private poll: ReturnType<typeof setInterval> | null = null;
  private unlisted = false;

  constructor(private readonly opts: AwayDoorOptions) {}

  hidden(): void {
    if (this.poll || this.unlisted) return;
    const since = Date.now();
    this.poll = setInterval(() => {
      if (Date.now() - since < this.opts.awayMs) return;
      if (!this.opts.waitingOnUs() || !this.opts.listed()) return;
      this.stop();
      this.unlisted = true;
      this.opts.setOpen(false);
    }, this.opts.pollMs);
  }

  /** Back. Only a room this took off the list goes back on it, and only while ours:
   *  a host who handed the room on has no door to open. */
  shown(isHost: boolean): void {
    this.stop();
    if (!this.unlisted) return;
    this.unlisted = false;
    if (isHost) this.opts.setOpen(true);
  }

  private stop(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }
}
