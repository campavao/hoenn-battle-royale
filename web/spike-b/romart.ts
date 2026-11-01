// Spike B's art, cut from the player's own ROM in their browser.
//
// The site ships no Nintendo pictures: the ground, the cover over people, the border
// past a map's edge and every trainer's sprite sheet are drawn here from the ROM bytes
// the player brought, the same way tools/br/render-maps.py and export-sprites.py draw
// them from pret's files. Only addresses (br-symbols.json) and frame counts
// (sprites.json) come from the site.
//
//   gMapGroups[group][num] -> MapHeader.mapLayout -> MapLayout {w, h, border, map,
//       primary, secondary} -> Tileset {isCompressed, tiles (LZ77 when compressed),
//       palettes (16 x 16 BGR555), metatiles (8 u16 each), metatileAttributes}
//   gObjectEventGraphicsInfoPointers[gfx] -> ObjectEventGraphicsInfo {paletteTag @2,
//       width @8, height @10, images @28 -> SpriteFrameImage {data, size}[]}
//
// The object palettes' table (sObjectEventSpritePalettes) is static, so it has no symbol:
// it is found by its shape, a run of {ROM pointer, tag 0x11xx} entries.

import { TMHM_MOVES } from './tmhm';
import { ANIM_COUNTER_MAX, GENERAL_ANIMS, TILE_ANIMS, framesShown } from '../src/tile-anims';

/** items.h ITEM_TM01: the first machine. */
const ITEM_TM01 = 289;

const ROM = 0x08000000;
const TILE = 8;
const BLOCK = 16;
const LAYER_COVERED = 1;
const PAL_TAG_NONE = 0x11ff;

/** A metatile with animated tiles in it (tileset_anims.c), on `cells` (y * width + x) of a
 *  map: its looks side by side in `sheet`, 16 px each, and which one is on show at each
 *  step of the ROM's 256-step counter (`states`). */
export interface MapAnim { sheet: HTMLCanvasElement; states: Uint8Array; cells: Int32Array }
export interface MapArt { ground: HTMLCanvasElement; cover: HTMLCanvasElement; border: HTMLCanvasElement; anims: MapAnim[] }
/** A run of animated tiles: from tile `at` (past 511 the secondary's), `tiles` long, the
 *  ROM address of the frame on show at each step of the counter (0 for none yet). */
interface TileRun { at: number; tiles: number; shown: number[] }

export function lz77(rom: Uint8Array, at: number): Uint8Array {
  if (rom[at] !== 0x10) throw new Error(`not LZ77 at ${at.toString(16)}`);
  const size = rom[at + 1] | (rom[at + 2] << 8) | (rom[at + 3] << 16);
  const out = new Uint8Array(size);
  let src = at + 4;
  let dst = 0;
  while (dst < size) {
    const flags = rom[src++];
    for (let bit = 7; bit >= 0 && dst < size; bit--) {
      if (flags & (1 << bit)) {
        const b0 = rom[src++], b1 = rom[src++];
        const len = (b0 >> 4) + 3;
        const disp = (((b0 & 0xf) << 8) | b1) + 1;
        for (let k = 0; k < len && dst < size; k++, dst++) out[dst] = out[dst - disp];
      } else out[dst++] = rom[src++];
    }
  }
  return out;
}

/** BGR555 to the 8-bit RGBA the canvas wants, packed little-endian for a Uint32Array. */
function rgba(c: number): number {
  const r = (c & 31) << 3, g = ((c >> 5) & 31) << 3, b = ((c >> 10) & 31) << 3;
  return (0xff << 24) | (b << 16) | (g << 8) | r;
}

/** The ROM's letters as text: capitals, small letters, digits, the few marks names use; anything else a space. */
export function text(letters: readonly number[]): string {
  let out = '';
  for (const c of letters) {
    out += c >= 0xbb && c <= 0xd4 ? String.fromCharCode(65 + c - 0xbb)
      : c >= 0xd5 && c <= 0xee ? String.fromCharCode(97 + c - 0xd5)
      : c >= 0xa1 && c <= 0xaa ? String.fromCharCode(48 + c - 0xa1)
      : c === 0x1b ? 'é' : c === 0xae ? '-' : c === 0xad ? '.' : c === 0xb4 ? "'" : c === 0xab ? '!' : c === 0xac ? '?'
      : c === 0xb8 ? ',' : c === 0xf0 ? ':' : c === 0xba ? '/' : ' ';
  }
  return out;
}

interface Tileset { tiles: Uint8Array; palettes: number[][]; metatiles: number; attrs: number }

export class RomArt {
  private dv: DataView;
  private tilesets = new Map<number, Tileset>();
  private runsFor = new Map<string, TileRun[]>();
  private objPals: Map<number, number[]> | null = null;

  constructor(private rom: Uint8Array, readonly sym: (name: string) => number) {
    this.dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  }

  private u8 = (a: number) => this.rom[a - ROM];
  private u16 = (a: number) => this.dv.getUint16(a - ROM, true);
  private s16 = (a: number) => this.dv.getInt16(a - ROM, true);
  private u32 = (a: number) => this.dv.getUint32(a - ROM, true);

  private palette(at: number): number[] {
    const p: number[] = [];
    for (let c = 0; c < 16; c++) p.push(rgba(this.u16(at + c * 2)));
    return p;
  }

  private tileset(at: number): Tileset {
    let t = this.tilesets.get(at);
    if (t) return t;
    const compressed = this.u8(at) !== 0;
    const tilesAt = this.u32(at + 4);
    const tiles = compressed ? lz77(this.rom, tilesAt - ROM) : this.rom.subarray(tilesAt - ROM, tilesAt - ROM + 512 * 32);
    const palettes: number[][] = [];
    for (let i = 0; i < 16; i++) palettes.push(this.palette(this.u32(at + 8) + i * 32));
    t = { tiles, palettes, metatiles: this.u32(at + 0xc), attrs: this.u32(at + 0x10) };
    this.tilesets.set(at, t);
    return t;
  }

  /** The animated runs of tiles on a map whose tilesets are at `priAt` and `secAt`: the
   *  primary's TilesetAnim_General and the town's own (tile-anims.ts). */
  private runs(priAt: number, secAt: number): TileRun[] {
    const key = `${priAt}:${secAt}`;
    let out = this.runsFor.get(key);
    if (out) return out;
    out = [];
    const table = (name: string) => this.sym(`gTilesetAnims_${name}`);
    for (const a of [...GENERAL_ANIMS, ...TILE_ANIMS]) {
      const primary = GENERAL_ANIMS.includes(a);
      // A build whose symbols name none of it plays nothing.
      if (this.sym(`gTileset_${a.set}`) !== (primary ? priAt : secAt)) continue;
      if (Number.isNaN(table(a.frames)) || (a.framesB && Number.isNaN(table(a.framesB)))) continue;
      for (let k = 0; k < (a.eight ? 8 : 1); k++) {
        out.push({ at: (primary ? 0 : 512) + a.dest + 4 * k, tiles: a.tiles, shown: framesShown(a, k, table, this.u32) });
      }
    }
    this.runsFor.set(key, out);
    return out;
  }

  /** Ground, cover and border for map (group, num), as render-maps.py draws them; `over`
   *  puts other metatiles on some cells (a cell's y * width + x), as MapGridSetMetatileIdAt
   *  does in the game. The ground is drawn with each animation's first look; `anims` has
   *  the rest, for the page to lay over it. */
  map(group: number, num: number, over?: ReadonlyMap<number, number>): MapArt {
    const header = this.u32(this.u32(this.sym('gMapGroups') + group * 4) + num * 4);
    const layout = this.u32(header);
    const w = this.dv.getInt32(layout - ROM, true), h = this.dv.getInt32(layout + 4 - ROM, true);
    const border = this.u32(layout + 8), blocks = this.u32(layout + 0xc);
    const priAt = this.u32(layout + 0x10), secAt = this.u32(layout + 0x14);
    const pri = this.tileset(priAt), sec = this.tileset(secAt);
    // Primary palettes 0..5, the secondary's 6..12, the primary's again from 13.
    const pals = [...pri.palettes.slice(0, 6), ...sec.palettes.slice(6, 13), ...pri.palettes.slice(13)];
    // `frame(tid)`: an animated tile's ROM address in the look being drawn, or 0.
    const draw = (px: Uint32Array, stride: number, bx: number, by: number, block: number, cover: boolean, frame?: (tid: number) => number) => {
      const mid = block & 0x3ff;
      const ts = mid < 512 ? pri : sec;
      const i = mid < 512 ? mid : mid - 512;
      if (cover && ((this.u16(ts.attrs + i * 2) >> 12) & 0xf) === LAYER_COVERED) return;
      for (let layer = cover ? 1 : 0; layer < 2; layer++) {
        for (let t = 0; t < 4; t++) {
          const e = this.u16(ts.metatiles + i * 16 + (layer * 4 + t) * 2);
          const tid = e & 0x3ff;
          const anim = frame?.(tid) ?? 0;
          const src = anim ? this.rom : tid < 512 ? pri.tiles : sec.tiles;
          const off = anim ? anim - ROM : (tid < 512 ? tid : tid - 512) * 32;
          if (off + 32 > src.length) continue;
          const pal = pals[(e >> 12) & 0xf];
          const hf = e & 0x400, vf = e & 0x800;
          const x0 = bx + (t & 1) * TILE, y0 = by + (t >> 1) * TILE;
          for (let y = 0; y < TILE; y++) {
            const row = off + (vf ? TILE - 1 - y : y) * 4;
            for (let x = 0; x < TILE; x++) {
              const sx = hf ? TILE - 1 - x : x;
              const c = (src[row + (sx >> 1)] >> ((sx & 1) * 4)) & 0xf;
              if (layer === 1 && c === 0) continue;
              px[(y0 + y) * stride + x0 + x] = pal[c];
            }
          }
        }
      }
    };
    const paint = (cw: number, ch: number, fill: number, each: (px: Uint32Array) => void) => {
      const cv = document.createElement('canvas');
      cv.width = cw;
      cv.height = ch;
      const ctx = cv.getContext('2d')!;
      const id = ctx.createImageData(cw, ch);
      const px = new Uint32Array(id.data.buffer);
      px.fill(fill);
      each(px);
      ctx.putImageData(id, 0, 0);
      return cv;
    };
    const W = w * BLOCK;
    const ground = paint(W, h * BLOCK, 0xff000000, (px) => {
      for (let i = 0; i < w * h; i++) draw(px, W, (i % w) * BLOCK, Math.floor(i / w) * BLOCK, over?.get(i) ?? this.u16(blocks + i * 2), false);
    });
    const cover = paint(W, h * BLOCK, 0, (px) => {
      for (let i = 0; i < w * h; i++) draw(px, W, (i % w) * BLOCK, Math.floor(i / w) * BLOCK, over?.get(i) ?? this.u16(blocks + i * 2), true);
    });
    const borderCv = paint(2 * BLOCK, 2 * BLOCK, 0xff000000, (px) => {
      for (let i = 0; i < 4; i++) draw(px, 2 * BLOCK, (i & 1) * BLOCK, (i >> 1) * BLOCK, this.u16(border + i * 2), false);
    });
    // The animated metatiles (tileset_anims.c): each one's cells, and each look it takes
    // as the counter goes round, drawn once.
    const runs = this.runs(priAt, secAt);
    const anims: MapAnim[] = [];
    if (runs.length) {
      const runsOf = new Map<number, TileRun[]>();
      const cellsOf = new Map<number, number[]>();
      for (let i = 0; i < w * h; i++) {
        const mid = (over?.get(i) ?? this.u16(blocks + i * 2)) & 0x3ff;
        let used = runsOf.get(mid);
        if (!used) {
          const ts = mid < 512 ? pri : sec, m = mid < 512 ? mid : mid - 512;
          const tids = Array.from({ length: 8 }, (_, t) => this.u16(ts.metatiles + m * 16 + t * 2) & 0x3ff);
          used = runs.filter((r) => tids.some((tid) => tid >= r.at && tid < r.at + r.tiles));
          runsOf.set(mid, used);
        }
        if (used.length) (cellsOf.get(mid) ?? cellsOf.set(mid, []).get(mid)!).push(i);
      }
      for (const [mid, cells] of cellsOf) {
        const used = runsOf.get(mid)!;
        const looks = new Map<string, number>(); // the frames on show -> the step that shows them
        const states = new Uint8Array(ANIM_COUNTER_MAX);
        for (let c = 0; c < ANIM_COUNTER_MAX; c++) {
          const k = used.map((r) => r.shown[c]).join(',');
          if (!looks.has(k)) looks.set(k, c);
          states[c] = [...looks.keys()].indexOf(k);
        }
        const steps = [...looks.values()];
        const sheet = paint(steps.length * BLOCK, BLOCK, 0xff000000, (px) => {
          steps.forEach((c, n) => draw(px, steps.length * BLOCK, n * BLOCK, 0, mid, false, (tid) => {
            const r = used.find((q) => tid >= q.at && tid < q.at + q.tiles);
            return r && r.shown[c] ? r.shown[c] + (tid - r.at) * 32 : 0;
          }));
        });
        anims.push({ sheet, states, cells: Int32Array.from(cells) });
      }
    }
    return { ground, cover, border: borderCv, anims };
  }

  /** The metatile behaviour of cell (x, y) on map (group, num), as the layout ships it:
   *  what a marked spot is (br_wild.h asks with it). */
  behavior(group: number, num: number, x: number, y: number): number {
    const header = this.u32(this.u32(this.sym('gMapGroups') + group * 4) + num * 4);
    const layout = this.u32(header);
    const w = this.dv.getInt32(layout - ROM, true);
    const mid = this.u16(this.u32(layout + 0xc) + (y * w + x) * 2) & 0x3ff;
    const ts = this.tileset(this.u32(layout + (mid < 512 ? 0x10 : 0x14)));
    return this.u16(ts.attrs + (mid < 512 ? mid : mid - 512) * 2) & 0xff;
  }

  objectPalettes(): Map<number, number[]> {
    if (this.objPals) return this.objPals;
    const rom = this.rom;
    const pals = new Map<number, number[]>();
    // The longest run of {ROM pointer, tag 0x11xx, 0} entries; the table has 35.
    const entry = (at: number) => {
      const p = this.dv.getUint32(at, true), tag = this.dv.getUint16(at + 4, true);
      return p >= ROM && p < ROM + rom.length && (tag & 0xff00) === 0x1100 && tag !== PAL_TAG_NONE && this.dv.getUint16(at + 6, true) === 0;
    };
    for (let at = 0; at + 8 <= rom.length; at += 4) {
      let n = 0;
      while (at + n * 8 + 8 <= rom.length && entry(at + n * 8)) n++;
      if (n < 20) continue;
      for (let k = 0; k < n; k++) pals.set(this.dv.getUint16(at + k * 8 + 4, true), this.palette(this.dv.getUint32(at + k * 8, true)));
      break;
    }
    this.objPals = pals;
    return pals;
  }

  /** The marked spots' pictures (br_patch.c): the grass's rustle in the field effects'
   *  palette, and the ripple in the water's own. 16x16 frames, left to right. */
  patchSheets(): { grass: HTMLCanvasElement; water: HTMLCanvasElement } {
    const grassPal = this.palette(this.u32(this.sym('gSpritePalette_GeneralFieldEffect1')));
    const waterPal = this.palette(this.sym('gBrPatchWaterColors'));
    return {
      grass: this.frames(this.sym('gBrPatchTallGrassPic'), 5, 16, 16, grassPal),
      water: this.frames(this.sym('gBrPatchWaterPic'), 5, 16, 16, waterPal),
    };
  }

  /** `count` frames of w x h 4bpp tiles from `at`, row by row, colour 0 clear. */
  private frames(at: number, count: number, w: number, h: number, pal: number[]): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = w * count;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(cv.width, h);
    const px = new Uint32Array(id.data.buffer);
    const tw = w / TILE;
    for (let f = 0; f < count; f++) {
      const data = at - ROM + f * (w * h) / 2;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const b = this.rom[data + ((y >> 3) * tw + (x >> 3)) * 32 + (y & 7) * 4 + ((x & 7) >> 1)];
          const c = (b >> ((x & 1) * 4)) & 0xf;
          if (c) px[y * cv.width + f * w + x] = pal[c];
        }
      }
    }
    ctx.putImageData(id, 0, 0);
    return cv;
  }

  /** An item's name as the bag shows it (gItems, struct Item: 14 bytes of name first,
   *  44 bytes a row), in capitals and digits; '' for an id the table does not have. A
   *  machine is its move's name, as GetItemName has it in a match (item.c, Cam 10-31:
   *  "when putting a TM in the bag, it doesn't say the name of the move"). */
  itemName(id: number): string {
    const move = id >= ITEM_TM01 && id < ITEM_TM01 + TMHM_MOVES.length ? TMHM_MOVES[id - ITEM_TM01] : 0;
    // gMoveNames: MOVE_NAME_LENGTH + 1 (13) bytes a row.
    if (move) return text(this.letters(this.sym('gMoveNames') + move * 13, 13));
    const row = this.sym('gItems') + id * 44;
    if (this.u16(row + 14) !== id) return '';
    return text(this.letters(row, 14));
  }

  /** An item's words as the BAG and the MART show them (struct Item's description, @20),
   *  a line each. */
  itemDescription(id: number): string[] {
    const row = this.sym('gItems') + id * 44;
    if (this.u16(row + 14) !== id) return [];
    const lines: number[][] = [[]];
    for (const c of this.letters(this.u32(row + 20), 160)) {
      if (c === 0xfe) lines.push([]);
      else lines[lines.length - 1].push(c);
    }
    return lines.map(text);
  }

  /** What the item table prices it at (struct Item's price, after the name and id). */
  itemPrice(id: number): number {
    return this.u16(this.sym('gItems') + id * 44 + 16);
  }

  /** Map (group, num)'s object events, as (x, y, graphicsId) (MapHeader.events ->
   *  MapEvents.objectEvents, struct ObjectEventTemplate: 24 bytes, gfx @1, x @4, y @6). */
  objects(group: number, num: number): [number, number, number][] {
    const events = this.u32(this.u32(this.u32(this.sym('gMapGroups') + group * 4) + num * 4) + 4);
    const n = this.u8(events), list = this.u32(events + 4);
    const out: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const o = list + i * 24;
      out.push([this.dv.getInt16(o + 4 - ROM, true), this.dv.getInt16(o + 6 - ROM, true), this.u8(o + 1)]);
    }
    return out;
  }

  /** Map (group, num)'s MAP section (MapHeader.regionMapSectionId). */
  mapsec(group: number, num: number): number {
    return this.u8(this.u32(this.u32(this.sym('gMapGroups') + group * 4) + num * 4) + 0x14);
  }

  /** A MAP section's cells on the MAP's grid (gRegionMapEntries, struct RegionMapLocation:
   *  x, y, width, height, then the name), and the name in the ROM's own letters. */
  section(id: number): { x: number; y: number; w: number; h: number; letters: number[] } {
    const at = this.sym('gRegionMapEntries') + id * 8;
    return { x: this.u8(at), y: this.u8(at + 1), w: this.u8(at + 2), h: this.u8(at + 3), letters: this.letters(this.u32(at + 4), 16) };
  }

  /** Up to `max` of the ROM's letters from `at`, to the end mark. */
  private letters(at: number, max: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < max && this.u8(at + i) !== 0xff; i++) out.push(this.u8(at + i));
    return out;
  }

  /** gfx's frames left to right, colour 0 clear, as export-sprites.py lays them out. */
  /** SURF's blob (field_effect_objects.h sPicTable_SurfBlob): south, north, west, 32x32,
   *  in the surfer's own palette (its template's paletteTag is TAG_NONE: the field effect
   *  takes the player's). Null on a release whose symbols do not name it yet. */
  surfBlob(surferGfx: number): HTMLCanvasElement | null {
    const tpl = this.sym('gFieldEffectObjectTemplate_SurfBlob');
    if (!Number.isFinite(tpl)) return null;
    const info = this.u32(this.sym('gObjectEventGraphicsInfoPointers') + surferGfx * 4);
    const pal = this.objectPalettes().get(this.u16(info + 2)) ?? new Array(16).fill(0xffff00ff);
    return this.pics(this.u32(tpl + 12), 32, 32, 3, pal);
  }

  /** The fog (WEATHER_FOG_HORIZONTAL): the one 64x64 picture the ROM tiles over the
   *  screen, in gFogPalette (graphics/weather/br_fog.pal, the match's purple). Null on a
   *  release whose symbols do not name them yet. */
  fog(): HTMLCanvasElement | null {
    const tiles = this.sym('gWeatherFogHorizontalTiles'), pal = this.sym('gFogPalette');
    if (!Number.isFinite(tiles) || !Number.isFinite(pal)) return null;
    return this.sheet([tiles - ROM], 64, 64, this.palette(pal));
  }

  /** `frames` of an object's SpriteFrameImage table (8 bytes each: its data, its size). */
  private pics(images: number, w: number, h: number, frames: number, pal: number[]): HTMLCanvasElement {
    const data: number[] = [];
    for (let f = 0; f < frames; f++) data.push(this.u32(images + f * 8) - ROM);
    return this.sheet(data, w, h, pal);
  }

  /** 4bpp sprite frames, each at its offset in the ROM, side by side; colour 0 clear. */
  private sheet(frames: readonly number[], w: number, h: number, pal: number[]): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = w * frames.length;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(cv.width, h);
    const px = new Uint32Array(id.data.buffer);
    const tw = w / TILE;
    frames.forEach((data, f) => {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const tile = (y >> 3) * tw + (x >> 3);
          const b = this.rom[data + tile * 32 + (y & 7) * 4 + ((x & 7) >> 1)];
          const c = (b >> ((x & 1) * 4)) & 0xf;
          if (c) px[y * cv.width + f * w + x] = pal[c];
        }
      }
    });
    ctx.putImageData(id, 0, 0);
    return cv;
  }

  sprite(gfx: number, frames: number): HTMLCanvasElement {
    const info = this.u32(this.sym('gObjectEventGraphicsInfoPointers') + gfx * 4);
    const pal = this.objectPalettes().get(this.u16(info + 2)) ?? new Array(16).fill(0xffff00ff);
    return this.pics(this.u32(info + 28), this.s16(info + 8), this.s16(info + 10), frames, pal);
  }
}
