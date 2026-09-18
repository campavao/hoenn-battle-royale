// The field past the picture (POK-317). The GBA draws 240x160 and nothing else, and on a
// phone that is a third of the glass. Cam's reference is a Game Boy Pokémon rendered past
// its LCD so the map fills the screen, the fight in the middle band with the field still
// around it. So this draws the rest: a still of the map (tools/br/render-maps.py, in
// web/public/field-maps/) scrolled in lockstep with the ROM's own camera, on a canvas
// under the picture, at the picture's own scale. Nothing is zoomed and nothing is
// stretched -- the picture is where the ROM's window is, and the map continues out of it.
//
// What the border is not: object events (people, ghosts, loot balls), tile animation,
// weather. The ROM never rendered those out there and the page does not know them.
//
// Where the window sits on the map was MEASURED, not derived (tools/br/drivers/
// field-scroll.txt and field-scroll-trace.txt, matched against the render): with the ROM
// at rest at gSaveBlock1Ptr->pos = (x, y) the picture's top-left is map pixel
// (x*16 - 112, y*16 - 72). Mid-step, gFieldCamera.x/y hold the sub-tile offset: the tile
// advances on the step's FIRST frame and the offset then runs 4, 8, 12, 0 at a run (2, 4,
// .. at a walk), so the picture is at (x*16 - 112 + (sub - 16)) until the step lands. And
// the picture lags the struct by exactly one frame -- the scroll registers are written at
// the VBlank that ends a frame's logic and drawn during the next -- so what is drawn here
// is the state read the frame BEFORE.
import type { WorldMap } from './bots/world';
import worldData from './data/world.json';
import type { Emulator } from './emu';

export const GBA_W = 240;
export const GBA_H = 160;
const TILE = 16;
/** The picture's top-left, relative to the pos tile's top-left, at rest. Measured. */
export const LCD_LEFT = 112;
export const LCD_TOP = 72;
/** The border block is 2x2 metatiles, indexed by the parity of grid coords, which carry
 *  MAP_OFFSET 7 -- so block (0,0) of the pattern sits on the map's ODD coordinates. */
const BORDER_ORIGIN = -TILE;
const BORDER_SIZE = 2 * TILE;

/** `struct CameraObject` (include/field_camera.h): callback, spriteId, speedX, speedY, x, y. */
const CAMERA_X = 16;
const CAMERA_Y = 20;
/** `struct SaveBlock1` (include/global.h): pos at 0, then location {group, num, ...}. */
const SB1_POS_X = 0;
const SB1_POS_Y = 2;
const SB1_MAP_GROUP = 4;
const SB1_MAP_NUM = 5;
/** `struct PaletteFadeControl` (include/palette.h), packed by agbcc as read off
 *  tools/br/drivers/fade-trace.txt: the u16 at +4 is delayCounter:6, y:5, targetY:5;
 *  the u16 at +6 is blendColor:15, active:1. y runs 0..16, 16 = all blendColor. */
const FADE_Y_WORD = 4;
const FADE_COLOR_WORD = 6;

export interface Camera {
  group: number;
  num: number;
  x: number;
  y: number;
  subX: number;
  subY: number;
  /** 0..16 */
  fade: number;
  /** 15-bit GBA colour */
  fadeColor: number;
  fadeActive: boolean;
}

/** The sub-tile part of the picture's offset from gFieldCamera.x or .y. */
export function subTile(v: number): number {
  return v > 0 ? v - TILE : v < 0 ? v + TILE : 0;
}

/** The map pixel at the picture's top-left. */
export function lcdOrigin(c: { x: number; y: number; subX: number; subY: number }): { left: number; top: number } {
  return { left: c.x * TILE - LCD_LEFT + subTile(c.subX), top: c.y * TILE - LCD_TOP + subTile(c.subY) };
}

export function fadeOf(word4: number, word6: number): { y: number; color: number; active: boolean } {
  return { y: (word4 >> 6) & 31, color: word6 & 0x7fff, active: (word6 & 0x8000) !== 0 };
}

/** A warp fades to black, the new map loads with the struct reset to y = 0 while the
 *  screen is still black, and a dozen frames later the fade-in starts from 16. Read
 *  literally the field would flash the new map into that gap, so the fade is held at
 *  full until the next fade is under way. */
export function heldFade(prev: Camera | null, cur: Camera, held: boolean): boolean {
  if (cur.fadeActive) return false;
  if (held) return true;
  return prev !== null && prev.fade >= 16 && cur.fade === 0;
}

/** A 15-bit GBA colour the way mGBA shows it. */
export function gbaColor(c: number): string {
  const up = (v: number) => (v << 3) | (v >> 2);
  return `rgb(${up(c & 31)},${up((c >> 5) & 31)},${up((c >> 10) & 31)})`;
}

export interface FieldLayout {
  /** CSS pixels per GBA pixel. */
  scale: number;
  /** The border canvas, in GBA pixels. */
  cols: number;
  rows: number;
  /** Where the picture's top-left sits on it, in GBA pixels. */
  lcdCol: number;
  lcdRow: number;
}

/** Where the picture goes in a box, and how big the canvas around it is. One scale: the
 *  largest at which the picture fits the box, so a wide window has the map either side
 *  and a phone has it above and below. The picture centres in the box less a bottom
 *  inset -- the floating pad, on a phone -- and never leaves the box. */
export function layoutField(boxW: number, boxH: number, bottomInset = 0): FieldLayout {
  const scale = Math.min(boxW / GBA_W, boxH / GBA_H);
  if (!(scale > 0)) return { scale: 0, cols: 0, rows: 0, lcdCol: 0, lcdRow: 0 };
  const cols = Math.ceil(boxW / scale);
  const rows = Math.ceil(boxH / scale);
  const lcdCol = Math.max(0, Math.min(Math.round((boxW / scale - GBA_W) / 2), cols - GBA_W));
  const free = Math.max(GBA_H * scale, boxH - bottomInset);
  const lcdRow = Math.max(0, Math.min(Math.round((free / scale - GBA_H) / 2), rows - GBA_H));
  return { scale, cols, rows, lcdCol, lcdRow };
}

export interface Placed {
  map: WorldMap;
  /** This map's origin, in map pixels of the map it neighbours. */
  x: number;
  y: number;
}

/** The maps joined to this one along its edges, where each one's origin falls. */
export function neighbours(map: WorldMap, byId: Map<string, WorldMap>): Placed[] {
  const out: Placed[] = [];
  for (const seam of map.seams) {
    const other = byId.get(seam.to);
    if (!other) continue;
    const off = seam.offset * TILE;
    if (seam.dir === 'north') out.push({ map: other, x: off, y: -other.h * TILE });
    else if (seam.dir === 'south') out.push({ map: other, x: off, y: map.h * TILE });
    else if (seam.dir === 'west') out.push({ map: other, x: -other.w * TILE, y: off });
    else if (seam.dir === 'east') out.push({ map: other, x: map.w * TILE, y: off });
  }
  return out;
}

export interface FieldDeps {
  emu: Emulator;
  /** Null when the ROM is unpatched: the picture is still placed, the field stays dark. */
  symbols: Map<string, number> | null;
  /** The whole area the game may take. */
  box: HTMLElement;
  /** The emulator's own 240x160 canvas. */
  lcd: HTMLCanvasElement;
  /** The canvas the field is drawn on, under the picture. */
  field: HTMLCanvasElement;
  /** The pad, when it floats over the bottom of the box (position: absolute). */
  pad?: HTMLElement | null;
}

export class FieldView {
  private byRef = new Map<string, WorldMap>();
  private byId = new Map<string, WorldMap>();
  private images = new Map<string, HTMLImageElement>();
  private lay: FieldLayout = { scale: 0, cols: 0, rows: 0, lcdCol: 0, lcdRow: 0 };
  /** The state the picture on screen was drawn from: one frame behind the struct. */
  private prev: Camera | null = null;
  private drawn: string | null = null;
  private off: (() => void) | null = null;
  private observer: ResizeObserver | null = null;

  constructor(private readonly deps: FieldDeps) {
    for (const m of (worldData as { maps: WorldMap[] }).maps) {
      this.byRef.set(`${m.group}:${m.num}`, m);
      this.byId.set(m.id, m);
    }
  }

  attach(): void {
    this.layout();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.layout());
      this.observer.observe(this.deps.box);
      if (this.deps.pad) this.observer.observe(this.deps.pad);
    }
    window.addEventListener('resize', this.onResize);
    this.off = this.deps.emu.onFrame(() => this.frame());
  }

  detach(): void {
    this.off?.();
    this.off = null;
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener('resize', this.onResize);
  }

  private onResize = (): void => this.layout();

  /** The picture placed in the box, the field canvas sized to the box, both at one scale. */
  layout(): void {
    const { box, lcd, field, pad } = this.deps;
    const w = box.clientWidth;
    const h = box.clientHeight;
    let inset = 0;
    if (pad && getComputedStyle(pad).position === 'absolute') inset = pad.getBoundingClientRect().height;
    const lay = layoutField(w, h, inset);
    if (!lay.scale) return;
    const same = lay.scale === this.lay.scale && lay.cols === this.lay.cols && lay.rows === this.lay.rows
      && lay.lcdCol === this.lay.lcdCol && lay.lcdRow === this.lay.lcdRow;
    if (same) return;
    this.lay = lay;
    lcd.style.left = `${lay.lcdCol * lay.scale}px`;
    lcd.style.top = `${lay.lcdRow * lay.scale}px`;
    lcd.style.width = `${GBA_W * lay.scale}px`;
    lcd.style.height = `${GBA_H * lay.scale}px`;
    if (field.width !== lay.cols) field.width = lay.cols;
    if (field.height !== lay.rows) field.height = lay.rows;
    field.style.width = `${lay.cols * lay.scale}px`;
    field.style.height = `${lay.rows * lay.scale}px`;
    this.drawn = null;
    if (this.prev) this.draw(this.prev);
  }

  /** Where the picture is, for anyone turning a screen point into a GBA pixel. */
  get placement(): FieldLayout {
    return this.lay;
  }

  // ---- every frame ----------------------------------------------------------------------

  private held = false;

  private frame(): void {
    const cur = this.read();
    if (this.prev) this.draw(this.prev);
    if (cur) {
      this.held = heldFade(this.prev, cur, this.held);
      if (this.held) cur.fade = 16;
    }
    this.prev = cur;
  }

  private sym(name: string): number | undefined {
    return this.deps.symbols?.get(name);
  }

  private read(): Camera | null {
    const sb = this.sym('gSaveBlock1Ptr');
    const cam = this.sym('gFieldCamera');
    if (sb === undefined || cam === undefined) return null;
    const { emu } = this.deps;
    const p = emu.read(sb, 32);
    if (!p) return null;
    const s16 = (v: number) => (v << 16) >> 16;
    const s32 = (v: number) => v | 0;
    const fadeBase = this.sym('gPaletteFade');
    const fade = fadeBase === undefined
      ? { y: 0, color: 0, active: false }
      : fadeOf(emu.read(fadeBase + FADE_Y_WORD, 16), emu.read(fadeBase + FADE_COLOR_WORD, 16));
    return {
      group: emu.read(p + SB1_MAP_GROUP, 8),
      num: emu.read(p + SB1_MAP_NUM, 8),
      x: s16(emu.read(p + SB1_POS_X, 16)),
      y: s16(emu.read(p + SB1_POS_Y, 16)),
      subX: s32(emu.read(cam + CAMERA_X, 32)),
      subY: s32(emu.read(cam + CAMERA_Y, 32)),
      fade: fade.y,
      fadeColor: fade.color,
      fadeActive: fade.active,
    };
  }

  private image(id: string): HTMLImageElement | null {
    let img = this.images.get(id);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.addEventListener('load', () => { this.drawn = null; });
      img.src = `/field-maps/${id}.png`;
      this.images.set(id, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  private draw(c: Camera): void {
    const { field } = this.deps;
    const lay = this.lay;
    if (!lay.scale) return;
    const map = this.byRef.get(`${c.group}:${c.num}`);
    const key = `${c.group}:${c.num}:${c.x}:${c.y}:${c.subX}:${c.subY}:${c.fade}:${c.fadeColor}`;
    if (key === this.drawn) return;
    const ctx = field.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, lay.cols, lay.rows);

    let complete = true;
    if (map && map.outdoor) {
      // The map pixel at the field canvas's top-left.
      const { left, top } = lcdOrigin(c);
      const ox = left - lay.lcdCol;
      const oy = top - lay.lcdRow;

      const border = this.image(`${map.id}.border`);
      if (border) {
        const pattern = ctx.createPattern(border, 'repeat');
        if (pattern) {
          const mod = (v: number) => ((v % BORDER_SIZE) + BORDER_SIZE) % BORDER_SIZE;
          if (typeof DOMMatrix !== 'undefined' && typeof pattern.setTransform === 'function') {
            pattern.setTransform(new DOMMatrix([1, 0, 0, 1, mod(BORDER_ORIGIN - ox), mod(BORDER_ORIGIN - oy)]));
          }
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, lay.cols, lay.rows);
        }
      } else complete = false;

      const still = this.image(map.id);
      if (still) ctx.drawImage(still, -ox, -oy);
      else complete = false;
      for (const n of neighbours(map, this.byId)) {
        if (!n.map.outdoor) continue;
        const img = this.image(n.map.id);
        if (img) ctx.drawImage(img, n.x - ox, n.y - oy);
        else complete = false;
      }
    }

    if (c.fade > 0) {
      ctx.globalAlpha = Math.min(1, c.fade / 16);
      ctx.fillStyle = gbaColor(c.fadeColor);
      ctx.fillRect(0, 0, lay.cols, lay.rows);
      ctx.globalAlpha = 1;
    }
    // A picture missing its still is drawn again when the still arrives.
    this.drawn = complete ? key : null;
  }
}
