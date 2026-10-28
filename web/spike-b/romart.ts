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

const ROM = 0x08000000;
const TILE = 8;
const BLOCK = 16;
const LAYER_COVERED = 1;
const PAL_TAG_NONE = 0x11ff;

export interface MapArt { ground: HTMLCanvasElement; cover: HTMLCanvasElement; border: HTMLCanvasElement }

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

interface Tileset { tiles: Uint8Array; palettes: number[][]; metatiles: number; attrs: number }

export class RomArt {
  private dv: DataView;
  private tilesets = new Map<number, Tileset>();
  private objPals: Map<number, number[]> | null = null;

  constructor(private rom: Uint8Array, private sym: (name: string) => number) {
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

  /** Ground, cover and border for map (group, num), as render-maps.py draws them. */
  map(group: number, num: number): MapArt {
    const header = this.u32(this.u32(this.sym('gMapGroups') + group * 4) + num * 4);
    const layout = this.u32(header);
    const w = this.dv.getInt32(layout - ROM, true), h = this.dv.getInt32(layout + 4 - ROM, true);
    const border = this.u32(layout + 8), blocks = this.u32(layout + 0xc);
    const pri = this.tileset(this.u32(layout + 0x10)), sec = this.tileset(this.u32(layout + 0x14));
    // Primary palettes 0..5, the secondary's 6..12, the primary's again from 13.
    const pals = [...pri.palettes.slice(0, 6), ...sec.palettes.slice(6, 13), ...pri.palettes.slice(13)];
    const draw = (px: Uint32Array, stride: number, bx: number, by: number, block: number, cover: boolean) => {
      const mid = block & 0x3ff;
      const ts = mid < 512 ? pri : sec;
      const i = mid < 512 ? mid : mid - 512;
      if (cover && ((this.u16(ts.attrs + i * 2) >> 12) & 0xf) === LAYER_COVERED) return;
      for (let layer = cover ? 1 : 0; layer < 2; layer++) {
        for (let t = 0; t < 4; t++) {
          const e = this.u16(ts.metatiles + i * 16 + (layer * 4 + t) * 2);
          const tid = e & 0x3ff;
          const src = tid < 512 ? pri.tiles : sec.tiles;
          const off = (tid < 512 ? tid : tid - 512) * 32;
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
      for (let i = 0; i < w * h; i++) draw(px, W, (i % w) * BLOCK, Math.floor(i / w) * BLOCK, this.u16(blocks + i * 2), false);
    });
    const cover = paint(W, h * BLOCK, 0, (px) => {
      for (let i = 0; i < w * h; i++) draw(px, W, (i % w) * BLOCK, Math.floor(i / w) * BLOCK, this.u16(blocks + i * 2), true);
    });
    const borderCv = paint(2 * BLOCK, 2 * BLOCK, 0xff000000, (px) => {
      for (let i = 0; i < 4; i++) draw(px, 2 * BLOCK, (i & 1) * BLOCK, (i >> 1) * BLOCK, this.u16(border + i * 2), false);
    });
    return { ground, cover, border: borderCv };
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
   *  44 bytes a row), in capitals and digits; '' for an id the table does not have. */
  itemName(id: number): string {
    const row = this.sym('gItems') + id * 44;
    if (this.u16(row + 14) !== id) return '';
    let out = '';
    for (let i = 0; i < 14; i++) {
      const c = this.rom[row - ROM + i];
      if (c === 0xff) break;
      out += c >= 0xbb && c <= 0xd4 ? String.fromCharCode(65 + c - 0xbb)
        : c >= 0xd5 && c <= 0xee ? String.fromCharCode(97 + c - 0xd5)
        : c >= 0xa1 && c <= 0xaa ? String.fromCharCode(48 + c - 0xa1)
        : c === 0x1b ? 'é' : c === 0xae ? '-' : c === 0xad ? '.' : ' ';
    }
    return out;
  }

  /** gfx's frames left to right, colour 0 clear, as export-sprites.py lays them out. */
  sprite(gfx: number, frames: number): HTMLCanvasElement {
    const info = this.u32(this.sym('gObjectEventGraphicsInfoPointers') + gfx * 4);
    const pal = this.objectPalettes().get(this.u16(info + 2)) ?? new Array(16).fill(0xffff00ff);
    const w = this.s16(info + 8), h = this.s16(info + 10);
    const images = this.u32(info + 28);
    const cv = document.createElement('canvas');
    cv.width = w * frames;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    const id = ctx.createImageData(cv.width, h);
    const px = new Uint32Array(id.data.buffer);
    const tw = w / TILE;
    for (let f = 0; f < frames; f++) {
      const data = this.u32(images + f * 8) - ROM;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const tile = (y >> 3) * tw + (x >> 3);
          const b = this.rom[data + tile * 32 + (y & 7) * 4 + ((x & 7) >> 1)];
          const c = (b >> ((x & 1) * 4)) & 0xf;
          if (c) px[y * cv.width + f * w + x] = pal[c];
        }
      }
    }
    ctx.putImageData(id, 0, 0);
    return cv;
  }
}
