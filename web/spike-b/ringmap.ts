// Spike B's MAP: the match's own (MENU_ACTION_BR_MAP, br_map.c) with this world's ring on it.
//
// The hidden ROM draws the MAP itself -- frame, gym heads, cursor, the section names, the
// "Safe: <place>" prompt -- standing where this world's trainer stands (look()). Only the
// fog is the page's: the match fogs whole MAP cells from a ring in sections, and this
// world's ring is in tiles (room.ts), smaller than a town. So the ROM is told nothing is
// fogged and the page lays br_map.c's fog over its picture a pixel at a time, each grid
// pixel taken back to the tile it shows. Each fogged pixel is worked out as the GBA works
// out the match's: the fog's colour from the ROM's own palette (it is loaded, faded with
// the rest, whatever the ring), blended 10/16 over 6/16 of the picture's pixel; solid
// fog where a sprite under the fog's layer shows (a gym head, the player's icon: BG1
// blends only with BG2 and the backdrop); nothing over the cursor, which is above it. The
// same 48-on 48-off blink on what the next ring takes. Fog everywhere is the ROM's own
// (r = -1), whole cells as in the match.

import type { Ring, Room } from './shared/room';
import type { Spot, WorldMap } from '../src/bots/world';
import { text, type RomArt } from './romart';
import type { MapLook } from './rom';
import type { Emulator } from '../src/emu';

/** region_map.c: the grid, MAP_WIDTH x MAP_HEIGHT cells of 8 pixels from BG cell (1, 2). */
const CELL = 8;
const GRID_X = 1 * CELL;
const GRID_Y = 2 * CELL;
const GRID_W = 28;
const GRID_H = 15;
/** br_map.c: the fog in BG palette 10 (BR_FOG_PLTT), 10/16 of it over 6/16 of the map
 *  (BR_FOG_EVA, BR_FOG_EVB), on BG1, priority 1 (region_map.c sFlyMapBgTemplates); and
 *  BR_BLINK_FRAMES, the blink's 48 frames on and 48 off. */
const FOG_COLOUR = 10 * 16 + 1;
const EVA = 10;
const EVB = 6;
const FOG_PRIORITY = 1;
const BLINK_FRAMES = 96;
/** struct Main's oamBuffer (include/main.h): 128 OamData of 8 bytes, the OAM the next
 *  VBlank copies. The OBJ palettes follow the BG ones in gPlttBufferFaded. */
const OAM_BUFFER = 0x38;
const OBJ_PLTT = 256;
/** OamData's shape and size, to pixels (include/constants/oam.h's SPRITE_SHAPE/SIZE). */
const OBJ_DIMS = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];
/** The ring as the ROM should draw it: nothing fogged (127 sections), or all of it. */
const R_NONE = 127;
const R_ALL = -1;

interface Section { id: number; x: number; y: number; w: number; h: number; letters: number[] }

export class RingMap {
  /** What it reads that the ROM's symbols must name. */
  static readonly SYMBOLS = ['gRegionMapEntries', 'gPlttBufferFaded', 'gMain', 'gMapGroups'];
  /** Each grid pixel's point in the plane layout() places the maps in, in tiles: x, y. */
  private plane = new Float32Array(GRID_W * CELL * GRID_H * CELL * 2);
  private sections = new Map<string, Section>();
  private img: ImageData | null = null;
  private px = new Uint32Array(240 * 160);
  private lcd = new Uint8ClampedArray(240 * 160 * 4);
  private sym: (name: string) => number;

  constructor(private room: Room, art: RomArt) {
    this.sym = art.sym;
    const ids = new Map<number, Section>();
    for (const key of room.places.keys()) {
      const m = room.maps.get(key)!;
      const id = art.mapsec(m.group, m.num);
      let s = ids.get(id);
      if (!s) { s = { id, ...art.section(id) }; ids.set(id, s); }
      this.sections.set(m.id, s);
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

  /** The place, as the page says it: '' for none. */
  place(ring = this.room.ring()): string {
    return text(this.placeLetters(ring));
  }

  /** What the ROM opens the MAP on, for a trainer standing on `spot`. */
  look(spot: Spot, ring = this.room.ring()): MapLook {
    const s = this.sections.get(spot.map)!;
    const m = this.room.maps.get(spot.map)!;
    const cell = (at: number, size: number, cells: number) => Math.min(cells - 1, Math.floor((at * cells) / size));
    return {
      mapsec: s.id,
      cellX: cell(spot.x, m.w, s.w),
      cellY: cell(spot.y, m.h, s.h),
      r: ring.last ? R_ALL : R_NONE,
      place: this.placeLetters(ring),
    };
  }

  /** Which way the safe place is from `spot`, one or two arrows, outside the ring only
   *  (br_ring.c BrRing_SafeWay): a way less than half the other is left off. */
  way(spot: Spot, ring = this.room.ring()): string {
    if (ring.r === Infinity || ring.r < 0 || !this.room.inFog(spot, ring)) return '';
    const p = this.room.places.get(spot.map)!;
    const dx = ring.cx - (p.gx + spot.x + 0.5), dy = ring.cy - (p.gy + spot.y + 0.5);
    const ax = Math.abs(dx), ay = Math.abs(dy);
    let out = '';
    if (ay > 0 && 2 * ay >= ax) out += dy < 0 ? '↑' : '↓';
    if (ax > 0 && 2 * ax >= ay) out += dx < 0 ? '←' : '→';
    return out;
  }

  /** The fog on `canvas`, over the ROM's MAP on `emu`, each animation frame until the
   *  returned function is called. */
  cover(canvas: HTMLCanvasElement, emu: Emulator): () => void {
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const each = (t: number) => {
      this.paint(ctx, emu, Math.floor((t * 60) / 1000));
      raf = requestAnimationFrame(each);
    };
    raf = requestAnimationFrame(each);
    canvas.classList.add('on');
    return () => {
      cancelAnimationFrame(raf);
      canvas.classList.remove('on');
    };
  }

  private paint(ctx: CanvasRenderingContext2D, emu: Emulator, frame: number): void {
    this.img ??= new ImageData(240, 160);
    new Uint32Array(this.img.data.buffer).set(this.fog(emu, frame));
    ctx.putImageData(this.img, 0, 0);
  }

  /** One frame of the fog over the ROM's picture, as the GBA screen's pixels (ABGR, 0
   *  where the picture shows through); `frame` paces the blink. */
  fog(emu: Pick<Emulator, 'read' | 'lcdPixels'>, frame: number, ring = this.room.ring()): Uint32Array {
    const px = this.px;
    px.fill(0);
    const blink = frame % BLINK_FRAMES < BLINK_FRAMES / 2;
    const next = ring.next;
    const soonAt = blink && next !== undefined && next !== Infinity ? next : Infinity;
    // Fog everywhere is the ROM's; with no ring yet and nothing to blink, there is none.
    if (ring.r >= 0 && (ring.r !== Infinity || soonAt !== Infinity) && emu.lcdPixels(this.lcd)) {
      const pltt = this.sym('gPlttBufferFaded');
      const fog = emu.read(pltt + FOG_COLOUR * 2, 16);
      const sprites = this.sprites(emu);
      const W = GRID_W * CELL;
      for (let i = 0; i < W * GRID_H * CELL; i++) {
        const d = Math.hypot(this.plane[i * 2] - ring.cx, this.plane[i * 2 + 1] - ring.cy);
        if (!(d > ring.r) && !(soonAt < 0 || d > soonAt)) continue;
        const x = GRID_X + (i % W), y = GRID_Y + Math.floor(i / W);
        const at = y * 240 + x;
        const [r, g, b] = [this.lcd[at * 4] >> 3, this.lcd[at * 4 + 1] >> 3, this.lcd[at * 4 + 2] >> 3];
        const over = topSprite(sprites, x, y, (r | (g << 5) | (b << 10)));
        if (over !== null && over <= FOG_PRIORITY) continue;
        const mix = (c: number, shift: number) => {
          const f = (fog >> shift) & 31;
          const v = over !== null ? f : Math.min(31, (EVA * f + EVB * c) >> 4);
          return (v << 3) | (v >> 2);
        };
        px[at] = ((0xff << 24) | (mix(b, 10) << 16) | (mix(g, 5) << 8) | mix(r, 0)) >>> 0;
      }
    }
    return px;
  }

  /** The sprites on screen, from the OAM the game last laid out, each with its colours. */
  private sprites(emu: Pick<Emulator, 'read'>): Sprite[] {
    const oam = this.sym('gMain') + OAM_BUFFER;
    const pltt = this.sym('gPlttBufferFaded');
    const out: Sprite[] = [];
    for (let k = 0; k < 128; k++) {
      const a0 = emu.read(oam + k * 8, 16), a1 = emu.read(oam + k * 8 + 2, 16), a2 = emu.read(oam + k * 8 + 4, 16);
      const affine = (a0 >> 8) & 3;
      if (affine === 2) continue; // hidden
      const shape = (a0 >> 14) & 3;
      if (shape === 3) continue;
      const [w, h] = OBJ_DIMS[shape][(a1 >> 14) & 3].map((n) => (affine === 3 ? n * 2 : n));
      let x = a1 & 0x1ff, y = a0 & 0xff;
      if (x >= 240) x -= 512;
      if (y >= 160) y -= 256;
      const pal = (a2 >> 12) & 15;
      const colours = new Set<number>();
      for (let c = 1; c < 16; c++) colours.add(emu.read(pltt + (OBJ_PLTT + pal * 16 + c) * 2, 16) & 0x7fff);
      out.push({ x, y, w, h, priority: (a2 >> 10) & 3, colours });
    }
    return out;
  }
}

interface Sprite { x: number; y: number; w: number; h: number; priority: number; colours: Set<number> }

/** The priority of the sprite that shows at (x, y), or null for none: the first in OAM
 *  order, among those of the lowest priority, whose box holds the pixel and whose colours
 *  have the pixel's (the picture has no layers left to ask; a map pixel the very colour
 *  of a sprite over it is taken for the sprite's). */
function topSprite(sprites: readonly Sprite[], x: number, y: number, colour: number): number | null {
  let best: number | null = null;
  for (const s of sprites) {
    if (x < s.x || x >= s.x + s.w || y < s.y || y >= s.y + s.h) continue;
    if (best !== null && s.priority >= best) continue;
    if (s.colours.has(colour)) best = s.priority;
  }
  return best;
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
