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

import { TMHM_MOVES } from '../src/ui/tmhm';
import { ANIM_COUNTER_MAX, GENERAL_ANIMS, TILE_ANIMS, framesShown } from '../src/tile-anims';

/** items.h ITEM_TM01: the first machine. */
const ITEM_TM01 = 289;

const ROM = 0x08000000;
const TILE = 8;
const BLOCK = 16;
const LAYER_COVERED = 1;
const PAL_TAG_NONE = 0x11ff;
/** The species ids the ROM's tables have a row for (constants/species.h, one past the last). */
const NUM_SPECIES = 412;

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

/** BGR555 widened the way mGBA shows it, (v << 3) | (v >> 2), which is what the ROM's own battle looks like. */
function rgbaWide(c: number): number {
  const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
  return (0xff << 24) | (((b << 3) | (b >> 2)) << 16) | (((g << 3) | (g >> 2)) << 8) | ((r << 3) | (r >> 2));
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

// ---- a fight, as the page draws it (battleview.ts) --------------------------------------
//
// Everything the watcher's screen shows of a battle comes out of these tables, the way the
// ROM's own battle draws it: pictures are 4bpp tiles in LZ77 (a mon's front one holds its
// two frames, one above the other), their palettes LZ77 too; the ground is tiles + a 32 x 32
// tilemap + three BG palettes; the message box is a tilemap over its own tiles; the health
// boxes are two sprites' tiles in one sheet. A symbol the patch does not name leaves that
// piece null and the view draws a stand-in.

/** The kinds of ground a fight can be on (battle_bg.c sBattleEnvironmentTable, and the
 *  buildings' own palettes): the tiles, the tilemap and the palette each takes. */
export type BattleEnv = 'grass' | 'long_grass' | 'sand' | 'underwater' | 'water' | 'pond' | 'mountain' | 'cave' | 'building' | 'plain' | 'gym';
const ENV_ART: Record<BattleEnv, [string, string]> = {
  grass: ['TallGrass', 'TallGrass'],
  long_grass: ['LongGrass', 'LongGrass'],
  sand: ['Sand', 'Sand'],
  underwater: ['Underwater', 'Underwater'],
  water: ['Water', 'Water'],
  pond: ['PondWater', 'PondWater'],
  mountain: ['Rock', 'Rock'],
  cave: ['Cave', 'Cave'],
  building: ['Building', 'Building'],
  plain: ['Building', 'Plain'],
  gym: ['Building', 'BuildingGym'],
};
/** The palette entries (of BG banks 2..4, so 0 is bank 2's first) that every environment draws
 *  its sky and ground stripes with: the ROM keys them clear in a match (br_battle.c
 *  sSeeThroughStripes) so the field shows through round the two platforms. */
const SEE_THROUGH = [1, 11, 12, 13, 14, 15, 16 + 1, 16 + 15];

/** A health box's two sprites' pictures in one canvas: 128 wide, the near one 64 tall and the far
 *  one 32 (healthbox_singles_*.png). */
export interface HealthboxArt {
  box: HTMLCanvasElement;
  /** The box palette's words: the letter, its shadow, and the two colours the genders are set in. */
  ink: { fg: string; shadow: string; male: string; female: string };
  /** One 8 x 8 tile of gHealthboxElementsGfxTable, in the bar's palette, or in the box's with
   *  `status` (a 15-bit colour) put at the entry a status tile draws with. */
  tile(element: number, status?: { slot: number; colour: number }): HTMLCanvasElement;
}

/** gHealthboxElementsGfxTable's order (battle_interface.c), the ones the view uses. */
export const HB = { H: 1, HP_GREEN: 3, HP_YELLOW: 47, HP_RED: 56, BALL_CAUGHT: 70, STATUS: { psn: [21, 71], par: [24, 74], slp: [27, 77], frz: [30, 80], brn: [33, 83] } as Record<string, number[]> };

/** A font's glyph sheet from the ROM (text.c: a glyph is four 8 x 8 tiles of 2bpp, one u16 a
 *  row, the left pixel in the high bits; 1 is the letter, 2 its shadow, 3 the cell's own
 *  background): the width of each glyph and a way to set a line in any two colours. */
export class RomFont {
  private tinted = new Map<string, HTMLCanvasElement>();
  constructor(private readonly index: Uint8Array, readonly widths: Uint8Array) {}

  width(ids: readonly number[]): number {
    return ids.reduce((w, id) => w + (this.widths[id] ?? 6), 0);
  }

  private sheet(fg: string, shadow: string): HTMLCanvasElement {
    const key = `${fg}|${shadow}`;
    let cv = this.tinted.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas');
    cv.width = 16 * 16;
    cv.height = 32 * 16;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(cv.width, cv.height);
    const px = new Uint32Array(id.data.buffer);
    const col = (s: string) => {
      const m = s.match(/\d+/g)!.map(Number);
      return (0xff << 24) | (m[2] << 16) | (m[1] << 8) | m[0];
    };
    const c1 = col(fg), c2 = col(shadow);
    for (let g = 0; g < 512; g++) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const v = this.index[g * 256 + y * 16 + x];
          if (v === 1 || v === 2) px[((g >> 4) * 16 + y) * cv.width + (g & 15) * 16 + x] = v === 1 ? c1 : c2;
        }
      }
    }
    ctx.putImageData(id, 0, 0);
    this.tinted.set(key, cv);
    return cv;
  }

  /** `ids` (charmap glyph numbers) with their top-left at (x, y); the pixels outside `clip`
   *  (x0, y0, x1, y1) left alone, as a health box's window shows only part of its text. */
  draw(ctx: CanvasRenderingContext2D, ids: readonly number[], x: number, y: number, fg: string, shadow: string, clip?: [number, number, number, number]): void {
    const sheet = this.sheet(fg, shadow);
    if (clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip[0], clip[1], clip[2] - clip[0], clip[3] - clip[1]);
      ctx.clip();
    }
    let cx = x;
    for (const id of ids) {
      ctx.drawImage(sheet, (id & 15) * 16, (id >> 4) * 16, 16, 16, cx, y, 16, 16);
      cx += this.widths[id] ?? 6;
    }
    if (clip) ctx.restore();
  }
}

export class RomArt {
  private dv: DataView;
  private tilesets = new Map<number, Tileset>();
  private runsFor = new Map<string, TileRun[]>();
  private looksOf = new Map<string, { sheet: HTMLCanvasElement; states: Uint8Array } | null>();
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

  /** Draws a block in these tilesets into `px`. */
  private blockDrawer(pri: Tileset, sec: Tileset) {
    // Primary palettes 0..5, the secondary's 6..12, the primary's again from 13.
    const pals = [...pri.palettes.slice(0, 6), ...sec.palettes.slice(6, 13), ...pri.palettes.slice(13)];
    // `frame(tid)`: an animated tile's ROM address in the look being drawn, or 0.
    return (px: Uint32Array, stride: number, bx: number, by: number, block: number, cover: boolean, frame?: (tid: number) => number) => {
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
  }

  /** The map's block at a cell, as its layout has it. */
  blockAt(group: number, num: number, x: number, y: number): number {
    const layout = this.u32(this.u32(this.u32(this.sym('gMapGroups') + group * 4) + num * 4));
    return this.u16(this.u32(layout + 0xc) + (y * this.dv.getInt32(layout - ROM, true) + x) * 2);
  }

  /** One block in this map's tilesets, 16 x 16, for a cell that changes under a step. */
  blockArt(group: number, num: number, block: number): HTMLCanvasElement {
    const layout = this.u32(this.u32(this.u32(this.sym('gMapGroups') + group * 4) + num * 4));
    const draw = this.blockDrawer(this.tileset(this.u32(layout + 0x10)), this.tileset(this.u32(layout + 0x14)));
    const cv = document.createElement('canvas');
    cv.width = cv.height = BLOCK;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(BLOCK, BLOCK);
    const px = new Uint32Array(id.data.buffer);
    px.fill(0xff000000);
    draw(px, BLOCK, 0, 0, block, false);
    ctx.putImageData(id, 0, 0);
    return cv;
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
    const draw = this.blockDrawer(pri, sec);
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

  /** A metatile's looks as the tile animations go round (tileset_anims.c), on this map's
   *  tilesets: null if nothing in it moves. Kept, as every chunk of coast wants the same few. */
  metatileLooks(group: number, num: number, mid: number): { sheet: HTMLCanvasElement; states: Uint8Array } | null {
    const key = `${group}:${num}:${mid}`;
    const had = this.looksOf.get(key);
    if (had !== undefined) return had;
    const layout = this.u32(this.u32(this.u32(this.sym('gMapGroups') + group * 4) + num * 4));
    const priAt = this.u32(layout + 0x10), secAt = this.u32(layout + 0x14);
    const pri = this.tileset(priAt), sec = this.tileset(secAt);
    const ts = mid < 512 ? pri : sec, m = mid < 512 ? mid : mid - 512;
    const tids = Array.from({ length: 8 }, (_, t) => this.u16(ts.metatiles + m * 16 + t * 2) & 0x3ff);
    const used = this.runs(priAt, secAt).filter((r) => tids.some((tid) => tid >= r.at && tid < r.at + r.tiles));
    let out: { sheet: HTMLCanvasElement; states: Uint8Array } | null = null;
    if (used.length) {
      const looks = new Map<string, number>();
      const states = new Uint8Array(ANIM_COUNTER_MAX);
      for (let c = 0; c < ANIM_COUNTER_MAX; c++) {
        const k = used.map((r) => r.shown[c]).join(',');
        if (!looks.has(k)) looks.set(k, c);
        states[c] = [...looks.keys()].indexOf(k);
      }
      const steps = [...looks.values()];
      const draw = this.blockDrawer(pri, sec);
      const sheet = document.createElement('canvas');
      sheet.width = steps.length * BLOCK;
      sheet.height = BLOCK;
      const ctx = sheet.getContext('2d')!;
      const id = ctx.createImageData(sheet.width, BLOCK);
      const px = new Uint32Array(id.data.buffer);
      px.fill(0xff000000);
      steps.forEach((c, n) => draw(px, sheet.width, n * BLOCK, 0, mid, false, (tid) => {
        const r = used.find((q) => tid >= q.at && tid < q.at + q.tiles);
        return r && r.shown[c] ? r.shown[c] + (tid - r.at) * 32 : 0;
      }));
      ctx.putImageData(id, 0, 0);
      out = { sheet, states };
    }
    this.looksOf.set(key, out);
    return out;
  }

  /** Cells that belong to no map (tools/br/export-fill.py), on a picture `w` x `h` cells, clear
   *  where `at` says null: the page's sea shows through. */
  cells(w: number, h: number, at: (x: number, y: number) => { group: number; num: number; id: number } | null): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = w * BLOCK;
    cv.height = h * BLOCK;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(cv.width, cv.height);
    const px = new Uint32Array(id.data.buffer);
    const drawers = new Map<string, ReturnType<RomArt['blockDrawer']>>();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = at(x, y);
        if (!c) continue;
        const key = `${c.group}:${c.num}`;
        let draw = drawers.get(key);
        if (!draw) {
          const layout = this.u32(this.u32(this.u32(this.sym('gMapGroups') + c.group * 4) + c.num * 4));
          draw = this.blockDrawer(this.tileset(this.u32(layout + 0x10)), this.tileset(this.u32(layout + 0x14)));
          drawers.set(key, draw);
        }
        // The bottom layer's colour 0 is the palette's backdrop, as on the map's own ground.
        for (let row = 0; row < BLOCK; row++) px.fill(0xff000000, (y * BLOCK + row) * cv.width + x * BLOCK, (y * BLOCK + row) * cv.width + (x + 1) * BLOCK);
        draw(px, cv.width, x * BLOCK, y * BLOCK, c.id, false);
      }
    }
    ctx.putImageData(id, 0, 0);
    return cv;
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

  /** A field effect's frames (gFieldEffectObjectTemplatePointers[obj], FLDEFFOBJ_*). Its
   *  images are one picture's frames in a row, and it wears one of the two general palettes. */
  fieldEffect(obj: number, count: number, h: number): HTMLCanvasElement {
    const template = this.u32(this.sym('gFieldEffectObjectTemplatePointers') + obj * 4);
    const FLDEFF_PAL_TAG_GENERAL_0 = 0x1004;
    const palSym = this.u16(template + 2) === FLDEFF_PAL_TAG_GENERAL_0 ? 'gSpritePalette_GeneralFieldEffect0' : 'gSpritePalette_GeneralFieldEffect1';
    return this.frames(this.u32(this.u32(template + 0xc)), count, 16, h, this.palette(this.u32(this.sym(palSym))));
  }

  /** The MAP's picture as the ROM lays it down (region_map.c LoadRegionMapGfx): 64 x 64 cells
   *  of 8bpp tiles, in BG palettes 7 on. Null on a patch that does not say where it is. */
  regionMap(): HTMLCanvasElement | null {
    const at = this.sym('gBrRegionMapArt');
    if (!Number.isFinite(at)) return null;
    const tiles = lz77(this.rom, this.u32(at) - ROM), map = lz77(this.rom, this.u32(at + 4) - ROM), pal = this.u32(at + 8);
    const FIRST = 7 * 16, CELLS = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = CELLS * TILE;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(cv.width, cv.height);
    const px = new Uint32Array(id.data.buffer);
    const colours = new Map<number, number>();
    const colour = (i: number) => {
      let c = colours.get(i);
      if (c === undefined) colours.set(i, (c = i >= FIRST ? rgba(this.u16(pal + (i - FIRST) * 2)) : 0));
      return c;
    };
    for (let i = 0; i < CELLS * CELLS; i++) {
      const off = map[i] * 64, X = (i % CELLS) * TILE, Y = Math.floor(i / CELLS) * TILE;
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px[(Y + y) * cv.width + X + x] = colour(tiles[off + y * TILE + x]);
    }
    ctx.putImageData(id, 0, 0);
    return cv;
  }

  /** A species' party icon, its first frame (gMonIconTable, 32 x 32, in one of the three icon
   *  palettes); null on a patch whose symbols predate it. */
  monIcon(species: number): HTMLCanvasElement | null {
    const table = this.sym('gMonIconTable');
    if (!Number.isFinite(table) || !species) return null;
    const index = this.u8(this.sym('gMonIconPaletteIndices') + species);
    return this.frames(this.u32(table + species * 4), 1, 32, 32, this.palette(this.u32(this.sym('gMonIconPaletteTable') + index * 8)));
  }

  /** The BAG's own sprite, its first frame: 64 x 64 tiles, compressed, on their palette. */
  bagSprite(): HTMLCanvasElement | null {
    const at = this.sym('gBagMaleTiles'), palAt = this.sym('gBagPalette');
    if (!Number.isFinite(at) || !Number.isFinite(palAt)) return null;
    const tiles = lz77(this.rom, at - ROM), pal = lz77(this.rom, palAt - ROM);
    const colours: number[] = [];
    for (let c = 0; c < 16; c++) colours.push(rgba(pal[c * 2] | (pal[c * 2 + 1] << 8)));
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(64, 64);
    const px = new Uint32Array(id.data.buffer);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const b = tiles[((y >> 3) * 8 + (x >> 3)) * 32 + (y & 7) * 4 + ((x & 7) >> 1)];
        const c = (b >> ((x & 1) * 4)) & 0xf;
        if (c) px[y * 64 + x] = colours[c];
      }
    }
    ctx.putImageData(id, 0, 0);
    return cv;
  }

  /** A species' ability, by which of its two (gSpeciesInfo's abilities, gAbilityNames). */
  abilityName(species: number, which: number): string {
    const info = this.sym('gSpeciesInfo'), names = this.sym('gAbilityNames');
    if (!Number.isFinite(info) || !Number.isFinite(names)) return '';
    const SPECIES_INFO = 0x1c, ABILITIES = 0x16, ABILITY_NAME = 13;
    const row = info + species * SPECIES_INFO + ABILITIES;
    const id = this.u8(row + (which ? 1 : 0)) || this.u8(row);
    return text(this.letters(names + id * ABILITY_NAME, ABILITY_NAME));
  }

  /** The contest's curtain as its tilemap has it, 32 x 20 tiles (contest.c
   *  SetBgForCurtainDrop: gContestCurtainTilemap in the interface's tiles); null on a patch
   *  whose symbols predate it. */
  contestCurtain(): HTMLCanvasElement | null {
    const at = ['gContestCurtainTilemap', 'gContestInterfaceGfx', 'gContestInterfaceAudiencePalette'].map((n) => this.sym(n));
    if (!at.every(Number.isFinite)) return null;
    const map = lz77(this.rom, at[0] - ROM), tiles = lz77(this.rom, at[1] - ROM), pal = lz77(this.rom, at[2] - ROM);
    const dvMap = new DataView(map.buffer, map.byteOffset, map.byteLength), dvPal = new DataView(pal.buffer, pal.byteOffset, pal.byteLength);
    const cv = document.createElement('canvas');
    cv.width = 32 * TILE;
    cv.height = 20 * TILE;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(cv.width, cv.height);
    const px = new Uint32Array(id.data.buffer);
    for (let i = 0; i < 32 * 20; i++) {
      const e = dvMap.getUint16(i * 2, true);
      const line = (e >> 12) & 0xf, off = (e & 0x3ff) * 32, hf = e & 0x400, vf = e & 0x800;
      for (let y = 0; y < TILE; y++) {
        const row = off + (vf ? TILE - 1 - y : y) * 4;
        for (let x = 0; x < TILE; x++) {
          const sx = hf ? TILE - 1 - x : x;
          const c = (tiles[row + (sx >> 1)] >> ((sx & 1) * 4)) & 0xf;
          if (c) px[(Math.floor(i / 32) * TILE + y) * cv.width + (i % 32) * TILE + x] = rgba(dvPal.getUint16((line * 16 + c) * 2, true));
        }
      }
    }
    ctx.putImageData(id, 0, 0);
    return cv;
  }

  // ---- a fight (battleview.ts) ----

  private made = new Map<string, HTMLCanvasElement | null>();
  private once<T extends HTMLCanvasElement | null>(key: string, make: () => T): T {
    if (!this.made.has(key)) this.made.set(key, make());
    return this.made.get(key) as T;
  }
  private have(...names: string[]): boolean {
    return names.every((n) => Number.isFinite(this.sym(n)));
  }
  private lz(ptr: number): Uint8Array {
    return lz77(this.rom, ptr - ROM);
  }
  /** `count` colours of 15-bit words from `at` in `bytes`, as the canvas wants them. */
  private words(bytes: Uint8Array, count: number, at = 0): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(rgbaWide(bytes[at + i * 2] | (bytes[at + i * 2 + 1] << 8)));
    return out;
  }
  private raw(at: number, count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(rgbaWide(this.u16(at + i * 2)));
    return out;
  }
  /** 4bpp tiles (`w` x `h` pixels, a row of tiles after a row), colour 0 clear. */
  private picture(tiles: Uint8Array, w: number, h: number, pal: number[], from = 0): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(w, h);
    const px = new Uint32Array(id.data.buffer);
    const tw = w / TILE;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const b = tiles[from + ((y >> 3) * tw + (x >> 3)) * 32 + (y & 7) * 4 + ((x & 7) >> 1)];
        const c = (b >> ((x & 1) * 4)) & 0xf;
        if (c) px[y * w + x] = pal[c];
      }
    }
    ctx.putImageData(id, 0, 0);
    return cv;
  }

  /** A species' battle picture, 64 x 64: the front one's first frame (it holds two), or the back
   *  one; in its palette, or the shiny one. Null for a species the ROM has no picture for or a
   *  patch whose symbols predate this. */
  monPic(species: number, back: boolean, shiny = false): HTMLCanvasElement | null {
    const pics = back ? 'gMonBackPicTable' : 'gMonFrontPicTable', pals = shiny ? 'gMonShinyPaletteTable' : 'gMonPaletteTable';
    if (!this.have(pics, pals) || !(species > 0 && species < NUM_SPECIES)) return null;
    return this.once(`mon:${species}:${back}:${shiny}`, () => {
      const data = this.u32(this.sym(pics) + species * 8), pal = this.u32(this.sym(pals) + species * 8);
      if (data < ROM || pal < ROM) return null;
      return this.picture(this.lz(data), 64, 64, this.words(this.lz(pal), 16));
    });
  }

  /** Where a species stands: MonCoords' size byte and the y offset that puts its picture's middle on
   *  the platform (gMonFrontPicCoords / gMonBackPicCoords: four bytes a row), and how high a flier hovers. */
  monCoords(species: number, back: boolean): { size: number; y: number; lift: number } | null {
    const t = this.sym(back ? 'gMonBackPicCoords' : 'gMonFrontPicCoords');
    if (!Number.isFinite(t) || !(species >= 0 && species < NUM_SPECIES)) return null;
    const e = this.sym('gEnemyMonElevation');
    return { size: this.u8(t + species * 4), y: this.u8(t + species * 4 + 1), lift: Number.isFinite(e) ? this.u8(e + species) : 0 };
  }

  /** A trainer's picture, 64 x 64, by its TRAINER_PIC_* (the front table) or TRAINER_BACK_PIC_*. */
  trainerPic(pic: number, back: boolean): HTMLCanvasElement | null {
    const pics = back ? 'gTrainerBackPicTable' : 'gTrainerFrontPicTable', pals = back ? 'gTrainerBackPicPaletteTable' : 'gTrainerFrontPicPaletteTable';
    if (!this.have(pics, pals) || !(pic >= 0 && pic < 100)) return null;
    return this.once(`trainer:${pic}:${back}`, () => {
      const data = this.u32(this.sym(pics) + pic * 8), pal = this.u32(this.sym(pals) + pic * 8);
      if (data < ROM || pal < ROM) return null;
      // A back picture is four frames of the throw, stored plain; a front one is one, compressed.
      return back ? this.picture(this.rom, 64, 64, this.words(this.lz(pal), 16), data - ROM) : this.picture(this.lz(data), 64, 64, this.words(this.lz(pal), 16));
    });
  }

  /** A trainer picture's size in tiles (what its y is worked from: (8 - size) * 4). */
  trainerSize(pic: number, back: boolean): number {
    const t = this.sym(back ? 'gTrainerBackPicCoords' : 'gTrainerFrontPicCoords');
    if (!Number.isFinite(t)) return 8;
    const s = this.u8(t + pic * 4);
    return s > 8 ? s & 0xf : s;
  }

  /** The ground of a fight, 240 x 160: the environment's tiles laid by its tilemap (the first 30 x 20
   *  of its 32 x 32) in its three palettes. `seeThrough` clears its sky and ground stripes as
   *  a match's does, leaving the two platforms. Null on a patch that does not name it. */
  battleGround(env: BattleEnv, seeThrough: boolean): HTMLCanvasElement | null {
    const [tilesOf, palOf] = ENV_ART[env];
    const names = [`gBattleEnvironmentTiles_${tilesOf}`, `gBattleEnvironmentTilemap_${tilesOf}`, `gBattleEnvironmentPalette_${palOf}`];
    if (!this.have(...names)) return null;
    return this.once(`ground:${env}:${seeThrough}`, () => {
      const tiles = this.lz(this.sym(names[0])), map = this.lz(this.sym(names[1])), pal = this.words(this.lz(this.sym(names[2])), 48);
      const cv = document.createElement('canvas');
      cv.width = 240;
      cv.height = 160;
      const ctx = cv.getContext('2d')!;
      const id = ctx.createImageData(240, 160);
      const px = new Uint32Array(id.data.buffer);
      for (let i = 0; i < 30 * 20; i++) {
        const cx = i % 30, cy = Math.floor(i / 30);
        const e = map[(cy * 32 + cx) * 2] | (map[(cy * 32 + cx) * 2 + 1] << 8);
        const bank = ((e >> 12) & 0xf) - 2, off = (e & 0x3ff) * 32, hf = e & 0x400, vf = e & 0x800;
        if (bank < 0 || bank > 2 || off + 32 > tiles.length) continue;
        for (let y = 0; y < TILE; y++) {
          const row = off + (vf ? TILE - 1 - y : y) * 4;
          for (let x = 0; x < TILE; x++) {
            const sx = hf ? TILE - 1 - x : x;
            const c = (tiles[row + (sx >> 1)] >> ((sx & 1) * 4)) & 0xf;
            if (!c || (seeThrough && SEE_THROUGH.includes(bank * 16 + c))) continue;
            px[(cy * TILE + y) * 240 + cx * TILE + x] = pal[bank * 16 + c];
          }
        }
      }
      ctx.putImageData(id, 0, 0);
      return cv;
    });
  }

  /** The message box (the first screen of gBattleTextboxTilemap: rows 14 to 19), 240 x 48, to sit at
   *  y 112; and the colours its words are set in (the palette's 1 and 6, text.pal's white and its
   *  shadow). */
  battleTextbox(): { box: HTMLCanvasElement; fg: string; shadow: string } | null {
    if (this.textbox === undefined) this.textbox = this.makeTextbox();
    return this.textbox;
  }
  private textbox: { box: HTMLCanvasElement; fg: string; shadow: string } | null | undefined;
  private makeTextbox(): { box: HTMLCanvasElement; fg: string; shadow: string } | null {
    if (!this.have('gBattleTextboxTiles', 'gBattleTextboxPalette', 'gBattleTextboxTilemap')) return null;
    const tiles = this.lz(this.sym('gBattleTextboxTiles')), map = this.lz(this.sym('gBattleTextboxTilemap')), pal = this.words(this.lz(this.sym('gBattleTextboxPalette')), 32);
    const cv = document.createElement('canvas');
    cv.width = 240;
    cv.height = 48;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(240, 48);
    const px = new Uint32Array(id.data.buffer);
    for (let i = 0; i < 30 * 6; i++) {
      const cx = i % 30, cy = Math.floor(i / 30) + 14;
      const e = map[(cy * 32 + cx) * 2] | (map[(cy * 32 + cx) * 2 + 1] << 8);
      const bank = (e >> 12) & 0xf, off = (e & 0x3ff) * 32, hf = e & 0x400, vf = e & 0x800;
      if (bank > 1 || off + 32 > tiles.length) continue;
      for (let y = 0; y < TILE; y++) {
        const row = off + (vf ? TILE - 1 - y : y) * 4;
        for (let x = 0; x < TILE; x++) {
          const sx = hf ? TILE - 1 - x : x;
          const c = (tiles[row + (sx >> 1)] >> ((sx & 1) * 4)) & 0xf;
          if (c) px[((cy - 14) * TILE + y) * 240 + cx * TILE + x] = pal[bank * 16 + c];
        }
      }
    }
    ctx.putImageData(id, 0, 0);
    const css = (c: number) => `rgb(${c & 0xff},${(c >> 8) & 0xff},${(c >> 16) & 0xff})`;
    return { box: cv, fg: css(pal[1]), shadow: css(pal[6]) };
  }

  /** A health box's frame (gHealthboxSinglesPlayerGfx for the near one, the opponent's for the far),
   *  in the box palette, and its tiles of bar, label and status. */
  healthbox(near: boolean): HealthboxArt | null {
    const key = near ? 1 : 0;
    if (!this.boxArt.has(key)) this.boxArt.set(key, this.makeHealthbox(near));
    return this.boxArt.get(key)!;
  }
  private boxArt = new Map<number, HealthboxArt | null>();
  private makeHealthbox(near: boolean): HealthboxArt | null {
    const names = [near ? 'gHealthboxSinglesPlayerGfx' : 'gHealthboxSinglesOpponentGfx', 'gBattleInterface_BallStatusBarPal', 'gBattleInterface_BallDisplayPal', 'gHealthboxElementsGfxTable'];
    if (!this.have(...names)) return null;
    const boxPal = this.raw(this.sym(names[1]), 16), barPal = this.raw(this.sym(names[2]), 16);
    const data = this.lz(this.sym(names[0]));
    // Sprite 1's tiles, then sprite 2's, each in 8-wide rows; 64 x 64 apiece for the near box,
    // 64 x 32 for the far (-mwidth 8 -mheight 8|4).
    const rows = near ? 8 : 4, per = rows * 8;
    const box = this.once(`healthbox:${near}`, () => {
      const cv = document.createElement('canvas');
      cv.width = 128;
      cv.height = rows * 8;
      const ctx = cv.getContext('2d')!;
      for (let t = 0; t < per * 2; t++) {
        const tile = this.picture(data, TILE, TILE, boxPal, t * 32);
        ctx.drawImage(tile, (t >= per ? 64 : 0) + ((t % per) & 7) * TILE, (((t % per) >> 3) & 7) * TILE);
      }
      return cv;
    });
    const elements = this.sym(names[3]);
    const css = (c: number) => `rgb(${c & 0xff},${(c >> 8) & 0xff},${(c >> 16) & 0xff})`;
    return {
      box,
      ink: { fg: css(boxPal[1]), shadow: css(boxPal[3]), male: css(boxPal[11]), female: css(boxPal[10]) },
      tile: (element, status) => this.once(`tile:${element}:${status ? `${status.slot}:${status.colour}` : ''}`, () => {
        const pal = status ? boxPal.map((c, i) => (i === status.slot ? rgbaWide(status.colour) : c)) : barPal;
        return this.picture(this.rom, TILE, TILE, pal, elements - ROM + element * 32);
      }),
    };
  }

  private fonts = new Map<string, RomFont | null>();
  /** One of the ROM's Latin fonts, 'small' for the health boxes' words or 'normal'. */
  font(which: 'small' | 'normal'): RomFont | null {
    if (this.fonts.has(which)) return this.fonts.get(which)!;
    const name = which === 'small' ? 'gFontSmallLatin' : 'gFontNormalLatin';
    let font: RomFont | null = null;
    if (this.have(`${name}Glyphs`, `${name}GlyphWidths`)) {
      const index = new Uint8Array(512 * 256), glyphs = this.sym(`${name}Glyphs`) - ROM;
      for (let g = 0; g < 512; g++) {
        [[0, 0, 0], [8, 0, 16], [0, 8, 32], [8, 8, 48]].forEach(([ox, oy, off]) => {
          for (let y = 0; y < 8; y++) {
            const v = this.dv.getUint16(glyphs + g * 64 + off + y * 2, true);
            for (let x = 0; x < 8; x++) index[g * 256 + (oy + y) * 16 + ox + x] = (v >> (2 * (7 - x))) & 3;
          }
        });
      }
      const w = this.sym(`${name}GlyphWidths`) - ROM;
      font = new RomFont(index, this.rom.slice(w, w + 512));
    }
    this.fonts.set(which, font);
    return font;
  }

  /** A species' name as the ROM has it (gSpeciesNames, 11 letters a row). */
  speciesName(species: number): string {
    const t = this.sym('gSpeciesNames');
    return Number.isFinite(t) && species > 0 && species < NUM_SPECIES ? text(this.letters(t + species * 11, 11)) : '';
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
