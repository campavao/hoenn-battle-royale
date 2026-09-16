// Is this place inside the fog ring? (POK-224, used by POK-236's bots.)
//
// A port of `BrRing_SectionInside` in `src/br/br_ring.c`, kept here so the page and the
// ROM answer the same question the same way. A section is a rectangle on the region
// map, so the test is against the point of that rectangle nearest the ring's centre --
// a long route counts as inside the moment any part of it is, which is what the ROM's
// fog and bleed already do to the player standing on it.
import type { RegionSection } from './director';

export interface RingCircle {
  sx: number;
  sy: number;
  /** Radius in region-map sections. Negative is the last phase: fog everywhere. */
  r: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sectionInside(section: RegionSection | undefined, ring?: RingCircle): boolean {
  if (!ring) return true; // no ring yet: everywhere is still fine
  if (ring.r < 0) return false; // the last phase closes on everything
  if (!section) return false; // off the region map -- a cave interior, say
  const nx = clamp(ring.sx, section.x, section.x + section.w - 1);
  const ny = clamp(ring.sy, section.y, section.y + section.h - 1);
  const dx = nx - ring.sx;
  const dy = ny - ring.sy;
  return dx * dx + dy * dy <= ring.r * ring.r;
}
