// Hoenn's maps don't quite lie flat. The field places them in one plane by their seams, and the
// loops round the middle of the map close two tiles out: the GBA, with one map at a time, never
// sees it. One seam is left open for that (room.ts LOOSE_SEAM), and here a step over it jumped its
// trainer, and a camera on them, two tiles. Drawn, the jump is a glide over a step's time. The Room
// knows nothing of it: only where the page puts them.

export interface PlacedMap {
  m: { id: string; w: number; h: number; seams: readonly { to: string; dir: string; offset: number }[] };
  gx: number;
  gy: number;
}

/** A step's 16 frames. */
export const GLIDE_FRAMES = 16;

/** How far (tiles) `to` lies in the plane from where its seam with `from` says it should; null for
 *  no such seam, or one that meets. */
export function seamOff(from: PlacedMap, to: PlacedMap): { x: number; y: number } | null {
  const s = from.m.seams.find((q) => q.to === to.m.id);
  if (!s) return null;
  let gx = from.gx, gy = from.gy;
  if (s.dir === 'north') { gx += s.offset; gy -= to.m.h; }
  else if (s.dir === 'south') { gx += s.offset; gy += from.m.h; }
  else if (s.dir === 'west') { gx -= to.m.w; gy += s.offset; }
  else { gx += from.m.w; gy += s.offset; }
  return gx === to.gx && gy === to.gy ? null : { x: to.gx - gx, y: to.gy - gy };
}

const NONE = { x: 0, y: 0 } as const;

/** Who is gliding off such a seam, and from how far. */
export class SeamGlide {
  private maps = new Map<number, string>();
  private on = new Map<number, { x: number; y: number; start: number }>();

  /** Someone on `map` at `frame`; `off` asks the plane about a change of map. A warp is no seam,
   *  and `seamOff` has none to find. */
  look(id: number, map: string, frame: number, off: (from: string, to: string) => { x: number; y: number } | null): void {
    const was = this.maps.get(id);
    if (was === map) return;
    this.maps.set(id, map);
    const e = was === undefined ? null : off(was, map);
    if (e) this.on.set(id, { x: e.x, y: e.y, start: frame });
  }

  /** Tiles to draw them away from where they stand, at `frame`: all of the jump, back to none. */
  offset(id: number, frame: number): { x: number; y: number } {
    const g = this.on.get(id);
    if (!g) return NONE;
    const left = 1 - (frame - g.start) / GLIDE_FRAMES;
    if (left <= 0) { this.on.delete(id); return NONE; }
    return { x: -g.x * left, y: -g.y * left };
  }
}
