// The field's pictures, cut from the player's own ROM (HBR-66).
//
// The site ships no Nintendo pictures: the ground, the cover over people, the border past
// a map's edge, every person's sprite sheet, the SURF blob, the fog and the encounter
// patches' marks are drawn here from the ROM bytes the player brought, pixel for pixel
// what tools/br/render-maps.py and export-sprites.py draw from pret's files. Only
// addresses (br-symbols.json) and frame counts (sprites.json) come from the site.
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
/** The player's palette, which the SURF blob's TAG_NONE template draws in. */
const PAL_TAG_BRENDAN = 0x1100;
const SHADOW_COLOUR = 15;

/** A picture as 8-bit RGBA packed little-endian (a canvas ImageData's buffer), 0 clear. */
export interface Picture {
  w: number;
  h: number;
  px: Uint32Array;
}

export type MapLayer = 'ground' | 'cover' | 'border';
export type Mark = 'tall-grass' | 'water' | 'shadow';

/** One of the pictures the page draws past the LCD. */
export type ArtRequest =
  | { t: 'map'; group: number; num: number; layer: MapLayer }
  | { t: 'sheet'; gfx: number; frames: number }
  | { t: 'surf' }
  | { t: 'fog' }
  | { t: 'mark'; mark: Mark };

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

/** BGR555 to the 8-bit RGBA a canvas wants, as render-maps.py widens it (v << 3). */
export function rgba(c: number): number {
  const r = (c & 31) << 3, g = ((c >> 5) & 31) << 3, b = ((c >> 10) & 31) << 3;
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

interface Tileset { tiles: Uint8Array; palettes: number[][]; metatiles: number; attrs: number }

export class RomArt {
  private dv: DataView;
  private tilesets = new Map<number, Tileset>();
  private maps = new Map<string, Record<MapLayer, Picture>>();
  private objPals: Map<number, number[]> | null = null;

  constructor(private rom: Uint8Array, private sym: (name: string) => number | undefined) {
    this.dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  }

  draw(r: ArtRequest): Picture {
    switch (r.t) {
      case 'map': return this.map(r.group, r.num)[r.layer];
      case 'sheet': return this.sheet(r.gfx, r.frames);
      case 'surf': return this.frames(this.need('gFieldEffectObjectPic_SurfBlob'), 32, 32, 3, this.objectPalettes().get(PAL_TAG_BRENDAN)!);
      case 'fog': return this.frames(this.need('gWeatherFogHorizontalTiles'), 64, 64, 1, this.palette(this.need('gFogPalette')));
      case 'mark': return this.mark(r.mark);
    }
  }

  private need(name: string): number {
    const at = this.sym(name);
    if (at === undefined || Number.isNaN(at)) throw new Error(`no ${name} in br-symbols.json`);
    return at;
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
  private map(group: number, num: number): Record<MapLayer, Picture> {
    const key = `${group}:${num}`;
    const have = this.maps.get(key);
    if (have) return have;
    const header = this.u32(this.u32(this.need('gMapGroups') + group * 4) + num * 4);
    const layout = this.u32(header);
    const w = this.dv.getInt32(layout - ROM, true), h = this.dv.getInt32(layout + 4 - ROM, true);
    const border = this.u32(layout + 8), blocks = this.u32(layout + 0xc);
    const pri = this.tileset(this.u32(layout + 0x10)), sec = this.tileset(this.u32(layout + 0x14));
    // Primary palettes 0..5, the secondary's 6..12, the primary's again from 13.
    const pals = [...pri.palettes.slice(0, 6), ...sec.palettes.slice(6, 13), ...pri.palettes.slice(13)];
    const block = (px: Uint32Array, stride: number, bx: number, by: number, id: number, cover: boolean) => {
      const mid = id & 0x3ff;
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
    const paint = (pw: number, ph: number, fill: number, each: (px: Uint32Array) => void): Picture => {
      const px = new Uint32Array(pw * ph).fill(fill);
      each(px);
      return { w: pw, h: ph, px };
    };
    const W = w * BLOCK;
    const BLACK = 0xff000000;
    const art = {
      ground: paint(W, h * BLOCK, BLACK, (px) => {
        for (let i = 0; i < w * h; i++) block(px, W, (i % w) * BLOCK, Math.floor(i / w) * BLOCK, this.u16(blocks + i * 2), false);
      }),
      cover: paint(W, h * BLOCK, 0, (px) => {
        for (let i = 0; i < w * h; i++) block(px, W, (i % w) * BLOCK, Math.floor(i / w) * BLOCK, this.u16(blocks + i * 2), true);
      }),
      border: paint(2 * BLOCK, 2 * BLOCK, BLACK, (px) => {
        for (let i = 0; i < 4; i++) block(px, 2 * BLOCK, (i & 1) * BLOCK, (i >> 1) * BLOCK, this.u16(border + i * 2), false);
      }),
    };
    this.maps.set(key, art);
    return art;
  }

  private objectPalettes(): Map<number, number[]> {
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

  /** `count` frames of w x h 4bpp tiles, `data` onwards, left to right, colour 0 clear. */
  private frames(data: number | number[], w: number, h: number, count: number, pal: number[]): Picture {
    const W = w * count;
    const px = new Uint32Array(W * h);
    const tw = w / TILE;
    for (let f = 0; f < count; f++) {
      const at = (typeof data === 'number' ? data + f * w * h / 2 : data[f]) - ROM;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const tile = (y >> 3) * tw + (x >> 3);
          const b = this.rom[at + tile * 32 + (y & 7) * 4 + ((x & 7) >> 1)];
          const c = (b >> ((x & 1) * 4)) & 0xf;
          if (c) px[y * W + f * w + x] = pal[c];
        }
      }
    }
    return { w: W, h, px };
  }

  /** gfx's frames left to right, as export-sprites.py lays them out. */
  private sheet(gfx: number, count: number): Picture {
    const info = this.u32(this.need('gObjectEventGraphicsInfoPointers') + gfx * 4);
    const pal = this.objectPalettes().get(this.u16(info + 2)) ?? new Array<number>(16).fill(0xffff00ff);
    const images = this.u32(info + 28);
    const data: number[] = [];
    for (let f = 0; f < count; f++) data.push(this.u32(images + f * 8));
    return this.frames(data, this.s16(info + 8), this.s16(info + 10), count, pal);
  }

  /** An encounter patch's mark, its first frame, in the palette br_patch.c's Draw gives it. */
  private mark(mark: Mark): Picture {
    // gBrPatchArt (src/br/br_patch.c): the tall grass's picture, the water's, its colours.
    const art = this.need('gBrPatchArt');
    if (mark === 'shadow') {
      const black = this.palette(this.need('gFieldEffectObjectPalette0'))[SHADOW_COLOUR];
      return this.frames(this.need('gFieldEffectObjectPic_ShadowMedium'), 16, 8, 1, new Array<number>(16).fill(black));
    }
    if (mark === 'water') return this.frames(this.u32(art + 4), 16, 16, 1, this.palette(this.u32(art + 8)));
    return this.frames(this.u32(art), 16, 16, 1, this.palette(this.need('gFieldEffectObjectPalette1')));
  }
}
