// Small deterministic pieces the match director (director.ts) builds its timing and
// its "random" choices from -- pulled out on their own because they are pure
// functions of a seed/index and are the easiest part of POK-222/223/224 to pin down
// in a test without a fake clock.

/** Mulberry32: the same small PRNG `bps.test.ts` uses for reproducible fixtures --
 *  reused here (rather than a second implementation) so a match seed produces the
 *  same deal/ring sequence on every client that runs it, deterministically, forever
 *  (no dependency on Math.random or a library). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
export const RING_RADII: readonly number[] = [15, 9, 7, 5, 3, 2, 0, -1];

/** True once the ring has reached `-1` ("everywhere") and has nowhere further to
 *  shrink -- the phase that stops director.ts's ring timer. */
export function isFinalRingPhase(ringIndex: number): boolean {
  return ringIndex >= RING_RADII.length - 1;
}
