// Emerald's own look for the page outside the game (POK-320): its font, its window
// frame, its message box and its people, drawn on a canvas at an integer scale, the
// way the picture is. Everything here is the ROM's: the glyphs and their widths are
// `graphics/fonts/latin_normal.png` + `gFontNormalLatinGlyphWidths`, the frame is
// `graphics/text_window/1.png`, the colours are `text_pal1.pal`, the sprites are the
// object-event sheets export-sprites.py wrote (tools/br/export-ui.py).
//
// The pure parts -- measuring text, laying out a frame's tiles, hit testing -- are
// plain functions so ui.test.ts can pin them without a canvas.
import uiData from '../data/ui.json';
import spritesData from '../data/sprites.json';
import { encodeGen3 } from '../text/gen3';

export const CELL = 16;
export const TILE = 8;
const FONT = uiData.font as { cell: number; cols: number; widths: number[] };
const PALETTES = uiData.textPalettes as Record<string, number[][]>;
export const SKIN_GFX = uiData.skins as number[];
const SHEETS = spritesData as Record<string, { w: number; h: number; frames: number }>;

/** A text colour: what the glyphs' index 1 (the letter) and index 2 (its shadow)
 *  become; index 3, the cell's background, stays clear so the window shows through. */
export interface TextColor {
  fg: string;
  shadow: string;
}

const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
/** Emerald's ordinary menu text: dark gray with a light gray shadow (text_pal1: bg,
 *  white, dark, light). */
export const TEXT_DARK: TextColor = { fg: rgb(PALETTES.pal1[2]), shadow: rgb(PALETTES.pal1[3]) };
/** White on a dark box, the message box's style. */
export const TEXT_WHITE: TextColor = { fg: rgb(PALETTES.pal1[1]), shadow: rgb(PALETTES.pal1[2]) };
/** A lighter line under a dark one: the detail on a row, the note under a list. */
export const TEXT_GRAY: TextColor = { fg: rgb(PALETTES.pal1[3]), shadow: rgb(PALETTES.pal1[1]) };
/** Emerald's three coloured texts (TEXT_COLOR_RED/GREEN/BLUE with their own shadows). */
export const TEXT_RED: TextColor = { fg: rgb(PALETTES.pal1[4]), shadow: rgb(PALETTES.pal1[5]) };
export const TEXT_GREEN: TextColor = { fg: rgb(PALETTES.pal1[6]), shadow: rgb(PALETTES.pal1[7]) };
export const TEXT_BLUE: TextColor = { fg: rgb(PALETTES.pal1[8]), shadow: rgb(PALETTES.pal1[9]) };
/** The frame's inside, Emerald's window white. */
export const WINDOW_FILL = '#ffffff';
/** The page behind every drawn screen: the dark the site already wears. */
export const STAGE_FILL = '#101418';

/** A charmap byte for each character; an unknown character is a space. */
export function glyphIds(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    try {
      out.push(encodeGen3(ch)[0] ?? 0);
    } catch {
      out.push(0);
    }
  }
  return out;
}

/** The width of a string in the font's pixels, as the ROM would print it. */
export function measure(text: string): number {
  return glyphIds(text).reduce((w, id) => w + (FONT.widths[id] ?? 6), 0);
}

/** `text` cut to `maxW` pixels of the font, with an ellipsis when it was. */
export function fitText(text: string, maxW: number): string {
  if (measure(text) <= maxW) return text;
  const tail = measure('…');
  let out = text;
  while (out.length > 0 && measure(out) + tail > maxW) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Where a frame's tiles go for a box of `w` x `h` pixels (multiples of 8): the
 *  corners once, the edges repeated, the inside filled. Returned as (tile column,
 *  tile row) of the 3x3 frame for each 8-px cell, row-major. */
export function frameTiles(w: number, h: number): { dx: number; dy: number; tx: number; ty: number }[] {
  const cols = Math.max(2, Math.round(w / TILE));
  const rows = Math.max(2, Math.round(h / TILE));
  const out: { dx: number; dy: number; tx: number; ty: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tx = c === 0 ? 0 : c === cols - 1 ? 2 : 1;
      const ty = r === 0 ? 0 : r === rows - 1 ? 2 : 1;
      out.push({ dx: c * TILE, dy: r * TILE, tx, ty });
    }
  }
  return out;
}

/** The sheet a skin wears, and its standing frame (the ROM's first: facing south). */
export function skinSheet(skin: number): { gfx: number; w: number; h: number } | null {
  const gfx = SKIN_GFX[skin] ?? SKIN_GFX[0];
  const info = SHEETS[String(gfx)];
  return info ? { gfx, w: info.w, h: info.h } : null;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/** The font mask recoloured for one text colour, once. */
function tintFont(mask: HTMLImageElement, color: TextColor): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(mask, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const parse = (s: string) => s.match(/\d+/g)!.map(Number);
  const fg = parse(color.fg);
  const sh = parse(color.shadow);
  // A glyph's cell: 1 is the letter, 2 its shadow, 3 the cell's background (the
  // window shows through it), 0 nothing.
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const idx = d[i];
    if (idx === 3) {
      d[i + 3] = 0;
      continue;
    }
    const col = idx === 2 ? sh : fg;
    d[i] = col[0];
    d[i + 1] = col[1];
    d[i + 2] = col[2];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** A canvas that draws in GBA pixels and scales up whole, like the picture. */
export class EmeraldCanvas {
  private ctx: CanvasRenderingContext2D;
  private fonts = new Map<TextColor, HTMLCanvasElement>();
  private sheets = new Map<number, HTMLImageElement>();
  private ready: Promise<void>;
  private mask: HTMLImageElement | null = null;
  private frame: HTMLImageElement | null = null;
  private box: HTMLImageElement | null = null;
  /** Called when a sheet or the font lands, so whoever drew without it can draw again. */
  onLoad: (() => void) | null = null;
  /** The logical size, in GBA pixels. */
  width = 240;
  height = 160;
  scale = 1;
  /** Added to every x drawn: where a 240-wide screen sits on a wider canvas. */
  origin = 0;

  constructor(public readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ready = Promise.all([loadImage('/ui/font-normal.png'), loadImage('/ui/frame-1.png'), loadImage('/ui/message-box.png')]).then(
      ([mask, frame, box]) => {
        this.mask = mask;
        this.frame = frame;
        this.box = box;
        this.onLoad?.();
      },
    );
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  /** `w` x `h` GBA pixels shown at `scale` CSS pixels each. */
  resize(w: number, h: number, scale: number): void {
    this.scale = scale;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${w * scale}px`;
    this.canvas.style.height = `${h * scale}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** A CSS point on the canvas, in GBA pixels. */
  toPixel(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.floor((clientX - r.left) / this.scale), y: Math.floor((clientY - r.top) / this.scale) };
  }

  clear(color = STAGE_FILL): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  fillRect(r: Rect, color: string, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(r.x + this.origin, r.y, r.w, r.h);
    this.ctx.globalAlpha = 1;
  }

  /** Emerald's window: the frame around a white inside. */
  drawFrame(r: Rect): void {
    const { ctx, frame } = this;
    const x0 = r.x + this.origin;
    ctx.fillStyle = WINDOW_FILL;
    ctx.fillRect(x0 + TILE, r.y + TILE, r.w - 2 * TILE, r.h - 2 * TILE);
    if (!frame) return;
    for (const t of frameTiles(r.w, r.h)) {
      if (t.tx === 1 && t.ty === 1) continue;
      ctx.drawImage(frame, t.tx * TILE, t.ty * TILE, TILE, TILE, x0 + t.dx, r.y + t.dy, TILE, TILE);
    }
  }

  /** Text at (x, y), the glyphs' top-left, in one colour. Returns the width drawn. */
  drawText(text: string, x: number, y: number, color: TextColor = TEXT_DARK): number {
    if (!this.mask) return measure(text);
    let font = this.fonts.get(color);
    if (!font) {
      font = tintFont(this.mask, color);
      this.fonts.set(color, font);
    }
    let cx = x + this.origin;
    for (const id of glyphIds(text)) {
      const sx = (id % FONT.cols) * CELL;
      const sy = Math.floor(id / FONT.cols) * CELL;
      this.ctx.drawImage(font, sx, sy, CELL, CELL, cx, y, CELL, CELL);
      cx += FONT.widths[id] ?? 6;
    }
    return cx - x - this.origin;
  }

  drawTextCentred(text: string, cx: number, y: number, color?: TextColor): void {
    this.drawText(text, Math.round(cx - measure(text) / 2), y, color);
  }

  /** A person from their sheet: the standing frame, top-left at (x, y). Faded for a
   *  seat nobody has taken yet. Returns false while the sheet is still loading. */
  drawSprite(gfx: number, x: number, y: number, alpha = 1, frame = 0): boolean {
    const info = SHEETS[String(gfx)];
    if (!info) return true;
    let img = this.sheets.get(gfx);
    if (!img) {
      const el = new Image();
      el.decoding = 'async';
      el.onload = () => this.onLoad?.();
      el.src = `/field-sprites/${gfx}.png`;
      this.sheets.set(gfx, el);
      img = el;
    }
    if (!img.complete || img.naturalWidth === 0) return false;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(img, Math.min(frame, info.frames - 1) * info.w, 0, info.w, info.h, x + this.origin, y, info.w, info.h);
    this.ctx.globalAlpha = 1;
    return true;
  }

  /** The cursor Emerald's menus use: a small right-pointing triangle. */
  drawCursor(x: number, y: number, color = TEXT_DARK): void {
    this.ctx.fillStyle = color.fg;
    for (let i = 0; i < 4; i++) this.ctx.fillRect(x + this.origin + i, y + 2 + i, 1, 7 - 2 * i);
  }
}
