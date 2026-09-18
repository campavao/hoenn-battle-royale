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
// Then POK-319: the emulator draws a picture bigger than the LCD -- the same BG and OBJ
// state, a band of pixels on each side (BAND below, matching include/br/br_field.h) --
// so the map, its animation, the people and the fog nearest the window are the ROM's
// own. The composite keeps filling everything past that band, and an overlay above the
// picture draws the one thing the band cannot: a person the ROM hid because their
// sprite's top is past the band (the OAM's 8-bit y would put them at the wrong end).
// Off the field -- a battle, a menu -- the band is clipped away and the composite shows
// through, so the fight sits in the middle of the field it was on.
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
import spritesData from './data/sprites.json';
import type { Band, Emulator } from './emu';

export const GBA_W = 240;
export const GBA_H = 160;
/** What the core draws past the LCD (POK-319): the ROM's ring is 256x256 and the LCD
 *  sits at its rows 40..199, so this is the ring, exactly once. The numbers are
 *  include/br/br_field.h's; field.test.ts pins them. */
export const BAND: Band = { left: 0, top: 40, right: 16, bottom: 56 };
/** `struct Main` (include/main.h): callback1 at 0, callback2 at 4. The picture past the
 *  LCD shows only while callback2 is CB2_Overworld; a function pointer carries the
 *  Thumb bit. */
const MAIN_CALLBACK2 = 4;
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

// The people (POK-318). The ROM draws an object only inside its window and marks its
// sprite invisible the moment it is off screen (UpdateObjectEventOffscreen), so the page
// reads the object's OWN invisible bit and the sprite's position, and draws it whole
// wherever it is. `struct ObjectEvent` (include/global.fieldmap.h) is 0x24 bytes:
const OBJ_COUNT = 16;
const OBJ_SIZE = 0x24;
const OBJ_ACTIVE_BYTE = 0; // bit 0
const OBJ_INVISIBLE_BYTE = 1; // bit 5
const OBJ_PLAYER_BYTE = 2; // bit 0
const OBJ_SPRITE_ID = 4;
const OBJ_GFX = 5;
/** Graphics ids from OBJ_EVENT_GFX_VARS up name a VAR_OBJ_GFX_ID_n (include/constants). */
const GFX_VARS = 240;
const VAR_OBJ_GFX_ID_0 = 0x4010;
const SB1_VARS = 0x139c;
/** `struct Sprite` (include/sprite.h), 0x44 bytes. x/y are the centre; centerToCorner
 *  takes them to the OAM's top-left; the coord offset is the camera's, when enabled. */
const SPR_SIZE = 0x44;
const SPR_ANIMS = 0x08;
const SPR_X = 0x20;
const SPR_Y = 0x22;
const SPR_X2 = 0x24;
const SPR_Y2 = 0x26;
const SPR_CTC_X = 0x28;
const SPR_CTC_Y = 0x29;
const SPR_ANIM_NUM = 0x2a;
const SPR_ANIM_CMD = 0x2b;
const SPR_FLAGS = 0x3e; // u16: inUse 1, coordOffsetEnabled 2, invisible 4, hFlip 0x100
const ROM_BASE = 0x08000000;

// The fog (WEATHER_FOG_HORIZONTAL, what the ring's outside looks like): twenty 64x64
// sprites tiling the screen, scrolled with the camera and drifting left a pixel every
// four frames (FogHorizontal_Main), alpha-blended fog*EVA/16 + ground*EVB/16 with the
// coefficients easing to 12/8. `struct Weather` (include/field_weather.h), offsets
// probed with the compiler:
const WEATHER_CURR = 0x6d0;
const WEATHER_FOG_X = 0x6ee;
const WEATHER_EVA = 0x730;
const WEATHER_EVB = 0x732;
const WEATHER_FOG_HORIZONTAL = 6;
const FOG_TILE = 64;
/** `struct BrRing` (include/br/br_ring.h): outside, and the frames to the next bleed. */
const RING_OUTSIDE = 5;
const RING_TIMER = 8;
/** The shake on a fog bleed (Cam: "like as if a Pokémon were poisoned"), in frames. */
export const SHAKE_FRAMES = 16;

export interface Fog {
  /** The fog tile's origin on the picture, in its pixels, modulo the tile. */
  x: number;
  y: number;
  eva: number;
  evb: number;
}

/** Where the fog tiles sit: the sprite columns start at the scroll position and the rows
 *  follow the camera's vertical offset, both modulo the 64-pixel tile. */
export function fogOrigin(scrollPosX: number, coordOffsetY: number): { x: number; y: number } {
  const mod = (v: number) => ((v % FOG_TILE) + FOG_TILE) % FOG_TILE;
  return { x: mod(scrollPosX), y: mod(coordOffsetY & 0xff) };
}

/** The box's offset on frame `n` of a shake, counting down from SHAKE_FRAMES: side to
 *  side every two frames, dying out. */
export function shakeOffset(n: number): { dx: number; dy: number } {
  if (n <= 0) return { dx: 0, dy: 0 };
  const amp = Math.ceil((3 * n) / SHAKE_FRAMES);
  const sign = (n >> 1) & 1 ? -1 : 1;
  return { dx: sign * amp, dy: (n & 1 ? 1 : 0) * Math.min(1, amp) };
}

export interface FieldSprite {
  gfx: number;
  frame: number;
  hFlip: boolean;
  /** The sprite's top-left, in the picture's pixels (may be outside it). */
  x: number;
  y: number;
  /** The ROM marked the sprite invisible: it is past the picture the core draws. */
  hidden: boolean;
}

/** The image index the sprite is showing: `anims[animNum][animCmdIndex].frame.imageValue`,
 *  read off the ROM through the sprite's own table pointer. Null off the end of the
 *  ROM or on a command that is not a frame (END -1, JUMP -2, LOOP -3). */
export function frameOf(rom: Uint8Array, animsPtr: number, animNum: number, cmdIndex: number): number | null {
  const u32 = (addr: number): number | null => {
    const o = addr - ROM_BASE;
    if (o < 0 || o + 4 > rom.length) return null;
    return (rom[o] | (rom[o + 1] << 8) | (rom[o + 2] << 16) | (rom[o + 3] << 24)) >>> 0;
  };
  const table = u32(animsPtr + animNum * 4);
  if (table === null) return null;
  const cmd = u32(table + cmdIndex * 4);
  if (cmd === null) return null;
  const image = cmd & 0xffff;
  return image >= 0xfffd ? null : image;
}

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
  sprites: FieldSprite[];
  fog: Fog | null;
  /** Outside the ring, and the ring's frames to the next bleed. */
  outside: boolean;
  ringTimer: number;
  /** The overworld is what the ROM is running (gMain.callback2 == CB2_Overworld). */
  onField: boolean;
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

/** Where the core's whole picture -- the LCD plus its band -- sits on the field canvas,
 *  in GBA pixels, given where the LCD was placed. */
export function pictureBox(lay: FieldLayout, band: Band | null): { left: number; top: number; width: number; height: number } {
  const b = band ?? { left: 0, top: 0, right: 0, bottom: 0 };
  return { left: lay.lcdCol - b.left, top: lay.lcdRow - b.top, width: GBA_W + b.left + b.right, height: GBA_H + b.top + b.bottom };
}

/** The LCD's own box inside the picture canvas's box on screen (CSS pixels). */
export function lcdRect(
  picture: { left: number; top: number; width: number; height: number },
  band: Band | null,
): { left: number; top: number; width: number; height: number } {
  if (!band) return picture;
  const scale = picture.width / (GBA_W + band.left + band.right);
  return { left: picture.left + band.left * scale, top: picture.top + band.top * scale, width: GBA_W * scale, height: GBA_H * scale };
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
  /** A canvas over the picture for the people the ROM hides past its band (POK-319).
   *  Without one, or without a band, the people are drawn under the picture instead. */
  overlay?: HTMLCanvasElement | null;
  /** The pad, when it floats over the bottom of the box (position: absolute). */
  pad?: HTMLElement | null;
  /** The ROM the emulator is running, for the sprites' animation tables. */
  rom?: Uint8Array | null;
}

interface SheetInfo {
  name: string;
  w: number;
  h: number;
  frames: number;
}

const SHEETS = spritesData as Record<string, SheetInfo>;

export class FieldView {
  private byRef = new Map<string, WorldMap>();
  private byId = new Map<string, WorldMap>();
  private images = new Map<string, HTMLImageElement>();
  private lay: FieldLayout = { scale: 0, cols: 0, rows: 0, lcdCol: 0, lcdRow: 0 };
  private band: Band | null = null;
  /** The band is clipped off the picture while the ROM is not on the field. */
  private clipped: boolean | null = null;
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
    const band = this.deps.emu.viewport;
    const sameBand = (band === null) === (this.band === null)
      && (!band || !this.band || (band.left === this.band.left && band.top === this.band.top && band.right === this.band.right && band.bottom === this.band.bottom));
    const same = sameBand && lay.scale === this.lay.scale && lay.cols === this.lay.cols && lay.rows === this.lay.rows
      && lay.lcdCol === this.lay.lcdCol && lay.lcdRow === this.lay.lcdRow;
    if (same) return;
    this.lay = lay;
    this.band = band ? { ...band } : null;
    // The core's canvas is the LCD plus its band; the LCD lands where the layout put it.
    const pic = pictureBox(lay, this.band);
    lcd.style.left = `${pic.left * lay.scale}px`;
    lcd.style.top = `${pic.top * lay.scale}px`;
    lcd.style.width = `${pic.width * lay.scale}px`;
    lcd.style.height = `${pic.height * lay.scale}px`;
    this.clipped = null;
    if (field.width !== lay.cols) field.width = lay.cols;
    if (field.height !== lay.rows) field.height = lay.rows;
    field.style.width = `${lay.cols * lay.scale}px`;
    field.style.height = `${lay.rows * lay.scale}px`;
    const overlay = this.deps.overlay;
    if (overlay) {
      if (overlay.width !== lay.cols) overlay.width = lay.cols;
      if (overlay.height !== lay.rows) overlay.height = lay.rows;
      overlay.style.width = field.style.width;
      overlay.style.height = field.style.height;
    }
    this.drawn = null;
    if (this.prev) this.draw(this.prev);
  }

  /** Show the band only on the field; anywhere else the picture is the LCD alone and the
   *  composite shows through around it. */
  private clip(onField: boolean): void {
    const b = this.band;
    const want = !!b && !onField;
    if (want === this.clipped) return;
    this.clipped = want;
    const { lcd } = this.deps;
    if (!want || !b) {
      lcd.style.clipPath = '';
      return;
    }
    const s = this.lay.scale;
    lcd.style.clipPath = `inset(${b.top * s}px ${b.right * s}px ${b.bottom * s}px ${b.left * s}px)`;
  }

  /** Where the picture is, for anyone turning a screen point into a GBA pixel. */
  get placement(): FieldLayout {
    return this.lay;
  }

  // ---- every frame ----------------------------------------------------------------------

  private held = false;
  private shake = 0;

  private frame(): void {
    const cur = this.read();
    if (this.prev) this.draw(this.prev);
    this.clip(cur?.onField ?? false);
    if (cur) {
      this.held = heldFade(this.prev, cur, this.held);
      if (this.held) cur.fade = 16;
      // The ring's bleed: the timer reloads the frame it bites. The whole box shakes,
      // picture and field together; the pad is not in the box and stays put.
      if (cur.outside && this.prev && cur.ringTimer > this.prev.ringTimer) this.shake = SHAKE_FRAMES;
    }
    this.prev = cur;
    if (this.shake > 0) {
      const { dx, dy } = shakeOffset(this.shake);
      this.deps.box.style.transform = `translate(${dx * this.lay.scale}px, ${dy * this.lay.scale}px)`;
      if (--this.shake === 0) this.deps.box.style.transform = '';
    }
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
    const ring = this.sym('gBrRing');
    const fadeBase = this.sym('gPaletteFade');
    const main = this.sym('gMain');
    const cb2 = this.sym('CB2_Overworld');
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
      sprites: this.readSprites(p),
      fog: this.readFog(),
      outside: ring !== undefined && emu.read(ring + RING_OUTSIDE, 8) !== 0,
      ringTimer: ring === undefined ? 0 : emu.read(ring + RING_TIMER, 16),
      onField: main !== undefined && cb2 !== undefined && (emu.read(main + MAIN_CALLBACK2, 32) & ~1) === cb2,
    };
  }

  private readFog(): Fog | null {
    const weather = this.sym('gWeather');
    const offY = this.sym('gSpriteCoordOffsetY');
    if (weather === undefined || offY === undefined) return null;
    const { emu } = this.deps;
    if (emu.read(weather + WEATHER_CURR, 8) !== WEATHER_FOG_HORIZONTAL) return null;
    const eva = emu.read(weather + WEATHER_EVA, 16);
    const evb = emu.read(weather + WEATHER_EVB, 16);
    if (!eva) return null;
    const { x, y } = fogOrigin(emu.read(weather + WEATHER_FOG_X, 16), ((emu.read(offY, 16) << 16) >> 16));
    return { x, y, eva, evb };
  }

  /** Every object the ROM has on the map except the player, where its sprite is. */
  private readSprites(sb1: number): FieldSprite[] {
    const objs = this.sym('gObjectEvents');
    const sprs = this.sym('gSprites');
    const offX = this.sym('gSpriteCoordOffsetX');
    const offY = this.sym('gSpriteCoordOffsetY');
    const { emu, rom } = this.deps;
    if (objs === undefined || sprs === undefined || offX === undefined || offY === undefined || !rom) return [];
    const s16 = (v: number) => (v << 16) >> 16;
    const s8 = (v: number) => (v << 24) >> 24;
    const coX = s16(emu.read(offX, 16));
    const coY = s16(emu.read(offY, 16));
    const out: FieldSprite[] = [];
    for (let i = 0; i < OBJ_COUNT; i++) {
      const o = objs + i * OBJ_SIZE;
      if (!(emu.read(o + OBJ_ACTIVE_BYTE, 8) & 1)) continue;
      if (emu.read(o + OBJ_INVISIBLE_BYTE, 8) & 0x20) continue;
      if (emu.read(o + OBJ_PLAYER_BYTE, 8) & 1) continue;
      let gfx = emu.read(o + OBJ_GFX, 8);
      if (gfx >= GFX_VARS) gfx = emu.read(sb1 + SB1_VARS + 2 * (VAR_OBJ_GFX_ID_0 + gfx - GFX_VARS - 0x4000), 16) & 0xff;
      if (!SHEETS[String(gfx)]) continue;
      const s = sprs + emu.read(o + OBJ_SPRITE_ID, 8) * SPR_SIZE;
      const flags = emu.read(s + SPR_FLAGS, 16);
      if (!(flags & 1)) continue;
      const onCamera = (flags & 2) !== 0;
      const x = s16(emu.read(s + SPR_X, 16)) + s16(emu.read(s + SPR_X2, 16)) + s8(emu.read(s + SPR_CTC_X, 8)) + (onCamera ? coX : 0);
      const y = s16(emu.read(s + SPR_Y, 16)) + s16(emu.read(s + SPR_Y2, 16)) + s8(emu.read(s + SPR_CTC_Y, 8)) + (onCamera ? coY : 0);
      const frame = frameOf(rom, emu.read(s + SPR_ANIMS, 32), emu.read(s + SPR_ANIM_NUM, 8), emu.read(s + SPR_ANIM_CMD, 8)) ?? 0;
      out.push({ gfx, frame, hFlip: (flags & 0x100) !== 0, x, y, hidden: (flags & 4) !== 0 });
    }
    return out;
  }

  private image(id: string, dir = 'field-maps'): HTMLImageElement | null {
    const key = `${dir}/${id}`;
    let img = this.images.get(key);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.addEventListener('load', () => { this.drawn = null; });
      img.src = `/${dir}/${id}.png`;
      this.images.set(key, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** The fog over the ground, under the people (its sprites are last in OAM, so every
   *  other sprite wins where they overlap). The GBA's blend is fog*EVA/16 + ground*EVB/16,
   *  clamped: the ground darkened to EVB/16, then the fog added at EVA/16. */
  private drawFog(ctx: CanvasRenderingContext2D, fog: Fog): boolean {
    const tile = this.image('fog', 'field-sprites');
    if (!tile) return false;
    const lay = this.lay;
    ctx.globalAlpha = Math.max(0, 1 - fog.evb / 16);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, lay.cols, lay.rows);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, fog.eva / 16);
    const mod = (v: number) => ((v % FOG_TILE) + FOG_TILE) % FOG_TILE;
    const x0 = mod(lay.lcdCol + fog.x) - FOG_TILE;
    const y0 = mod(lay.lcdRow + fog.y) - FOG_TILE;
    for (let y = y0; y < lay.rows; y += FOG_TILE) {
      for (let x = x0; x < lay.cols; x += FOG_TILE) ctx.drawImage(tile, x, y);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    return true;
  }

  /** The people, bottom-most last so a sprite further down the map is in front. */
  private drawSprites(ctx: CanvasRenderingContext2D, sprites: FieldSprite[]): boolean {
    let complete = true;
    const lay = this.lay;
    const order = sprites.slice().sort((a, b) => (a.y + (SHEETS[String(a.gfx)]?.h ?? 0)) - (b.y + (SHEETS[String(b.gfx)]?.h ?? 0)));
    for (const s of order) {
      const info = SHEETS[String(s.gfx)];
      const sheet = this.image(String(s.gfx), 'field-sprites');
      if (!sheet) { complete = false; continue; }
      const frame = Math.min(s.frame, info.frames - 1);
      const cx = lay.lcdCol + s.x;
      const cy = lay.lcdRow + s.y;
      if (s.hFlip) {
        ctx.save();
        ctx.translate(cx + info.w, cy);
        ctx.scale(-1, 1);
        ctx.drawImage(sheet, frame * info.w, 0, info.w, info.h, 0, 0, info.w, info.h);
        ctx.restore();
      } else {
        ctx.drawImage(sheet, frame * info.w, 0, info.w, info.h, cx, cy, info.w, info.h);
      }
    }
    return complete;
  }

  private draw(c: Camera): void {
    const { field } = this.deps;
    const lay = this.lay;
    if (!lay.scale) return;
    const map = this.byRef.get(`${c.group}:${c.num}`);
    const people = c.sprites.map((s) => `${s.gfx}/${s.frame}/${s.hFlip ? 1 : 0}/${s.x}/${s.y}/${s.hidden ? 1 : 0}`).join(',');
    const fog = c.fog ? `${c.fog.x}/${c.fog.y}/${c.fog.eva}/${c.fog.evb}` : '';
    const key = `${c.group}:${c.num}:${c.x}:${c.y}:${c.subX}:${c.subY}:${c.fade}:${c.fadeColor}:${people}:${fog}:${c.onField ? 1 : 0}`;
    if (key === this.drawn) return;
    const ctx = field.getContext('2d');
    if (!ctx) return;
    // With a band the ROM draws the people nearest the window itself, and the ones it
    // hid go on the overlay, above the picture; without one they all go under it.
    const overlay = this.band ? this.deps.overlay ?? null : null;
    const under = overlay ? [] : c.sprites;
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
      if (c.fog && !this.drawFog(ctx, c.fog)) complete = false;
      if (!this.drawSprites(ctx, under)) complete = false;
    }

    if (c.fade > 0) {
      ctx.globalAlpha = Math.min(1, c.fade / 16);
      ctx.fillStyle = gbaColor(c.fadeColor);
      ctx.fillRect(0, 0, lay.cols, lay.rows);
      ctx.globalAlpha = 1;
    }
    if (overlay && !this.drawOverlay(overlay, c, !!map && map.outdoor)) complete = false;
    // A picture missing its still is drawn again when the still arrives.
    this.drawn = complete ? key : null;
  }

  /** The people the ROM hid for being past its band, drawn over the picture -- only on
   *  the field, where the object table means what it says -- and faded the way the
   *  ROM's palette is, over their own pixels alone. */
  private drawOverlay(overlay: HTMLCanvasElement, c: Camera, outdoors: boolean): boolean {
    const ctx = overlay.getContext('2d');
    if (!ctx) return true;
    const lay = this.lay;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, lay.cols, lay.rows);
    if (!c.onField || !outdoors) return true;
    ctx.imageSmoothingEnabled = false;
    const complete = this.drawSprites(ctx, c.sprites.filter((s) => s.hidden));
    if (c.fade > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = Math.min(1, c.fade / 16);
      ctx.fillStyle = gbaColor(c.fadeColor);
      ctx.fillRect(0, 0, lay.cols, lay.rows);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    return complete;
  }
}
