// How smooth a match looked from this page (POK-376), as the one `jank` line a match the relay
// logs and play-log.mjs reads: snaps and stalls measured, so "the bots teleported" has a number.
//
// Spike B has no ghosts to pace: every page plays the same Room, each walker's own step rate
// and all, and a hash on the frames says if a page has left it. So what can still go wrong on
// the screen is a page that loaded the Room again (a resync jumps everybody) or one the frames
// stopped reaching. classic's own counters are the ROM's (match/jank.ts), for its ghosts.

export interface JankCounts {
  /** Seconds this page watched somebody else. */
  watched: number;
  /** Somebody in the world jumped: further in a look than walking goes, and no warp, FLY, ferry
   *  or drop to say why. */
  snaps: number;
  /** ...of which the one the camera was on. */
  cam: number;
  /** The Room loaded again from the relay (a gap, a hash that disagreed, too far behind). */
  lost: number;
  /** The Room stood still on a page that could see it, for at least STALL_MS... */
  stalls: number;
  /** ...the longest of them, in whole seconds. */
  longest: number;
  /** The hashes on the frames compared with this page's Room. */
  checks: number;
  /** ...and those that disagreed. */
  drifts: number;
}

/** Further than this in cells, in one look (a frame drawn), is no step or hop. The page's fastest
 *  catching up (CATCH_UP, four frames a frame) is well under one, and a step over the seams that
 *  don't meet is three (seamglide.ts, which draws it as a glide). */
export const SNAP_CELLS = 3;
/** Frames come 60 a second and a buffer's cushion hides a few: half a second is one you see. */
export const STALL_MS = 500;

/** Someone where the page has them. `m` is their mover: a Room that moves a trainer on purpose
 *  (FLY, the ferry, the drop) gives them a new one, a walk keeps it. */
export interface Seen { id: number; x: number; y: number; warp: boolean; m: unknown }

export class JankMeter {
  private readonly n: JankCounts = { watched: 0, snaps: 0, cam: 0, lost: 0, stalls: 0, longest: 0, checks: 0, drifts: 0 };
  private seen = new Map<number, { x: number; y: number; m: unknown }>();
  private tick = -1;
  private since = 0;
  private watchedMs = 0;
  private lastResyncs = 0;

  /** Everybody, once a frame drawn. `resyncs` is the link's count: a jump in the look a Room came
   *  in is that resync's, with new movers all round; it is still somebody seen jumping. */
  look(people: readonly Seen[], camera: number, resyncs: number): void {
    const resynced = resyncs !== this.lastResyncs;
    this.lastResyncs = resyncs;
    this.n.lost = resyncs;
    for (const p of people) {
      const was = this.seen.get(p.id);
      this.seen.set(p.id, { x: p.x, y: p.y, m: p.m });
      if (!was || p.warp || (was.m !== p.m && !resynced)) continue;
      if (Math.abs(p.x - was.x) + Math.abs(p.y - was.y) <= SNAP_CELLS) continue;
      this.n.snaps += 1;
      if (p.id === camera) this.n.cam += 1;
    }
  }

  /** The Room's frame now, and the page's clock. A hidden page draws nothing, and has its gap
   *  waived: nobody watched it. */
  clock(tick: number, now: number, hidden: boolean): void {
    if (hidden || this.tick < 0) { this.tick = tick; this.since = now; return; }
    if (tick === this.tick) return;
    const gap = now - this.since;
    if (gap >= STALL_MS) {
      this.n.stalls += 1;
      this.n.longest = Math.max(this.n.longest, Math.round(gap / 1000));
    }
    this.tick = tick;
    this.since = now;
  }

  /** `ms` more of watching somebody else. */
  watching(ms: number): void {
    this.watchedMs += ms;
    this.n.watched = Math.floor(this.watchedMs / 1000);
  }

  /** The frames' hash checks so far, off the link. */
  checked(checks: number, drifts: number): void {
    this.n.checks = checks;
    this.n.drifts = drifts;
  }

  counts(): JankCounts { return { ...this.n }; }
}
