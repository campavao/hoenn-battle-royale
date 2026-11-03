// Spike B's MAP, what the page's own (mapwindow.ts) asks of this world's ring: which section
// and cell a tile is on, where the safe place is, and whether a pixel of the MAP's picture
// lies in the fog. The match fogs whole MAP cells from a ring in sections, and this world's
// ring is in tiles (room.ts), smaller than a town, so each grid pixel is taken back to the
// tile it shows.

import type { Ring, Room } from './shared/room';
import type { Spot, WorldMap } from '../src/bots/world';
import { text, type RomArt } from './romart';
import { LEADERS } from './shared/gyms';

/** region_map.c: the grid, MAP_WIDTH x MAP_HEIGHT cells of 8 pixels from BG cell (1, 2). */
export const CELL = 8;
export const GRID_X = 1 * CELL;
export const GRID_Y = 2 * CELL;
export const GRID_W = 28;
export const GRID_H = 15;
interface Section { id: number; x: number; y: number; w: number; h: number; letters: number[] }

/** A place on the page's MAP (mapwindow.ts): its section and what it says. */
export interface MapPlace { id: number; name: string }
/** What the page's MAP marks, in the picture's pixels. */
export interface MapPlots {
  gyms: { x: number; y: number; gfx: number }[];
  events: { x: number; y: number; taken: boolean }[];
  me: { x: number; y: number; gfx: number } | null;
}

export class RingMap {
  /** What it reads that the ROM's symbols must name. */
  static readonly SYMBOLS = ['gRegionMapEntries', 'gMapGroups'];
  /** Each grid pixel's point in the plane layout() places the maps in, in tiles: x, y. */
  private plane = new Float32Array(GRID_W * CELL * GRID_H * CELL * 2);
  private sections = new Map<string, Section>();
  /** The SAFARI ZONE's own section: no place of the ring's, but where the drop's fly map
   *  opens (the Zone is where everybody stands when it comes up). */
  private zone: number | undefined;
  private zoneAt: Section | undefined;

  constructor(private room: Room, art: RomArt) {
    const ids = new Map<number, Section>();
    for (const key of room.places.keys()) {
      const m = room.maps.get(key)!;
      const id = art.mapsec(m.group, m.num);
      let s = ids.get(id);
      if (!s) { s = { id, ...art.section(id) }; ids.set(id, s); }
      this.sections.set(m.id, s);
    }
    const zone = [...room.maps.values()].find((m) => m.id.startsWith('MAP_SAFARI_ZONE_'));
    if (zone) {
      this.zone = art.mapsec(zone.group, zone.num);
      this.zoneAt = { id: this.zone, ...art.section(this.zone) };
    }
    this.lay();
  }

  /** Every grid pixel to a tile: through the map whose section holds it, scaled the way
   *  region_map.c scales a map to its section; a pixel no map holds (open sea, the
   *  frame's corners) through the straight-line fit of the ones that are held. */
  private lay(): void {
    const W = GRID_W * CELL;
    const held = new Uint8Array(W * GRID_H * CELL);
    for (const [id, s] of this.sections) {
      const m = this.room.maps.get(id)!;
      const p = this.room.places.get(id);
      if (!p) continue;
      for (let py = s.y * CELL; py < (s.y + s.h) * CELL && py < GRID_H * CELL; py++) {
        for (let px = s.x * CELL; px < (s.x + s.w) * CELL && px < W; px++) {
          const i = py * W + px;
          if (held[i]) continue;
          held[i] = 1;
          this.plane[i * 2] = p.gx + ((px + 0.5) / CELL - s.x) / s.w * m.w;
          this.plane[i * 2 + 1] = p.gy + ((py + 0.5) / CELL - s.y) / s.h * m.h;
        }
      }
    }
    // Least squares, x and y each a + b u + c v over the held pixels.
    const n = new Float64Array(9), bx = new Float64Array(3), by = new Float64Array(3);
    for (let i = 0; i < held.length; i++) {
      if (!held[i]) continue;
      const f = [1, i % W, Math.floor(i / W)];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) n[r * 3 + c] += f[r] * f[c];
        bx[r] += f[r] * this.plane[i * 2];
        by[r] += f[r] * this.plane[i * 2 + 1];
      }
    }
    const fx = solve3(n, bx), fy = solve3(n, by);
    for (let i = 0; i < held.length; i++) {
      if (held[i]) continue;
      const u = i % W, v = Math.floor(i / W);
      this.plane[i * 2] = fx[0] + fx[1] * u + fx[2] * v;
      this.plane[i * 2 + 1] = fy[0] + fy[1] * u + fy[2] * v;
    }
  }

  /** The map a point of the plane is on. */
  private mapAt(x: number, y: number): WorldMap | undefined {
    for (const [id, p] of this.room.places) {
      const m = this.room.maps.get(id);
      if (m && x >= p.gx && x < p.gx + m.w && y >= p.gy && y < p.gy + m.h) return m;
    }
    return undefined;
  }

  /** The place the ring closes on, in the ROM's letters: the centre's section. None while
   *  the first ring is only announced (br_map.c BrMap_Prompt: it names nowhere until it
   *  closes), nor on the last, which has no inside. */
  private placeLetters(ring: Ring): number[] {
    if (ring.r === Infinity || ring.r < 0) return [];
    const m = this.mapAt(ring.cx, ring.cy);
    return m ? this.sections.get(m.id)!.letters : [];
  }

  /** Map `id`'s place, as the page says it: '' for one it has not got. */
  placeOf(id: string): string {
    const s = this.sections.get(id);
    return s ? text(s.letters) : '';
  }

  /** The place, as the page says it: '' for none. */
  place(ring = this.room.ring()): string {
    return text(this.placeLetters(ring));
  }

  /** Where `spot` is outdoors: itself, or for a building or the Safari the cell its
   *  anchor sits on (room.ts's anchors); undefined for neither. */
  private outdoors(spot: Spot): Spot | undefined {
    if (this.room.places.has(spot.map)) return spot;
    const a = this.room.anchors.get(spot.map);
    const m = a && this.mapAt(a.gx, a.gy);
    const p = m && this.room.places.get(m.id);
    return m && p ? { map: m.id, x: Math.floor(a.gx - p.gx), y: Math.floor(a.gy - p.gy) } : undefined;
  }

  /** The outdoor maps a MAP section `id` covers (the drop's choice, br_pick.c), in id
   *  order; none for a section no place is in. */
  mapsIn(id: number): string[] {
    return [...this.sections].filter(([, s]) => s.id === id).map(([m]) => m).sort();
  }

  /** The section and cell a trainer on `at` stands in (indoors, the building's door; nowhere
   *  known, Littleroot). */
  private cell(at: Spot): { mapsec: number; cellX: number; cellY: number } {
    if (at.map.startsWith('MAP_SAFARI_ZONE_') && this.zone !== undefined) return { mapsec: this.zone, cellX: 0, cellY: 0 };
    const spot = this.outdoors(at) ?? { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 };
    const s = this.sections.get(spot.map)!;
    const m = this.room.maps.get(spot.map)!;
    const along = (at: number, size: number, cells: number) => Math.min(cells - 1, Math.floor((at * cells) / size));
    return { mapsec: s.id, cellX: along(spot.x, m.w, s.w), cellY: along(spot.y, m.h, s.h) };
  }

  /** Where a trainer on `at` is on the MAP's picture, in its pixels: the middle of the cell. */
  pixelOf(at: Spot): { x: number; y: number } {
    const l = this.cell(at);
    const s = [...this.sections.values(), ...(this.zoneAt ? [this.zoneAt] : [])].find((q) => q.id === l.mapsec);
    return { x: GRID_X + ((s?.x ?? 0) + l.cellX) * CELL + CELL / 2, y: GRID_Y + ((s?.y ?? 0) + l.cellY) * CELL + CELL / 2 };
  }

  /** The place on cell (cx, cy) of the grid; null for open sea. */
  placeAt(cx: number, cy: number): MapPlace | null {
    const inIt = (s: Section) => cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h;
    for (const s of this.sections.values()) if (inIt(s)) return { id: s.id, name: text(s.letters) };
    return this.zoneAt && inIt(this.zoneAt) ? { id: this.zoneAt.id, name: text(this.zoneAt.letters) } : null;
  }

  /** The cell of the grid a trainer on `at` is on. */
  cellOf(at: Spot): { x: number; y: number } {
    const p = this.pixelOf(at);
    return { x: Math.floor((p.x - GRID_X) / CELL), y: Math.floor((p.y - GRID_Y) / CELL) };
  }

  /** The marks the page's MAP draws: the leaders the room has seen beaten, this round's events
   *  (grey once their legendary is taken), and me. */
  plots(me: { spot: Spot; gfx: number } | null): MapPlots {
    const middle = (s: Section) => ({ x: GRID_X + (s.x + s.w / 2) * CELL, y: GRID_Y + (s.y + s.h / 2) * CELL });
    const room = this.room;
    const gyms = LEADERS.flatMap((l) => {
      const at = room.bossDown(l.n) ? this.outdoors({ map: l.map, x: 0, y: 0 }) : undefined;
      const s = at && this.sections.get(at.map);
      return s ? [{ ...middle(s), gfx: l.gfx[0] }] : [];
    });
    const events = room.events.flatMap((e) => {
      const at = this.outdoors({ map: e.map, x: e.x, y: e.y });
      const s = at && this.sections.get(at.map);
      return s ? [{ ...middle(s), taken: !!e.species && (!room.spills.has(e.key) || room.picked.has(e.key)) }] : [];
    });
    return { gyms, events, me: me ? { ...this.pixelOf(me.spot), gfx: me.gfx } : null };
  }

  /** Whether the MAP's pixel (x, y) lies in the fog of `ring`. */
  fogAt(x: number, y: number, ring = this.room.ring()): boolean {
    if (ring.last) return true;
    if (ring.r < 0 || ring.r === Infinity) return false;
    const W = GRID_W * CELL, gx = x - GRID_X, gy = y - GRID_Y;
    if (gx < 0 || gy < 0 || gx >= W || gy >= GRID_H * CELL) return false;
    const i = gy * W + gx;
    return Math.hypot(this.plane[i * 2] - ring.cx, this.plane[i * 2 + 1] - ring.cy) > ring.r;
  }

  /** Which way the safe place is from `spot`, one or two arrows, outside the ring only
   *  (br_ring.c BrRing_SafeWay): a way less than half the other is left off. */
  way(spot: Spot, ring = this.room.ring()): string {
    if (ring.r === Infinity || ring.r < 0 || !this.room.inFog(spot, ring)) return '';
    // Indoors, from the building's anchor on the plane (room.ts inFog's own point).
    const p = this.room.places.get(spot.map), a = p ? undefined : this.room.anchors.get(spot.map);
    if (!p && !a) return '';
    const x = p ? p.gx + spot.x + 0.5 : a!.gx, y = p ? p.gy + spot.y + 0.5 : a!.gy;
    const dx = ring.cx - x, dy = ring.cy - y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    let out = '';
    if (ay > 0 && 2 * ay >= ax) out += dy < 0 ? '↑' : '↓';
    if (ax > 0 && 2 * ax >= ay) out += dx < 0 ? '←' : '→';
    return out;
  }

}

/** a x = b for a 3x3 `a` (row-major), by Cramer's rule. */
function solve3(a: Float64Array, b: Float64Array): number[] {
  const det = (m: ArrayLike<number>) =>
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const d = det(a);
  return [0, 1, 2].map((c) => {
    const m = Array.from(a);
    for (let r = 0; r < 3; r++) m[r * 3 + c] = b[r];
    return det(m) / d;
  });
}
