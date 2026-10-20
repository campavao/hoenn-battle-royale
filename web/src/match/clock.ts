// Small deterministic pieces the match director (director.ts) builds its timing and
// its "random" choices from -- pulled out on their own because they are pure
// functions of a seed/index and are the easiest part of POK-222/223/224 to pin down
// in a test without a fake clock.

/** Mulberry32: the same small PRNG `bps.test.ts` uses for reproducible fixtures --
 *  reused here (rather than a second implementation) so a match seed produces the
 *  same deal/ring sequence on every client that runs it, deterministically, forever
 *  (no dependency on Math.random or a library). */
export function mulberry32(seed: number, state?: number): Rng {
  let a = (state ?? seed) | 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.state = () => a;
  return rng;
}

/** A draw that can say where it has got to, so a host back from a reload (HBR-20) picks
 *  the sequence up where it left off: `mulberry32(0, rng.state())` is the same draw. */
export interface Rng {
  (): number;
  state(): number;
}

/** A uniform integer in `[0, length)` off the given rng -- `Math.floor(rng() * n)`,
 *  named so every "pick one of N" call in director.ts reads the same way. `length`
 *  must be > 0. */
export function pickIndex(rng: () => number, length: number): number {
  return Math.min(length - 1, Math.floor(rng() * length));
}

/** The ring's radius (in region-map sections) at each phase, in shrink order --
 *  DESIGN.md's fog never clamps, so the last entry is `-1` ("everywhere"), not 0.
 *  The ticket's own list writes phase 6 as "1.5 -> use 2" (a fog radius has to be a
 *  whole number of sections); this array already carries that rounding. `phase` in
 *  a RingMsg is this array's index + 1 (1-based, matching wire.ts's `phase: 1..64`). */
/** The first ring is an announcement, not a fog: Hoenn's region map is 28 sections
 *  wide, so 28 reaches every section from any centre and nobody drops into the fog
 *  (Cam, 2026-09-18, Mossdeep "already covered in the Weezing fog": with 15 first, a
 *  western centre put the whole east outside from the first second). The first fog
 *  comes with the first shrink. */
export const RING_RADII: readonly number[] = [28, 15, 9, 7, 5, 3, 2, 0, -1];

/** True once the ring has reached `-1` ("everywhere") and has nowhere further to
 *  shrink -- the phase that stops director.ts's ring timer. */
export function isFinalRingPhase(ringIndex: number): boolean {
  return ringIndex >= RING_RADII.length - 1;
}

/** The radius the ring shrinks to after phase `ringIndex`, for the MAP's preview of it
 *  (Cam, 2026-10-18: what the fog takes next blinks on the MAP);
 *  none on the last phase, which has nowhere further to go. */
export function nextRingRadius(ringIndex: number): number | undefined {
  return isFinalRingPhase(ringIndex) ? undefined : RING_RADII[ringIndex + 1];
}

/** The ring in the strip: the place it closes on, which is the one place the fog never
 *  reaches. "RING 15 (DEWFORD TOWN)" read as the zone that had already closed, or as
 *  where we were (Cam's 2026-10-14 play-test, POK-359), so it says SAFE. The last
 *  ring's -1 is "everywhere" (RING_RADII), which read as "RING -1" for the whole
 *  endgame (2026-10-12 match video). */
export function ringLabel(r: number | undefined, place: string | undefined): string {
  if (r !== undefined && r < 0) return 'FINAL FOG';
  // The first ring names nowhere until it closes (feedback #23): the fog, not "SAFE: ?".
  return place ? `SAFE: ${place}` : 'FOG';
}

/** The strip once the match is decided (10-19 play-test #27): "P1 WINS" was the seat
 *  number of the player reading it, because the host's own roster entry has no name.
 *  Our own win says so; anybody else's names them. No seat is a draw. */
export function winLabel(winner: number | undefined, me: number | null, nameOf: (seat: number) => string): string {
  if (winner === undefined) return 'DRAW';
  return winner === me ? 'YOU WIN' : `${nameOf(winner)} WINS`;
}
