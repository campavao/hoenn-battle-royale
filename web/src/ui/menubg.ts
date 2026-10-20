// The main menu's backdrop (HBR-30): a slow, soft pan over Hoenn, town to town in gym
// order. Cam, 2026-10-20: "instead of a black screen background, it's a slow pan over of
// the hoenn map ... (that is also slightly blurred)". A chunk of its own, with its map
// (tools/br/export-menu-pan.py), so main.js carries none of it.
import pan from '../data/menupan.json';
import type { EmeraldCanvas } from './emerald';

const MAPS = pan.maps as [string, number, number, number, number][];
const PATH = pan.path as [number, number][];
/** Pixels a second: a town to the next in half a minute or so. */
const SPEED = 24;
const LEGS = PATH.slice(1).map((p, i) => Math.hypot(p[0] - PATH[i][0], p[1] - PATH[i][1]));
const LENGTH = LEGS.reduce((a, b) => a + b, 0);

/** Where the camera's middle is `t` ms in: along the path and back again, so the tour
 *  never jumps. */
export function panAt(t: number): { x: number; y: number } {
  let s = ((t / 1000) * SPEED) % (2 * LENGTH);
  if (s > LENGTH) s = 2 * LENGTH - s;
  for (let i = 0; i < LEGS.length; i++) {
    if (s <= LEGS[i] || i === LEGS.length - 1) {
      const f = LEGS[i] ? Math.min(1, s / LEGS[i]) : 0;
      const [ax, ay] = PATH[i];
      const [bx, by] = PATH[i + 1];
      return { x: Math.round(ax + (bx - ax) * f), y: Math.round(ay + (by - ay) * f) };
    }
    s -= LEGS[i];
  }
  return { x: PATH[0][0], y: PATH[0][1] };
}

/** The maps under the whole canvas at `t`, softened and dimmed so the menu reads over
 *  them. */
export function paintPan(c: EmeraldCanvas, t: number, h: number): void {
  const cam = panAt(t);
  // The canvas's left edge, in its own space, and where that falls on the world.
  const left = -c.origin;
  const wx = cam.x - Math.floor(c.width / 2);
  const wy = cam.y - Math.floor(h / 2);
  c.setFilter('blur(1px)');
  for (const [id, mx, my, mw, mh] of MAPS) {
    const x0 = Math.max(mx, wx);
    const y0 = Math.max(my, wy);
    const x1 = Math.min(mx + mw, wx + c.width);
    const y1 = Math.min(my + mh, wy + h);
    if (x1 > x0 && y1 > y0) c.drawUiPicture(`/field-maps/MAP_${id}.png`, x0 - mx, y0 - my, x1 - x0, y1 - y0, left + x0 - wx, y0 - wy);
  }
  c.setFilter('none');
  c.fillRect({ x: left, y: 0, w: c.width, h }, '#101418', 0.45);
}
