// The field's drawing past the ROM's picture that the first screen does without: roof
// covers over the people, the maps two seams away over the band, the wild patches' marks.
// A chunk of its own, fetched as FieldView starts (main.js budget, vite.config.ts): until
// it lands the field draws as it did before them.
import { decodeGrid, isTallGrass, isWater, type WorldMap } from './bots/world';
import { PATCH_KEY_BASE, dealPatches, loadPatches, type PatchTable } from './bots/patches';
import { MATCH_SEED } from './field-ghosts';
import { HOENN } from './bots/hoenn';
import type { Band, Emulator } from './emu';
import { GBA_H, GBA_W, PATCH_MAP, PATCH_MAX, PATCH_SPRITE_IDS, PATCH_TAKEN_SIZE, SPRITE_COUNT, bandClip, lcdOrigin, neighbours, wideRing, type Camera, type FieldSprite, type PatchMark, type Reached } from './field';
import spritesData from './data/sprites.json';

const TILE = 16;
const SHEETS = spritesData as Record<string, { w: number; h: number; frames: number }>;

/** What these need of the FieldView drawing them. */
export interface Painter {
  layout(): { lcdCol: number; lcdRow: number; cols: number; rows: number };
  image(id: string, dir?: string): HTMLImageElement | null;
  sprites(ctx: CanvasRenderingContext2D, sprites: FieldSprite[]): boolean;
  scratch(doc: Document): HTMLCanvasElement;
}

export type Mark = PatchMark & { at: { x: number; y: number } };

/** The marks of the patches nobody has taken on `map` under `seed`, in its own pixels. */
export function patchMarks(table: PatchTable, map: WorldMap, seed: number, taken: (key: number) => boolean, drawn: (i: number) => boolean = () => false): PatchMark[] {
  return dealPatches(table, map.id, map, seed).flatMap((p, i) => {
    if (taken(p.key)) return [];
    const sheet = isWater(map, p.x, p.y) ? 'patch-water' : isTallGrass(map, p.x, p.y) ? 'patch-tall-grass' : 'patch-shadow';
    return [{ map: map.id, x: p.x * TILE, y: p.y * TILE + (sheet === 'patch-shadow' ? TILE / 2 : 0), sheet, drawn: drawn(i) } as PatchMark];
  });
}

/** The marks on every map in `reached`, `at` in map pixels of the map we are on. `taken`
 *  is gBrPatchTaken's bytes; `ids` the sprites the ROM drew its own map's patches with
 *  when `ours`. */
export function dealMarks(table: PatchTable, reached: readonly Reached[], seed: number, taken: Uint8Array, ours: boolean, ids: Uint8Array): Mark[] {
  const isTaken = (key: number) => {
    const n = key - PATCH_KEY_BASE;
    return n >= 0 && n < taken.length * 8 && ((taken[n >> 3] >> (n & 7)) & 1) !== 0;
  };
  const out: Mark[] = [];
  for (const r of reached) {
    const drawn = r.hops === 0 && ours ? (i: number) => ids[i] < SPRITE_COUNT : undefined;
    for (const m of patchMarks(table, r.map, seed, isTaken, drawn)) out.push({ ...m, at: { x: m.x + r.x, y: m.y + r.y } });
  }
  return out;
}

/** The wild patches' marks on every map the view reaches (POK-431: "the indicator that a
 *  Pokémon was here did not appear until I was in the area"), dealt the way each ROM
 *  deals them (bots/patches.ts) and taken by gBrPatchTaken. Nothing until patches.json
 *  is in; `loaded` is called when it lands. */
export class Marks {
  private table: PatchTable | null = null;
  private asked = false;
  private memo: { reached: readonly Reached[]; key: string; marks: Mark[] } | null = null;

  /** `match`, `takenAt`, `patch`: gBrMatch, gBrPatchTaken, gBrPatch; `ref` the map we
   *  are on as (group << 8) | num. */
  of(emu: Emulator, match: number, takenAt: number, patch: number, ref: number, reached: readonly Reached[], loaded: () => void): Mark[] {
    if (!this.table) {
      if (!this.asked) {
        this.asked = true;
        void loadPatches().then((t) => {
          this.table = t;
          loaded();
        }, () => {});
      }
      return [];
    }
    const seed = emu.read(match + MATCH_SEED, 32) >>> 0;
    if (seed === 0) return [];
    const taken = emu.bytes(takenAt, PATCH_TAKEN_SIZE);
    const ours = emu.read(patch + PATCH_MAP, 16) === ref;
    const ids = emu.bytes(patch + PATCH_SPRITE_IDS, PATCH_MAX);
    // Asked every frame and the same nearly always: dealt again only when the maps in
    // view, the taken bits or the ROM's own drawn patches change.
    const key = `${seed}:${ours ? ids.join(',') : '-'}:${taken.join(',')}`;
    if (this.memo && this.memo.reached === reached && this.memo.key === key) return this.memo.marks;
    const marks = dealMarks(this.table, reached, seed, taken, ours, ids);
    this.memo = { reached, key, marks };
    return marks;
  }
}

/** Marks at their first frame, onto a canvas whose top-left is map pixel (ox, oy). */
export function drawMarks(p: Painter, ctx: CanvasRenderingContext2D, marks: readonly Mark[], ox: number, oy: number): boolean {
  let complete = true;
  for (const m of marks) {
    const img = p.image(m.sheet, 'field-sprites');
    if (img) ctx.drawImage(img, m.at.x - ox, m.at.y - oy);
    else complete = false;
  }
  return complete;
}

/** The people under what stands over them (POK-443): drawn on a canvas of their own,
 *  the maps' covers (render-maps.py: the top layer of every metatile that puts it on
 *  BG1, a roof, a tree's crown) cut out of them, and that laid on. Past the picture the
 *  page drew a bot on a roof the ROM would have put him behind ("he is not obeying the
 *  Z index"). A cover still on its way covers nobody, and is drawn again when it lands. */
/** At most this many people go to the core a frame (HBR-27). */
const CORE_PEOPLE_MAX = 64;
const CORE_HEADER = 8;
const CORE_ENTRY = 16;

/** One of tileset_anims.c's animations of a town's own tiles, as its QueueAnimTiles_*
 *  call reads: `frames` (a pointer array) shown `tiles` tiles at `dest` (a tile of the
 *  secondary tileset) on the frames whose timer % div is `phase`, frame (timer / div -
 *  lag) % count. `eight` is one of eight, its VDests: phase and lag k at dest + 4k, for k
 *  0..7. Mauville's flowers switch to `framesB` (countB long) past their first 12. */
type TileAnim = { set: string; frames: string; count: number; tiles: number; div: number; dest: number; phase?: number; lag?: number; eight?: true; framesB?: string; countB?: number };

/** tileset_anims.c's TilesetAnim_* for the outdoor towns (array lengths checked against
 *  the source by field-extra.test.ts). */
export const TILE_ANIMS: readonly TileAnim[] = [
  { set: 'Rustboro', frames: 'Rustboro_WindyWater', count: 8, tiles: 4, div: 8, dest: 128, eight: true },
  { set: 'Rustboro', frames: 'Rustboro_Fountain', count: 2, tiles: 4, div: 8, dest: 448 },
  { set: 'Dewford', frames: 'Dewford_Flag', count: 4, tiles: 6, div: 8, dest: 170 },
  { set: 'Slateport', frames: 'Slateport_Balloons', count: 4, tiles: 4, div: 16, dest: 224 },
  { set: 'Mauville', frames: 'Mauville_Flower1', count: 12, framesB: 'Mauville_Flower1_B', countB: 4, tiles: 4, div: 8, dest: 96, eight: true },
  { set: 'Mauville', frames: 'Mauville_Flower2', count: 12, framesB: 'Mauville_Flower2_B', countB: 4, tiles: 4, div: 8, dest: 128, eight: true },
  { set: 'Lavaridge', frames: 'Lavaridge_Steam', count: 4, tiles: 4, div: 16, dest: 288 },
  { set: 'Lavaridge', frames: 'Lavaridge_Steam', count: 4, tiles: 4, div: 16, dest: 292, lag: -2 },
  { set: 'Lavaridge', frames: 'Lavaridge_Cave_Lava', count: 4, tiles: 4, div: 16, phase: 1, dest: 160 },
  { set: 'EverGrande', frames: 'EverGrande_Flowers', count: 8, tiles: 4, div: 8, dest: 224, eight: true },
  { set: 'Pacifidlog', frames: 'Pacifidlog_LogBridges', count: 4, tiles: 30, div: 16, dest: 464 },
  { set: 'Pacifidlog', frames: 'Pacifidlog_WaterCurrents', count: 8, tiles: 8, div: 16, phase: 1, dest: 496 },
  { set: 'Sootopolis', frames: 'Sootopolis_StormyWater', count: 8, tiles: 96, div: 16, dest: 240 },
  { set: 'BattleFrontierOutsideWest', frames: 'BattleFrontierOutsideWest_Flag', count: 4, tiles: 6, div: 8, dest: 218 },
  { set: 'BattleFrontierOutsideEast', frames: 'BattleFrontierOutsideEast_Flag', count: 4, tiles: 6, div: 8, dest: 218 },
];

const ANIMS_HEADER = 8;
const ANIMS_ENTRY = 32;

/** The table into the core (software-mode0.c GBAVideoSoftwareRendererBrAnims): a joined
 *  town on its own tileset animates as the one we stand in does. False until it is sent;
 *  true, and nothing sent, for a build whose symbols name none of it. */
export function sendTileAnims(emu: Emulator, sym: (name: string) => number | undefined): boolean {
  const rows: { set: number; frames: number; framesB: number; dest: number; a: TileAnim; phase: number; lag: number }[] = [];
  for (const a of TILE_ANIMS) {
    const set = sym(`gTileset_${a.set}`);
    const frames = sym(`gTilesetAnims_${a.frames}`);
    const framesB = a.framesB ? sym(`gTilesetAnims_${a.framesB}`) : 0;
    if (set === undefined || frames === undefined || framesB === undefined) continue;
    for (let k = 0; k < (a.eight ? 8 : 1); k++) rows.push({ set, frames, framesB, dest: a.dest + 4 * k, a, phase: a.eight ? k : a.phase ?? 0, lag: a.eight ? k : a.lag ?? 0 });
  }
  if (rows.length === 0) return true;
  const bytes = ANIMS_HEADER + rows.length * ANIMS_ENTRY;
  const buf = emu.tileAnimBuffer(bytes);
  if (!buf) return false;
  buf.fill(0);
  const view = new DataView(buf.buffer, buf.byteOffset, bytes);
  view.setUint32(0, 1, true);
  view.setUint32(4, rows.length, true);
  rows.forEach((r, i) => {
    const e = ANIMS_HEADER + i * ANIMS_ENTRY;
    view.setUint32(e, r.set >>> 0, true);
    view.setUint32(e + 4, r.frames >>> 0, true);
    view.setUint32(e + 8, r.framesB >>> 0, true);
    view.setUint16(e + 12, r.dest, true);
    view.setUint16(e + 14, r.a.tiles, true);
    view.setUint8(e + 16, r.a.count);
    view.setUint8(e + 17, r.a.countB ?? 0);
    view.setUint8(e + 18, r.a.count);
    view.setUint8(e + 19, r.a.div);
    view.setUint8(e + 20, r.phase);
    view.setInt8(e + 21, r.lag);
  });
  emu.setTileAnims(bytes);
  return true;
}

/** The people the overlay drew past the ROM's objects, handed to the core instead
 *  (HBR-27): it draws them into the picture among the BGs, so a roof or a treetop covers
 *  them the way it covers the ROM's own (POK-443), the field's fade and weather tint take
 *  them, and there is one picture instead of a canvas of people over it. The core's
 *  layout is software-mode0.c GBAVideoSoftwareRendererDrawPeople's: each sprite at its
 *  grid pixel (MAP_OFFSET in), so a person stands still on the map while the camera
 *  moves on the next frame, with the frame's pixels as BGR555 (bit 15 drawn). */
export class CorePeople {
  /** Each sheet's pixels, BGR555 with bit 15 where drawn; null while its image is not in. */
  private sheets = new Map<number, Uint16Array>();
  private canvas: HTMLCanvasElement | null = null;
  private sent = false;

  private sheet(p: Painter, gfx: number, doc: Document | null): Uint16Array | null {
    const have = this.sheets.get(gfx);
    if (have) return have;
    const img = p.image(String(gfx), 'field-sprites');
    if (!img || !doc) return null;
    this.canvas ??= doc.createElement('canvas');
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !img.naturalWidth) return null;
    this.canvas.width = img.naturalWidth;
    this.canvas.height = img.naturalHeight;
    ctx.clearRect(0, 0, img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data;
    const out = new Uint16Array(img.naturalWidth * img.naturalHeight);
    for (let i = 0; i < out.length; i++) {
      const o = i * 4;
      if (rgba[o + 3] >= 128) out[i] = 0x8000 | (rgba[o] >> 3) | ((rgba[o + 1] >> 3) << 5) | ((rgba[o + 2] >> 3) << 10);
    }
    this.sheets.set(gfx, out);
    return out;
  }

  /** Hand the core `sprites` (top-lefts in the picture's pixels), placed by where gBrWorld
   *  says the LCD's top-left is on the grid, for the map gMapHeader has. Null when the
   *  image lacks either (the overlay draws them), false while a sheet is still on its
   *  way: the rest are sent, and the page asks again. */
  send(p: Painter, emu: Emulator, sym: (name: string) => number | undefined, sprites: readonly FieldSprite[]): boolean | null {
    const world = sym('gBrWorld');
    const header = sym('gMapHeader');
    if (world === undefined || header === undefined) {
      this.clear(emu);
      return null;
    }
    const s16 = (v: number) => (v << 16) >> 16;
    const lcdX = s16(emu.read(world + 4, 16));
    const lcdY = s16(emu.read(world + 6, 16));
    const layout = emu.read(header, 32);
    const doc = typeof document === 'undefined' ? null : document;
    let complete = true;
    // The first entry is in front: the lowest on the map first, a SURF blob behind all.
    const order = sprites.slice().sort((a, b) => Number(!!a.under) - Number(!!b.under)
      || (b.y + (SHEETS[String(b.gfx)]?.h ?? 0)) - (a.y + (SHEETS[String(a.gfx)]?.h ?? 0)));
    const rows: { s: FieldSprite; info: { w: number; h: number; frames: number }; px: Uint16Array }[] = [];
    for (const s of order) {
      if (rows.length >= CORE_PEOPLE_MAX) break;
      const info = SHEETS[String(s.gfx)];
      const px = info ? this.sheet(p, s.gfx, doc) : null;
      if (!info || !px || info.w > 255 || info.h > 255) { complete = false; continue; }
      rows.push({ s, info, px });
    }
    if (rows.length === 0) {
      if (this.sent) emu.setPeople(0);
      this.sent = false;
      return complete;
    }
    const pixelsAt = CORE_HEADER + rows.length * CORE_ENTRY;
    const bytes = pixelsAt + rows.reduce((n, r) => n + r.info.w * r.info.h * 2, 0);
    const buf = emu.peopleBuffer(bytes);
    if (!buf) return complete;
    const view = new DataView(buf.buffer, buf.byteOffset, bytes);
    view.setUint32(0, layout >>> 0, true);
    view.setUint32(4, rows.length, true);
    let at = pixelsAt;
    rows.forEach(({ s, info, px }, i) => {
      const e = CORE_HEADER + i * CORE_ENTRY;
      view.setInt16(e, lcdX + s.x, true);
      view.setInt16(e + 2, lcdY + s.y, true);
      view.setUint8(e + 4, info.w);
      view.setUint8(e + 5, info.h);
      view.setUint8(e + 6, (s.hFlip ? 1 : 0) | ((s.above ? 1 : 2) << 1));
      view.setUint8(e + 7, 0);
      view.setUint32(e + 8, at, true);
      view.setUint32(e + 12, 0, true);
      // The heap is little-endian, as the core reads it: a row at a time.
      const frame = Math.min(s.frame, info.frames - 1);
      const stride = info.w * info.frames;
      const out = new Uint16Array(buf.buffer, buf.byteOffset + at, info.w * info.h);
      for (let y = 0; y < info.h; y++) out.set(px.subarray(y * stride + frame * info.w, y * stride + (frame + 1) * info.w), y * info.w);
      at += info.w * info.h * 2;
    });
    emu.setPeople(bytes);
    this.sent = true;
    return complete;
  }

  /** Nobody: off the field, or with the overlay drawing them again. */
  clear(emu: Emulator): void {
    if (this.sent) emu.setPeople(0);
    this.sent = false;
  }
}

export function drawCovered(p: Painter, ctx: CanvasRenderingContext2D, sprites: FieldSprite[], cover: { maps: readonly Reached[]; ox: number; oy: number }): boolean {
  const lay = p.layout();
  const under = sprites.filter((s) => !s.above);
  const over = sprites.filter((s) => s.above);
  // Only the box the people under a cover stand in: a phone redrew, cut and laid on the
  // whole field for a few 16x32 sprites, on nearly every frame.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of under) {
    const info = SHEETS[String(s.gfx)];
    if (!info) continue;
    x0 = Math.min(x0, lay.lcdCol + s.x);
    y0 = Math.min(y0, lay.lcdRow + s.y);
    x1 = Math.max(x1, lay.lcdCol + s.x + info.w);
    y1 = Math.max(y1, lay.lcdRow + s.y + info.h);
  }
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(lay.cols, Math.ceil(x1));
  y1 = Math.min(lay.rows, Math.ceil(y1));
  if (!(x1 > x0 && y1 > y0)) return p.sprites(ctx, over);
  const doc = ctx.canvas.ownerDocument;
  const scratch = doc ? p.scratch(doc) : null;
  const sctx = scratch?.getContext('2d');
  if (!scratch || !sctx) return p.sprites(ctx, sprites);
  if (scratch.width !== lay.cols) scratch.width = lay.cols;
  if (scratch.height !== lay.rows) scratch.height = lay.rows;
  const w = x1 - x0;
  const h = y1 - y0;
  sctx.save();
  sctx.beginPath();
  sctx.rect(x0, y0, w, h);
  sctx.clip();
  sctx.globalCompositeOperation = 'source-over';
  sctx.clearRect(x0, y0, w, h);
  sctx.imageSmoothingEnabled = false;
  let complete = p.sprites(sctx, under);
  sctx.globalCompositeOperation = 'destination-out';
  for (const r of cover.maps) {
    const img = p.image(`${r.map.id}.cover`);
    if (img) sctx.drawImage(img, r.x - cover.ox, r.y - cover.oy);
    else complete = false;
  }
  sctx.restore();
  ctx.drawImage(scratch, x0, y0, w, h, x0, y0, w, h);
  return p.sprites(ctx, over) && complete;
}

/** The maps two seams away or more, over the band where it shows them (POK-431). The
 *  ROM's ring holds its own map and MAP_OFFSET cells of each neighbour along the seam,
 *  and border everywhere else: north of Oldale, standing on Route 102 by its east end,
 *  the band drew Route 102's trees where the composite beside it drew Route 103. So
 *  those maps go over the band, under the people, with the fog on them (`fog`); the ROM
 *  never draws anybody there. `shown` is the band as it shows, in map pixels. */
function drawCorners(p: Painter, ctx: CanvasRenderingContext2D, reached: readonly Reached[], shown: { left: number; top: number; right: number; bottom: number }, ox: number, oy: number, fog: (() => boolean) | null): boolean {
  let complete = true;
  let clipped = false;
  ctx.save();
  ctx.beginPath();
  const far = reached.filter((r) => r.hops >= 2);
  for (const r of far) {
    const x0 = Math.max(shown.left, r.x);
    const y0 = Math.max(shown.top, r.y);
    const x1 = Math.min(shown.right, r.x + r.map.w * TILE);
    const y1 = Math.min(shown.bottom, r.y + r.map.h * TILE);
    if (x1 <= x0 || y1 <= y0) continue;
    ctx.rect(x0 - ox, y0 - oy, x1 - x0, y1 - y0);
    clipped = true;
  }
  if (clipped) {
    ctx.clip();
    for (let i = far.length - 1; i >= 0; i--) {
      const img = p.image(far[i].map.id);
      if (img) ctx.drawImage(img, far[i].x - ox, far[i].y - oy);
      else complete = false;
    }
    if (fog && !fog()) complete = false;
  }
  ctx.restore();
  return complete;
}

/** Every map a view's rectangle reaches (POK-431): the one we are on, its neighbours, and
 *  theirs as far as `view` (map pixels of `map`, [left, right) by [top, bottom)) goes. A
 *  desktop shows 700 pixels of map across, so Oldale's neighbours' neighbours are on
 *  screen, and drawing only the first ring left Route 103's corner as Route 102's border
 *  until the walk got there (Cam's 2026-10-19 play-test: "Route 10x kind of pops in").
 *  Breadth first over the outdoor maps, so a map reached two ways is placed by the
 *  shorter; nearest first. A map off the view still leads on to the ones past it. */
export function reachedMaps(map: WorldMap, byId: ReadonlyMap<string, WorldMap>, view: { left: number; top: number; right: number; bottom: number }): Reached[] {
  const all: Reached[] = [{ map, x: 0, y: 0, hops: 0 }];
  const seen = new Set([map.id]);
  for (let i = 0; i < all.length; i++) {
    const at = all[i];
    for (const n of neighbours(at.map, byId)) {
      if (seen.has(n.map.id) || !n.map.outdoor) continue;
      seen.add(n.map.id);
      all.push({ map: n.map, x: at.x + n.x, y: at.y + n.y, hops: at.hops + 1 });
    }
  }
  return all.filter((r) => r.hops === 0 || (r.x < view.right && r.y < view.bottom && r.x + r.map.w * TILE > view.left && r.y + r.map.h * TILE > view.top));
}

/** reachedMaps on Hoenn, with the stills a step could need next asked for: before a seam
 *  is crossed, not on the frame after, since the map we cross into is drawn on its own
 *  border, and a border still on its way was black around it for as long as the fetch
 *  took -- the area popping in (POK-431). */
export function reach(p: Painter, map: WorldMap, view: { left: number; top: number; right: number; bottom: number }): Reached[] {
  const list = reachedMaps(map, HOENN.byId, view);
  for (const r of list) {
    if (r.hops > 1) continue;
    p.image(`${r.map.id}.border`);
    for (const n of neighbours(r.map, HOENN.byId)) if (n.map.outdoor) p.image(n.map.id);
  }
  return list;
}

/** What the overlay draws past the band, under the hidden people: the maps two seams
 *  away (drawCorners) and the marks the band shows bare ground for, since the ROM keeps
 *  sprites for its own map's patches near the player only, and for no other map's. */
export function drawPast(p: Painter, ctx: CanvasRenderingContext2D, c: Camera, map: WorldMap, band: Band, reached: readonly Reached[], marks: readonly Mark[], fog: (() => boolean) | null): boolean {
  const lay = p.layout();
  const cut = bandClip(c, map, band, c.stale, wideRing(band) && c.wide !== false);
  const { left, top } = lcdOrigin(c);
  // The band as it shows, cut (bandClip), in map pixels of the map we are on.
  const shown = {
    left: left - band.left + cut.left,
    top: top - band.top + cut.top,
    right: left + GBA_W + band.right - cut.right,
    bottom: top + GBA_H + band.bottom - cut.bottom,
  };
  const ox = left - lay.lcdCol;
  const oy = top - lay.lcdRow;
  const corners = drawCorners(p, ctx, reached, shown, ox, oy, fog);
  const bare = marks.filter((m) => !m.drawn && m.at.x + TILE > shown.left && m.at.x < shown.right && m.at.y + TILE > shown.top && m.at.y < shown.bottom);
  return drawMarks(p, ctx, bare, ox, oy) && corners;
}

/** event_object_movement.c's sElevationToPriority: an object at 4, 6, 8, 10 or 12 is drawn
 *  at priority 1, over BG1 -- a bridge's deck, the Cycling Road -- and 13 or 14 over all. */
export const ELEVATION_TO_PRIORITY = [2, 2, 2, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 0, 0, 2];

const elevGrids = new WeakMap<WorldMap, Uint8Array>();

/** A map cell's elevation (map.json's), or -1 off the map. */
function cellElevation(map: WorldMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return -1;
  let grid = elevGrids.get(map);
  if (!grid) elevGrids.set(map, (grid = decodeGrid(map.elev ?? '', map.w * map.h)));
  return grid[y * map.w + x];
}

/** Whether the page's own drawing of a person stands where the ROM would put them over
 *  BG1: by the elevation of the cell under their feet (ELEVATION_TO_PRIORITY). */
export function standsAbove(map: WorldMap, s: { gfx: number; x: number; y: number }, origin: { left: number; top: number }): boolean {
  const info = SHEETS[String(s.gfx)];
  if (!info) return false;
  const e = cellElevation(map, Math.floor((origin.left + s.x + info.w / 2) / TILE), Math.floor((origin.top + s.y + info.h - 1) / TILE));
  return e >= 0 && ELEVATION_TO_PRIORITY[e] <= 1;
}
