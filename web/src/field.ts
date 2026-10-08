// The field past the picture (POK-317). The GBA draws 240x160 and nothing else, and on a
// phone that is a third of the glass. Cam's reference is a Game Boy Pokémon rendered past
// its LCD so the map fills the screen, the fight in the middle band with the field still
// around it. So this draws the rest: a still of the map (tools/br/render-maps.py, in
// web/public/field-maps/) scrolled in lockstep with the ROM's own camera, on a canvas
// under the picture, at the picture's own scale. Nothing is zoomed and nothing is
// stretched -- the picture is where the ROM's window is, and the map continues out of it.
//
// What the border is not: tile animation. The ROM never rendered it out there. The
// people are the ROM's where it has them and the page's own reading of its tables past
// that (POK-318, field-ghosts.ts); the fog is the ROM's weather, drawn to its numbers.
// The other seats past the box are walked by the page off its own roster (POK-323), and
// so are all of them off the field, where the ROM walks and draws nobody: a battle or
// the bag leaves the map's own people standing where they were, and everybody in the
// match walking on around it.
//
// Then POK-319: the emulator draws a picture bigger than the LCD -- the same BG and OBJ
// state, a band of pixels on each side (the one the ROM declares in gBrFieldView, romBand
// below) -- so the map, its animation, the people and the fog nearest the window are the
// ROM's own. The composite keeps filling everything past that band, and an overlay above
// the picture draws the one thing the band cannot: a person the ROM hid because their
// sprite's top is past the band (the OAM's 8-bit y would put them at the wrong end).
// Off the field -- a battle, a menu -- the band is clipped away and the composite shows
// through, so the fight sits in the middle of the field it was on; on it, the band is
// cut where the map ends and where the ROM's ring does not hold the map (yet) -- a
// step's 17th column, rows still to redraw (bandClip) -- and the composite shows there.
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
import type { SeamDir, WorldMap } from './bots/world';
import { HOENN } from './bots/hoenn';
import spritesData from './data/sprites.json';
import type { Band, Emulator, SpriteBand } from './emu';
import {
  DESPAWN_COUNT, DESPAWN_SIZE, GHOST_LOCAL_ID_BASE, GhostWalkers, LOOT_COUNT, LOOT_SIZE, OBJ_LOCAL_ID, OBJ_MAP_GROUP, OBJ_MAP_NUM, SB1_FLAGS, SB1_TEMPLATES, SEAT_COUNT, SEAT_SIZE,
  TEMPLATE_COUNT, TEMPLATE_SIZE, decodeDespawned, decodeLoot, decodeSeats, decodeTemplates, droppedPeople, inObjectView, initialFacing, objectKey, placePeople, standingFrame,
} from './field-ghosts';
import type { RosterEntry } from './match/roster';

export const GBA_W = 240;
export const GBA_H = 160;
/** What the core draws past the LCD for a ROM that does not say (POK-319): the ring is
 *  256x256 and the LCD sits at its rows 40..199, so this is the ring, exactly once --
 *  what every ROM before gBrFieldView was built for. A ROM that says draws what it says
 *  (romBand, POK-329). */
export const LEGACY_BAND: Band = { left: 0, top: 40, right: 16, bottom: 56 };
/** The sprite window (POK-329): the 256 rows around the LCD in which the ROM keeps every
 *  sprite's 8-bit OAM y to one reading -- BrField_OffScreen hides a sprite whose top is
 *  outside it. The core draws each sprite once, at its true rows, from it; the old one
 *  drew every sprite again 256 rows away, so a person whose top was in the band's last
 *  32 rows had their legs drawn at its top. For a ROM that does not say, the legacy
 *  band's own rows. */
export const LEGACY_SPRITE_BAND: SpriteBand = { top: LEGACY_BAND.top, bottom: LEGACY_BAND.bottom };

/** The picture a ROM declares, and the window its sprites are read against. */
export interface FieldPicture {
  band: Band;
  sprites: SpriteBand;
}

/** `struct BrFieldView` (include/br/br_field.h), in ROM: six u16s. */
export const FIELD_VIEW_SIZE = 12;

/** The picture the ROM declares in gBrFieldView (POK-329), read out of the image the core
 *  is about to boot -- so a core, a ROM and a page from different deploys (the service
 *  worker keeps each one, POK-246) always ask for the picture the ROM was built to feed.
 *  A ROM without the symbol, or one whose numbers the core could not take (a side past
 *  256, not a multiple of 8, a window that is not 96 rows), gets the legacy band. */
export function romBand(rom: Uint8Array | null | undefined, symbols: ReadonlyMap<string, number> | null | undefined): FieldPicture {
  const legacy: FieldPicture = { band: { ...LEGACY_BAND }, sprites: { ...LEGACY_SPRITE_BAND } };
  const at = symbols?.get('gBrFieldView');
  if (!rom || at === undefined) return legacy;
  const o = at - ROM_BASE;
  if (o < 0 || o + FIELD_VIEW_SIZE > rom.length) return legacy;
  const u16 = (i: number) => rom[o + 2 * i] | (rom[o + 2 * i + 1] << 8);
  const v = [0, 1, 2, 3, 4, 5].map(u16);
  if (v.some((n) => n % 8 !== 0 || n > 256) || v[4] + v[5] !== 256 - GBA_H) return legacy;
  return { band: { left: v[0], top: v[1], right: v[2], bottom: v[3] }, sprites: { top: v[4], bottom: v[5] } };
}
/** `struct Main` (include/main.h): callback1 at 0, callback2 at 4. The picture past the
 *  LCD shows only while callback2 is CB2_Overworld; a function pointer carries the
 *  Thumb bit. */
export const MAIN_CALLBACK2 = 4;
const TILE = 16;
/** The picture's top-left, relative to the pos tile's top-left, at rest. Measured. */
export const LCD_LEFT = 112;
export const LCD_TOP = 72;
/** The border block is 2x2 metatiles, indexed by the parity of grid coords, which carry
 *  MAP_OFFSET 7 -- so block (0,0) of the pattern sits on the map's ODD coordinates. */
const BORDER_ORIGIN = -TILE;
const BORDER_SIZE = 2 * TILE;

/** `struct CameraObject` (include/field_camera.h): callback, spriteId, speedX, speedY, x, y. */
export const CAMERA_X = 16;
export const CAMERA_Y = 20;
/** `struct SaveBlock1` (include/global.h): pos at 0, then location {group, num, ...}. */
export const SB1_POS_X = 0;
export const SB1_POS_Y = 2;
export const SB1_MAP_GROUP = 4;
export const SB1_MAP_NUM = 5;
/** `struct PaletteFadeControl` (include/palette.h), packed by agbcc as read off
 *  tools/br/drivers/fade-trace.txt: the u16 at +4 is delayCounter:6, y:5, targetY:5;
 *  the u16 at +6 is blendColor:15, active:1. y runs 0..16, 16 = all blendColor. */
export const FADE_Y_WORD = 4;
export const FADE_COLOR_WORD = 6;
/** `multipurpose1` at +0: during a fade, the bitmask of palettes it touches (bits 0..15
 *  the BG palettes, 16..31 the OBJ palettes). A catch's white flash fades only OBJ
 *  palettes, and the field's ground is BG: the composite follows a fade only when it
 *  reaches the BG palettes (Cam's 2026-09-18 play-test: the map going white around a
 *  battle picture that had not). */
export const FADE_SELECTED = 0;
export const FADE_BG_PALETTES = 0xffff;
/** The u16 at +8: a fast fade's submode in bits 0..5, `mode` in bits 8..9 (NORMAL_FADE
 *  0, FAST_FADE 1). A fast fade steps every palette, BG and OBJ, whatever the mask says,
 *  towards its submode's colour: IN_FROM_WHITE 0, OUT_TO_WHITE 1, IN_FROM_BLACK 2,
 *  OUT_TO_BLACK 3 -- white up to 1, and the odd ones fade out. Every battle ends on
 *  OUT_TO_BLACK (battle_main.c): 0x0143 in a trace of one. */
export const FADE_MODE_WORD = 8;
export const FAST_FADE = 1;
export const FAST_WHITE_MAX = 1;
/** A map load leaves y at 0 for ~13 frames before its fade-in; a hold that lasts longer
 *  than a second is not that, it is a fade the ROM never started (after a battle, say),
 *  and the field is visible under it. */
const HELD_FADE_MAX = 60;
/** `struct BrPick` (include/br/br_pick.h): active at 0 -- the drop map is up. It runs
 *  under the overworld's callback with the region map's BG state, so the band would be
 *  its tilemap's garbage rows. */
export const PICK_ACTIVE = 0;

// The people (POK-318). The ROM draws an object only inside its window and marks its
// sprite invisible the moment it is off screen (UpdateObjectEventOffscreen), so the page
// reads the object's OWN invisible bit and the sprite's position, and draws it whole
// wherever it is. `struct ObjectEvent` (include/global.fieldmap.h) is 0x24 bytes. These
// offsets, and the others here into the ROM's structs, are held to the headers by
// parity.test.ts:
export const OBJ_COUNT = 16;
export const OBJ_SIZE = 0x24;
export const OBJ_ACTIVE_BYTE = 0; // bit 0
export const OBJ_INVISIBLE_BYTE = 1;
export const OBJ_INVISIBLE_BIT = 0x20;
/** `offScreen`, byte 1 bit 6: UpdateObjectEventOffscreen's own verdict, which is the
 *  only reason the overlay draws a sprite. A sprite hidden any other way -- a beaten
 *  trainer blinking out, a script's `hide` -- stays hidden (Cam's 2026-09-18 play-test:
 *  "the trainer that I just beat is still on the map... flashing above"). */
export const OBJ_OFFSCREEN_BIT = 0x40;
export const OBJ_PLAYER_BYTE = 2; // bit 0
export const OBJ_SPRITE_ID = 4;
export const OBJ_GFX = 5;
/** Graphics ids from OBJ_EVENT_GFX_VARS up name a VAR_OBJ_GFX_ID_n (include/constants). */
export const GFX_VARS = 240;
export const VAR_OBJ_GFX_ID_0 = 0x4010;
/** VARS_START (include/constants/vars.h): where the var ids start, and gSaveBlock1Ptr->vars[0]. */
export const VARS_START = 0x4000;
export const SB1_VARS = 0x139c;
/** `struct Sprite` (include/sprite.h), 0x44 bytes. x/y are the centre; centerToCorner
 *  takes them to the OAM's top-left; the coord offset is the camera's, when enabled. */
export const SPR_SIZE = 0x44;
export const SPR_ANIMS = 0x08;
export const SPR_X = 0x20;
export const SPR_Y = 0x22;
export const SPR_X2 = 0x24;
export const SPR_Y2 = 0x26;
export const SPR_CTC_X = 0x28;
export const SPR_CTC_Y = 0x29;
export const SPR_ANIM_NUM = 0x2a;
export const SPR_ANIM_CMD = 0x2b;
/** The u16 of flag bits at 0x3e: inUse, coordOffsetEnabled, invisible, and hFlip in the
 *  next byte. */
export const SPR_FLAGS = 0x3e;
export const SPR_IN_USE = 0x1;
export const SPR_ON_CAMERA = 0x2;
export const SPR_INVISIBLE = 0x4;
/** The sprite's OAM, the first thing in `struct Sprite` (include/gba/types.h OamData):
 *  affineMode in the low bits of byte 1, and the u16 at 2 is x:9, matrixNum:5, size:2 --
 *  matrixNum's bit 3 (ST_OAM_HFLIP) at bit 12. */
export const SPR_OAM_MODE = 0x01;
export const SPR_OAM_ATTR1 = 0x02;
export const SPR_OAM_HFLIP = 0x08 << 9;
export const OAM_AFFINE_ON = 1;

/** Whether the hardware draws a sprite flipped: the OAM's own bit, which sprite.c's
 *  SetSpriteOamFlipBits sets to the animation frame's flip XOR Sprite.hFlip. An object
 *  facing east is its west frame flipped by the animation, with Sprite.hFlip clear, so the
 *  ROM's people past the picture, read by Sprite.hFlip, faced west whenever they faced
 *  east (world-moves.spec). An affine sprite's matrixNum names its matrix instead. */
export function oamFlipped(mode: number, attr1: number): boolean {
  return (mode & OAM_AFFINE_ON) === 0 && (attr1 & SPR_OAM_HFLIP) !== 0;
}
const ROM_BASE = 0x08000000;

// The fog (WEATHER_FOG_HORIZONTAL, what the ring's outside looks like): twenty 64x64
// sprites tiling the screen, scrolled with the camera and drifting left a pixel every
// four frames (FogHorizontal_Main), alpha-blended fog*EVA/16 + ground*EVB/16 with the
// coefficients easing to 12/8. `struct Weather` (include/field_weather.h) carries no
// offset comments: these were probed with the compiler, and parity.test.ts lays the
// struct out from the header to hold them.
export const WEATHER_CURR = 0x6d0;
export const WEATHER_FOG_X = 0x6ee;
export const WEATHER_EVA = 0x730;
export const WEATHER_EVB = 0x732;
export const WEATHER_FOG_HORIZONTAL = 6;
const FOG_TILE = 64;
/** `struct BrRing` (include/br/br_ring.h): outside, and the frames to the next bleed. */
export const RING_OUTSIDE = 5;
export const RING_TIMER = 8;
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
  /** The ROM hid the object for being past the picture the core draws (its offScreen
   *  bit), and for no other reason -- or holds no object for it at all, past the box it
   *  keeps them in (field-ghosts.ts): the overlay's cue. */
  hidden: boolean;
  /** Another seat's ghost, whoever draws it: not one the field freezes in a battle. */
  seat?: number;
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

/** Where the camera is: the pos tile and its map (`gSaveBlock1Ptr`, the map's own
 *  coordinates, no MAP_OFFSET) and `gFieldCamera`'s sub-tile offsets. */
export interface CameraPos {
  group: number;
  num: number;
  x: number;
  y: number;
  subX: number;
  subY: number;
}

/** The camera, read off the ROM. Null without the symbols or before a save block exists.
 *  The picture on screen was drawn from the read one frame before this one. */
export function readCameraPos(emu: Pick<Emulator, 'read'>, sym: (name: string) => number | undefined): CameraPos | null {
  const sb = sym('gSaveBlock1Ptr');
  const cam = sym('gFieldCamera');
  if (sb === undefined || cam === undefined) return null;
  const p = emu.read(sb, 32);
  if (!p) return null;
  const s16 = (v: number) => (v << 16) >> 16;
  return {
    group: emu.read(p + SB1_MAP_GROUP, 8),
    num: emu.read(p + SB1_MAP_NUM, 8),
    x: s16(emu.read(p + SB1_POS_X, 16)),
    y: s16(emu.read(p + SB1_POS_Y, 16)),
    subX: emu.read(cam + CAMERA_X, 32) | 0,
    subY: emu.read(cam + CAMERA_Y, 32) | 0,
  };
}

export interface Camera extends CameraPos {
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
  /** gBrRingStale: the ring's rows the ROM has still to (re)draw (bandClip). */
  stale: number;
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

/** The map tile under a pixel of the picture -- past the LCD too, where the field goes
 *  on -- for the camera the picture was drawn from. The pos tile's own coordinates. */
export function tileAt(c: { x: number; y: number; subX: number; subY: number }, px: number, py: number): { x: number; y: number } {
  const o = lcdOrigin(c);
  return { x: Math.floor((o.left + px) / TILE), y: Math.floor((o.top + py) / TILE) };
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

/** A frame of the hold (heldFade), for at most HELD_FADE_MAX frames: while it is on,
 *  `cur` is under the whole fade, in the colour the fade reached. Not the struct's: a
 *  fast fade's colour is its submode's, and the struct still names whatever the last
 *  normal fade blended towards (the white of a move's flash, at the end of a battle). */
export function holdFade(prev: Camera | null, cur: Camera, hold: { on: boolean; frames: number }): { on: boolean; frames: number } {
  let on = heldFade(prev, cur, hold.on);
  const frames = on ? hold.frames + 1 : 0;
  if (frames > HELD_FADE_MAX) on = false;
  if (on) {
    cur.fade = 16;
    if (prev) cur.fadeColor = prev.fadeColor;
  }
  return { on, frames };
}

/** The fade the map past the picture is under: the ROM's, when it reaches the BG
 *  palettes. A running fade says so by its mask. A finished one cannot -- the ROM clears
 *  the mask on a fade's last step and leaves y where it ended (palette.c) -- so `bg`,
 *  what the last fade reached while it ran, comes back for the next frame. A catch's
 *  ball fades to white on its own OBJ palette and stays there, and the map stayed white
 *  under it until the next fade (POK-327's play spec).
 *
 *  A fast fade (`mode`, the u16 at FADE_MODE_WORD) reaches every palette and has no
 *  blend: y runs from 31 down by 2 every other frame, each step moving every channel 2
 *  of 31 towards its colour, so the map is under it by a sixteenth a step. It ends with
 *  y at 0 and the mode back to normal, and after an OUT the picture stays that colour
 *  -- which is heldFade's to keep, from the 16 the last step reached. The battle's end
 *  was read as no fade at all, and the map stayed lit past a picture gone black.
 *
 *  So a fast fade stopped with the mode still fast never took a step. One begun inside
 *  the last fade's four finishing frames is ended by them first (UpdateFastPaletteFade
 *  asks IsSoftwarePaletteFadeFinishing before it moves a colour): the catch's ball fades
 *  its OBJ palette white, the battle's fast fade to black starts on the heels of it, and
 *  never runs. A fade out leaves the picture as it was; a fade in was filled with its
 *  colour as it began. Read as a normal fade at y 31 in the struct's colour, the map
 *  went white past a picture that had not changed, and was held white (POK-327, in
 *  Firefox's play spec). The mode stays fast until the next normal fade begins. */
export function mapFade(
  fade: { y: number; color: number; active: boolean },
  selected: number,
  bg: boolean,
  mode = 0,
): { fade: { y: number; color: number; active: boolean }; bg: boolean } {
  if (((mode >> 8) & 3) === FAST_FADE) {
    const sub = mode & 0x3f;
    const color = sub <= FAST_WHITE_MAX ? 0x7fff : 0;
    if (!fade.active) return { fade: { y: sub & 1 ? 0 : 16, color, active: false }, bg: true };
    const steps = 16 - (fade.y >> 1);
    return { fade: { y: sub & 1 ? steps : 16 - steps, color, active: true }, bg: true };
  }
  const reached = fade.active && selected !== 0 ? (selected & FADE_BG_PALETTES) !== 0 : bg;
  const onMap = fade.active ? (selected & FADE_BG_PALETTES) !== 0 : reached;
  return { fade: onMap ? fade : { ...fade, y: 0, active: false }, bg: reached };
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

/** The layout a box gives the picture: the box's size, less the pad when it floats over
 *  the box's bottom (a phone in a match), as FieldView lays out with. */
export function measureLayout(box: HTMLElement, pad: HTMLElement | null | undefined): FieldLayout {
  let inset = 0;
  if (pad && getComputedStyle(pad).position === 'absolute') inset = pad.getBoundingClientRect().height;
  return layoutField(box.clientWidth, box.clientHeight, inset);
}

/** The band to ask the core for (POK-329): the rows above and below the LCD this layout
 *  shows, and no more -- each row past the LCD is 256 more pixels the core draws every
 *  frame and the page uploads, and on a desktop, or a phone on its side, the picture
 *  fills the box's height and shows none of the ROM's 336. So: the layout's rows, in
 *  eights (what the core takes); never fewer than the sprite window, which is the ring
 *  every ROM before POK-329 fed and the rows the ROM keeps its people to one reading in;
 *  never more than the ROM declares. The sides are the ROM's: 16 columns at most, and a
 *  portrait phone's picture is the glass's width. A box with no size (a hidden screen)
 *  says nothing, and gets the ROM's whole band. */
export function askBand(lay: FieldLayout, rom: FieldPicture): Band {
  const { band, sprites } = rom;
  if (!(lay.scale > 0)) return { ...band };
  const eights = (n: number) => Math.ceil(Math.max(0, n) / 8) * 8;
  const rows = (need: number, window: number, most: number) => Math.min(most, Math.max(window, eights(need)));
  return {
    left: band.left,
    top: rows(lay.lcdRow, sprites.top, band.top),
    right: band.right,
    bottom: rows(lay.rows - lay.lcdRow - GBA_H, sprites.bottom, band.bottom),
  };
}

/** Where the core's whole picture -- the LCD plus its band -- sits on the field canvas,
 *  in GBA pixels, given where the LCD was placed. `canvas` is the core's own buffer
 *  size, which is the truth of what is being drawn: the element is always sized to it,
 *  so a band the page believes in and a buffer that lacks it (or the reverse) can never
 *  squash or stretch the picture (Cam's 2026-09-18 video, "everything got squished":
 *  a 256-row buffer in an element sized for 160). The band only says where the LCD
 *  sits inside the buffer. */
export function pictureBox(
  lay: FieldLayout,
  band: Band | null,
  canvas: { width: number; height: number } = { width: GBA_W + (band?.left ?? 0) + (band?.right ?? 0), height: GBA_H + (band?.top ?? 0) + (band?.bottom ?? 0) },
): { left: number; top: number; width: number; height: number } {
  const b = band ?? { left: 0, top: 0, right: 0, bottom: 0 };
  return { left: lay.lcdCol - b.left, top: lay.lcdRow - b.top, width: canvas.width, height: canvas.height };
}

/** The band to lay out with: what the core says it draws, or, when it has no answer but
 *  the buffer is plainly bigger than the LCD, the band the page asked it for. */
export function bandOf(drawn: Band | null, canvas: { width: number; height: number }, asked: Band | null = null): Band | null {
  if (drawn) return drawn;
  return canvas.width > GBA_W || canvas.height > GBA_H ? asked : null;
}

/** Rows of a map past its top edge the band still shows: the heads of the people on its
 *  first row, whose sprites stand a tile above their feet. */
export const HEAD_ROOM = TILE;

/** The map pixels the ROM's ring holds sideways, for the camera a picture was drawn from
 *  (POK-329): 16 metatile columns, 256 pixels -- 32 tiles, all a BG row has -- so a
 *  picture 256 wide that does not start on a metatile, which is every frame of a step
 *  left or right, straddles 17, and one of them is the wrong column's slot. A step left
 *  draws its new column at once, into the slot the picture's right edge still shows until
 *  the step lands; a step right's far column waits in the slot its left edge shows, so
 *  the columns are pos.x-1..pos.x+14 until the step lands (include/br/br_field.h, THE
 *  RING). Up and down the ring is 32 rows and the ROM's view 31, so it always holds the
 *  picture. */
export function ringColumns(cam: { x: number; subX: number }): { left: number; right: number } {
  const left = cam.x * TILE - LCD_LEFT - (cam.subX > 0 ? TILE : 0);
  return { left, right: left + 16 * TILE };
}

/** The ROM's ring up and down (include/br/br_field.h, THE RING): 32 metatile rows,
 *  RING_ABOVE of them above pos.y. Bit (dy + RING_ABOVE) of gBrRingStale is grid row
 *  pos.y + dy, which is map row pos.y + dy - MAP_OFFSET. */
export const RING_ABOVE = 4;
export const RING_ROWS = 32;
const MAP_OFFSET = 7;
/** pret's own rows, pos.y..pos.y+14: drawn as each comes in, never stale. */
const PRET_ROWS = 15;

/** The map rows the band may show, for the stale rows the ROM reported with the camera
 *  (POK-329): a whole-map draw leaves the ring's rows past pret's to be drawn over the
 *  next frames, and a map connection the rows the last map drew as its border -- two a
 *  frame, the nearest the LCD first -- so the band stops short of the nearest stale row
 *  above pos.y and the nearest below pret's. In map pixels, [top, bottom). */
export function ringRows(cam: { y: number }, stale: number): { top: number; bottom: number } {
  let top = -Infinity;
  let bottom = Infinity;
  for (let dy = -1; dy >= -RING_ABOVE; dy--) {
    if ((stale >>> (dy + RING_ABOVE)) & 1) {
      top = (cam.y + dy + 1 - MAP_OFFSET) * TILE;
      break;
    }
  }
  for (let dy = PRET_ROWS; dy < RING_ROWS - RING_ABOVE; dy++) {
    if ((stale >>> (dy + RING_ABOVE)) & 1) {
      bottom = (cam.y + dy - MAP_OFFSET) * TILE;
      break;
    }
  }
  return { top, bottom };
}

/** How far past a map's edge on side `dir` the ROM's own picture is the world, in map
 *  pixels (2026-10-07 play-test: "in certain areas the water animation isn't present").
 *  The ROM keeps MAP_OFFSET (7) cells of a neighbour, drawn with THIS map's tilesets, and
 *  border blocks past that. So: an edge with nothing joined to it is border all the way
 *  out, which is what the ROM draws -- animated -- and the still only copied; an edge
 *  whose every neighbour shares the tilesets is the ROM's for MAP_OFFSET cells; any other
 *  is the still's from the edge. A seam that covers part of a side counts for all of it:
 *  the rows past it with nothing joined show the ROM's border for MAP_OFFSET cells, then
 *  the still. A map without its seams (a test's bare size) cuts at the edge, as before;
 *  an interior has none listed and is uncut, the ROM's border (black, mostly) round it. */
export function edgeReach(map: { seams?: readonly { dir: SeamDir; same?: boolean }[] }, dir: SeamDir): number {
  if (!map.seams) return 0;
  const joined = map.seams.filter((s) => s.dir === dir);
  if (joined.length === 0) return Infinity;
  return joined.every((s) => s.same) ? MAP_OFFSET * TILE : 0;
}

/** How much of the band to cut away, side by side, in GBA pixels (POK-329): what lies past
 *  the current map's edge (edgeReach), and what the ring does not hold yet. The composite
 *  under the picture has a neighbour whole, from its own still. Mid-step sideways up to
 *  15 columns of the band's right are another column's slot (ringColumns), and for a
 *  few frames after a map is drawn or crossed into its outer rows are the last map's (ringRows, from `stale`, gBrRingStale): the
 *  composite has all of those too. `cam` is the state the picture on screen was drawn
 *  from -- the read one frame before (see the top of this file). HEAD_ROOM is kept past
 *  the top edge, and the LCD is never cut. A map the page does not know (null) has no
 *  edge to cut at; the ring is cut all the same. */
export function bandClip(
  cam: { x: number; y: number; subX: number; subY: number },
  map: { w: number; h: number; seams?: readonly { dir: SeamDir; same?: boolean }[] } | null,
  band: Band,
  stale = 0,
): Band {
  const o = lcdOrigin(cam);
  const ring = ringColumns(cam);
  const rows = ringRows(cam, stale);
  const cut = (past: number, side: number) => Math.max(0, Math.min(side, past));
  const reach = (dir: SeamDir) => (map ? edgeReach(map, dir) : Infinity);
  const w = map ? map.w * TILE : Infinity;
  const h = map ? map.h * TILE : Infinity;
  const top = o.top - band.top;
  const bottom = o.top + GBA_H + band.bottom;
  return {
    left: cut(Math.max(band.left - o.left - reach('west'), ring.left - (o.left - band.left)), band.left),
    top: cut(Math.max(map ? band.top - o.top - Math.max(HEAD_ROOM, reach('north')) : 0, rows.top - top), band.top),
    right: cut(Math.max(o.left + GBA_W + band.right - w - reach('east'), o.left + GBA_W + band.right - ring.right), band.right),
    bottom: cut(Math.max(bottom - h - reach('south'), bottom - rows.bottom), band.bottom),
  };
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
export function neighbours(map: WorldMap, byId: ReadonlyMap<string, WorldMap>): Placed[] {
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
  /** The band the page asked the core for (askBand), or where to read it -- PLAY AGAIN
   *  asks again: laid out with when the buffer is bigger than the LCD and the emulator
   *  has no band to say. */
  band?: Band | null | (() => Band | null);
  /** The canvas the field is drawn on, under the picture. */
  field: HTMLCanvasElement;
  /** A canvas over the picture for the people the ROM hides past its band (POK-319).
   *  Without one, or without a band, the people are drawn under the picture instead. */
  overlay?: HTMLCanvasElement | null;
  /** The pad, when it floats over the bottom of the box (position: absolute). */
  pad?: HTMLElement | null;
  /** The ROM the emulator is running, for the sprites' animation tables. */
  rom?: Uint8Array | null;
  /** Where every seat is, as the page knows it (the match's roster): the ghosts the page
   *  walks on off the field and past the box (POK-323). FieldView.setPeople sets it later. */
  people?: () => readonly RosterEntry[];
  /** The battle over the map, an experiment (2026-10-05 play-test): asked of the ROM
   *  every frame, and the picture keyed while a battle draws see-through. */
  seeThrough?: () => boolean;
  /** A 240x160 canvas over the LCD for the see-through battle's keyed copy of it, shown
   *  in the picture's place while one draws. Without one, or on a core that cannot hand
   *  the picture over, the picture itself takes the filter (not on Safari). */
  keyLayer?: HTMLCanvasElement | null;
}

/** The filter that makes a see-through battle's backdrop transparent: the ROM's
 *  BR_SEE_THROUGH_KEY, pure blue. Alpha is 128R + 128G - 10B + 9, so a pixel with any red
 *  or green in it, or less than about nine-tenths blue, is untouched; the key is gone. */
export const SEE_THROUGH_FILTER = 'hbr-see-through';
export const SEE_THROUGH_MATRIX = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  128 128 -10 0 9';

/** The alpha that matrix gives a pixel, channels 0..1: what the browser computes. */
export function seeThroughAlpha(r: number, g: number, b: number): number {
  return Math.max(0, Math.min(1, 128 * r + 128 * g - 10 * b + 9));
}

/** Key a copy of the picture in place, RGBA: each pixel's alpha is the filter's
 *  (seeThroughAlpha). Safari draws the url() filter on a WebGL canvas not at all -- the
 *  key itself, solid blue (Cam's 2026-10-08 phone shot) -- so where the core lets the
 *  page copy the picture, the page keys the copy instead. */
export function keyPicture(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i + 3] = Math.round(255 * seeThroughAlpha(rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255));
  }
}

function ensureSeeThroughFilter(doc: Document): void {
  if (doc.getElementById(SEE_THROUGH_FILTER)) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const filter = doc.createElementNS(ns, 'filter');
  filter.id = SEE_THROUGH_FILTER;
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const matrix = doc.createElementNS(ns, 'feColorMatrix');
  matrix.setAttribute('type', 'matrix');
  matrix.setAttribute('values', SEE_THROUGH_MATRIX);
  filter.appendChild(matrix);
  svg.appendChild(filter);
  doc.body.appendChild(svg);
}

/** What the field looked like at the last frame on it: the map's own people and the
 *  loot, left standing there while a battle or a menu has the screen. */
interface Still {
  group: number;
  num: number;
  origin: { left: number; top: number };
  sprites: FieldSprite[];
}

interface SheetInfo {
  name: string;
  w: number;
  h: number;
  frames: number;
}

const SHEETS = spritesData as Record<string, SheetInfo>;

/** What the loader needs of an image: an HTMLImageElement, or a test's stand-in. */
export interface FieldImage {
  src: string;
  complete: boolean;
  naturalWidth: number;
  addEventListener(type: 'load' | 'error', listener: () => void): void;
}

/** The PNGs drawn past the picture, each asked for once. A picture missing one is drawn
 *  again every frame until it arrives -- so one that FAILED (offline, a 404) used to be
 *  a full redraw every frame for the rest of the session (POK-330 #65). A failure now
 *  settles, and is asked for again the next time the map changes. */
export class FieldImages<T extends FieldImage> {
  private images = new Map<string, T>();
  private failed = new Set<string>();
  private pending = new Set<string>();

  constructor(private readonly make: () => T, private readonly onLoad: () => void) {}

  /** The image, or null while it loads or after it failed. */
  get(key: string, src: string): T | null {
    if (this.failed.has(key)) return null;
    let img = this.images.get(key);
    if (!img) {
      const made = this.make();
      made.addEventListener('load', () => {
        this.pending.delete(key);
        this.onLoad();
      });
      made.addEventListener('error', () => {
        this.pending.delete(key);
        this.images.delete(key);
        this.failed.add(key);
      });
      this.pending.add(key);
      this.images.set(key, made);
      made.src = src;
      img = made;
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** Nothing is on its way: a picture drawn without a missing image is as whole as it gets. */
  get settled(): boolean {
    return this.pending.size === 0;
  }

  /** Ask again for everything that failed. */
  retry(): void {
    this.failed.clear();
  }
}

export class FieldView {
  private images = new FieldImages<HTMLImageElement>(
    () => {
      const img = new Image();
      img.decoding = 'async';
      return img;
    },
    () => {
      this.drawn = null;
    },
  );
  /** The map the picture was last drawn on: a new one retries the images that failed. */
  private drawnMap: string | null = null;
  private lay: FieldLayout = { scale: 0, cols: 0, rows: 0, lcdCol: 0, lcdRow: 0 };
  private band: Band | null = null;
  /** The core's buffer size the layout was made for, and the boot; a change re-lays out. */
  private canvasW = 0;
  private canvasH = 0;
  private boots = 0;
  /** The clip-path on the picture, as last set: the whole band while the ROM is not on
   *  the field, and what lies past the map's edge while it is. Null: set it again. */
  private clipped: string | null = null;
  /** The state the picture on screen was drawn from: one frame behind the struct. */
  private prev: Camera | null = null;
  private drawn: string | null = null;
  private off: (() => void) | null = null;
  private observer: ResizeObserver | null = null;
  /** The other seats, walked by the page (POK-323), and where the roster comes from. */
  private readonly walkers = new GhostWalkers();
  private roster: (() => readonly RosterEntry[]) | null;
  private still: Still | null = null;
  /** The last read's ghosts, for peek(). */
  private ghosts: { rom: FieldSprite[]; drawn: FieldSprite[] } = { rom: [], drawn: [] };

  constructor(private readonly deps: FieldDeps) {
    this.roster = deps.people ?? null;
  }

  /** The match's roster, once there is one: solo's, or the room's Bridge's. */
  setPeople(people: (() => readonly RosterEntry[]) | null): void {
    this.roster = people;
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

  private askedBand(): Band | null {
    const b = this.deps.band;
    return (typeof b === 'function' ? b() : b) ?? null;
  }

  /** The picture placed in the box, the field canvas sized to the box, both at one scale. */
  layout(): void {
    const { box, lcd, field, pad } = this.deps;
    const lay = measureLayout(box, pad);
    if (!lay.scale) return;
    const band = bandOf(this.deps.emu.viewport, lcd, this.askedBand());
    const sameBand = (band === null) === (this.band === null)
      && (!band || !this.band || (band.left === this.band.left && band.top === this.band.top && band.right === this.band.right && band.bottom === this.band.bottom));
    const same = sameBand && lcd.width === this.canvasW && lcd.height === this.canvasH
      && lay.scale === this.lay.scale && lay.cols === this.lay.cols && lay.rows === this.lay.rows
      && lay.lcdCol === this.lay.lcdCol && lay.lcdRow === this.lay.lcdRow;
    if (same) return;
    this.lay = lay;
    this.band = band ? { ...band } : null;
    this.canvasW = lcd.width;
    this.canvasH = lcd.height;
    // The core's canvas is the LCD plus its band; the LCD lands where the layout put it,
    // and the element is the buffer's own size at the layout's scale, nothing else.
    const pic = pictureBox(lay, this.band, lcd);
    lcd.style.left = `${pic.left * lay.scale}px`;
    lcd.style.top = `${pic.top * lay.scale}px`;
    lcd.style.width = `${pic.width * lay.scale}px`;
    lcd.style.height = `${pic.height * lay.scale}px`;
    const keyLayer = this.deps.keyLayer;
    if (keyLayer) {
      const at = lcdRect({ left: pic.left * lay.scale, top: pic.top * lay.scale, width: pic.width * lay.scale, height: pic.height * lay.scale }, this.band);
      keyLayer.style.left = `${at.left}px`;
      keyLayer.style.top = `${at.top}px`;
      keyLayer.style.width = `${at.width}px`;
      keyLayer.style.height = `${at.height}px`;
    }
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

  /** Show the band only on the field, and there only as far as the map goes (bandClip,
   *  from `cam`, the state the picture was drawn from); anywhere else the picture is the
   *  LCD alone. The composite shows through wherever the band is cut. One clip-path,
   *  set only when it changes. */
  private clip(onField: boolean, cam: (CameraPos & { stale?: number }) | null): void {
    const b = this.band;
    let cut: Band | null = null;
    if (b && !onField) cut = b;
    else if (b && cam) cut = bandClip(cam, HOENN.byRef.get(`${cam.group}:${cam.num}`) ?? null, b, cam.stale ?? 0);
    const s = this.lay.scale;
    const want = cut && (cut.left || cut.top || cut.right || cut.bottom)
      ? `inset(${cut.top * s}px ${cut.right * s}px ${cut.bottom * s}px ${cut.left * s}px)`
      : '';
    if (want === this.clipped) return;
    this.clipped = want;
    this.deps.lcd.style.clipPath = want;
  }

  /** Where the picture is, for anyone turning a screen point into a GBA pixel. */
  get placement(): FieldLayout {
    return this.lay;
  }

  // ---- every frame ----------------------------------------------------------------------

  private hold = { on: false, frames: 0 };
  private shake = 0;

  private frame(): void {
    // The core sizes its buffer when it loads a game; a reboot can change it under us --
    // and the band, which PLAY AGAIN asks for again (askBand), even at the same size.
    const { lcd, emu } = this.deps;
    if (lcd.width !== this.canvasW || lcd.height !== this.canvasH || emu.boots !== this.boots) {
      this.boots = emu.boots;
      this.layout();
    }
    // Every frame, on the field too, so they are in step when a battle takes it.
    this.walkers.update(this.roster?.() ?? []);
    // A main loop still mid-iteration at this VBlank (a map loading as a seam is crossed)
    // has the struct half-written: the last whole frame stands (gBrMidFrame, br_main.h).
    const mid = this.sym('gBrMidFrame');
    const cur = mid !== undefined && this.deps.emu.read(mid, 8) !== 0 && this.prev ? this.prev : this.read();
    if (this.prev) this.draw(this.prev);
    this.clip(cur?.onField ?? false, this.prev);
    this.seeThrough();
    if (cur) {
      this.hold = holdFade(this.prev, cur, this.hold);
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

  /** Whether the picture is keyed, by the copy or the filter, as last set. */
  private keyed = false;

  /** Ask the ROM for a see-through battle, or not, and key the picture while one draws:
   *  gBrSeeThrough[0] is the page's, [1] the ROM's count of frames left (br_battle.h). */
  private seeThrough(): void {
    const base = this.sym('gBrSeeThrough');
    if (base === undefined) return;
    const want = this.deps.seeThrough?.() ?? false;
    const { emu, lcd } = this.deps;
    emu.write(base, want ? 1 : 0, 8);
    const keyed = want && emu.read(base + 1, 8) > 0;
    const layer = keyed ? this.keyCopy() : false;
    if (keyed === this.keyed && layer === this.layered) return;
    this.keyed = keyed;
    this.layered = layer;
    const keyLayer = this.deps.keyLayer;
    if (keyLayer) keyLayer.hidden = !layer;
    lcd.style.visibility = layer ? 'hidden' : '';
    if (keyed && !layer) ensureSeeThroughFilter(lcd.ownerDocument);
    lcd.style.filter = keyed && !layer ? `url(#${SEE_THROUGH_FILTER})` : '';
  }

  /** Whether the keyed copy is what shows, as last set. */
  private layered = false;
  private keyImage: ImageData | null = null;

  /** This frame's picture, keyed, onto the key layer: false when there is no layer or
   *  the core cannot hand the picture over. */
  private keyCopy(): boolean {
    const ctx = this.deps.keyLayer?.getContext('2d');
    if (!ctx) return false;
    const img = this.keyImage ?? (this.keyImage = new ImageData(GBA_W, GBA_H));
    if (!this.deps.emu.lcdPixels(img.data)) return false;
    keyPicture(img.data);
    ctx.putImageData(img, 0, 0);
    return true;
  }

  private sym(name: string): number | undefined {
    return this.deps.symbols?.get(name);
  }

  /** Whether the last fade the ROM ran reached the BG palettes (mapFade). */
  private fadeBg = true;

  private read(): Camera | null {
    const { emu } = this.deps;
    const sb = this.sym('gSaveBlock1Ptr');
    const pos = readCameraPos(emu, (name) => this.sym(name));
    if (sb === undefined || !pos) return null;
    const p = emu.read(sb, 32);
    const ring = this.sym('gBrRing');
    const fadeBase = this.sym('gPaletteFade');
    const main = this.sym('gMain');
    const cb2 = this.sym('CB2_Overworld');
    // A fade that leaves the BG palettes alone leaves the map alone, running or done.
    const seen = fadeBase === undefined
      ? { fade: { y: 0, color: 0, active: false }, bg: this.fadeBg }
      : mapFade(fadeOf(emu.read(fadeBase + FADE_Y_WORD, 16), emu.read(fadeBase + FADE_COLOR_WORD, 16)), emu.read(fadeBase + FADE_SELECTED, 32), this.fadeBg, emu.read(fadeBase + FADE_MODE_WORD, 16));
    const fade = seen.fade;
    this.fadeBg = seen.bg;
    const pick = this.sym('gBrPick');
    const cam: Camera = {
      ...pos,
      fade: fade.y,
      fadeColor: fade.color,
      fadeActive: fade.active,
      sprites: [],
      fog: this.readFog(),
      outside: ring !== undefined && emu.read(ring + RING_OUTSIDE, 8) !== 0,
      ringTimer: ring === undefined ? 0 : emu.read(ring + RING_TIMER, 16),
      stale: this.readStale(),
      onField: main !== undefined && cb2 !== undefined && (emu.read(main + MAIN_CALLBACK2, 32) & ~1) === cb2
        && !(pick !== undefined && emu.read(pick + PICK_ACTIVE, 8) !== 0),
    };
    cam.sprites = this.people(cam, p);
    return cam;
  }

  /** Everybody on the field this frame, on the picture. On it: the ROM's objects, what it
   *  knows of past its box (POK-318), and the page's walkers past that box. Off it the
   *  sprites are the battle's or the menu's -- read as people, every frame of a fight was
   *  somebody new -- so the map's people and the loot stand where the last frame on the
   *  field had them, and every ghost walks on (POK-323). */
  private people(c: Camera, sb1: number): FieldSprite[] {
    const origin = lcdOrigin(c);
    const outdoors = !!HOENN.byRef.get(`${c.group}:${c.num}`)?.outdoor;
    if (!c.onField) {
      const still = this.still !== null && this.still.group === c.group && this.still.num === c.num ? this.still : null;
      const stood = still === null ? [] : still.sprites.map((s) => ({
        ...s, x: s.x + still.origin.left - origin.left, y: s.y + still.origin.top - origin.top, hidden: false,
      }));
      const drawn = outdoors ? this.walkers.sprites(c, origin, () => true, false) : [];
      this.ghosts = { rom: [], drawn };
      return [...stood, ...drawn];
    }
    const live = this.liveObjects();
    const { people: objects, player } = this.readSprites(sb1);
    const dropped = this.readDropped(sb1, c, live);
    const rom = [...objects, ...dropped];
    // The player too: the picture draws them on the field, but a see-through battle shows
    // the field under it with them gone (2026-10-07 play-test: "my character sprite is gone").
    const stood = rom.filter((s) => s.seat === undefined);
    this.still = { group: c.group, num: c.num, origin, sprites: player ? [...stood, player] : stood };
    // Inside the box the ROM walks them; and one it still holds an object for is its,
    // wherever the roster has already put it.
    const pos = { x: c.x, y: c.y };
    const drawn = outdoors
      ? this.walkers.sprites(c, origin, (seat, x, y) => !inObjectView(pos, x, y) && !live.has(objectKey(GHOST_LOCAL_ID_BASE + seat, c.num, c.group)), true)
      : [];
    // gBrSeats' standing copy past the box is the page's drawing, not an object of the ROM's.
    this.ghosts = { rom: objects.filter((s) => s.seat !== undefined), drawn: [...dropped.filter((s) => s.seat !== undefined), ...drawn] };
    return [...rom, ...drawn];
  }

  /** objectKey of every active object. */
  private liveObjects(): Set<string> {
    const objs = this.sym('gObjectEvents');
    const live = new Set<string>();
    if (objs === undefined) return live;
    const { emu } = this.deps;
    for (let i = 0; i < OBJ_COUNT; i++) {
      const o = objs + i * OBJ_SIZE;
      if (emu.read(o + OBJ_ACTIVE_BYTE, 8) & 1) live.add(objectKey(emu.read(o + OBJ_LOCAL_ID, 8), emu.read(o + OBJ_MAP_NUM, 8), emu.read(o + OBJ_MAP_GROUP, 8)));
    }
    return live;
  }

  /** The ghosts of the last frame read (DEV, for the e2e): the ones the ROM has an object
   *  for, every walker on the camera's map wherever it is, the ones the page drew (its
   *  walkers, and gBrSeats' standing copy of a seat it does not walk), and every seat it
   *  walks on any map -- which is the match's roster reaching it. */
  peek(): { onField: boolean; rom: FieldSprite[]; walkers: FieldSprite[]; drawn: FieldSprite[]; seats: number[] } | null {
    const c = this.prev;
    if (!c) return null;
    return { onField: c.onField, rom: this.ghosts.rom, walkers: this.walkers.sprites(c, lcdOrigin(c), () => true, false), drawn: this.ghosts.drawn, seats: this.walkers.seats() };
  }

  /** gBrRingStale, read with the camera: its bits are relative to the pos read with it. */
  private readStale(): number {
    const at = this.sym('gBrRingStale');
    return at === undefined ? 0 : this.deps.emu.read(at, 32) >>> 0;
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

  /** Every object the ROM has on the map, where its sprite is: the people the page draws,
   *  and the player apart, whom the picture draws on the field and the still keeps for
   *  under a battle. */
  private readSprites(sb1: number): { people: FieldSprite[]; player: FieldSprite | null } {
    const objs = this.sym('gObjectEvents');
    const sprs = this.sym('gSprites');
    const offX = this.sym('gSpriteCoordOffsetX');
    const offY = this.sym('gSpriteCoordOffsetY');
    const { emu, rom } = this.deps;
    if (objs === undefined || sprs === undefined || offX === undefined || offY === undefined || !rom) return { people: [], player: null };
    const s16 = (v: number) => (v << 16) >> 16;
    const s8 = (v: number) => (v << 24) >> 24;
    const coX = s16(emu.read(offX, 16));
    const coY = s16(emu.read(offY, 16));
    const out: FieldSprite[] = [];
    let player: FieldSprite | null = null;
    for (let i = 0; i < OBJ_COUNT; i++) {
      const o = objs + i * OBJ_SIZE;
      if (!(emu.read(o + OBJ_ACTIVE_BYTE, 8) & 1)) continue;
      const bits = emu.read(o + OBJ_INVISIBLE_BYTE, 8);
      if (bits & OBJ_INVISIBLE_BIT) continue;
      const gfx = this.gfxOf(sb1, emu.read(o + OBJ_GFX, 8));
      if (!SHEETS[String(gfx)]) continue;
      const s = sprs + emu.read(o + OBJ_SPRITE_ID, 8) * SPR_SIZE;
      const flags = emu.read(s + SPR_FLAGS, 16);
      if (!(flags & SPR_IN_USE)) continue;
      // A sprite the ROM hid for a reason other than the picture's edge is nobody's to
      // draw: not under the picture (the band would show it anyway) and not over it.
      const offScreen = (bits & OBJ_OFFSCREEN_BIT) !== 0;
      if ((flags & SPR_INVISIBLE) && !offScreen) continue;
      const onCamera = (flags & SPR_ON_CAMERA) !== 0;
      const x = s16(emu.read(s + SPR_X, 16)) + s16(emu.read(s + SPR_X2, 16)) + s8(emu.read(s + SPR_CTC_X, 8)) + (onCamera ? coX : 0);
      const y = s16(emu.read(s + SPR_Y, 16)) + s16(emu.read(s + SPR_Y2, 16)) + s8(emu.read(s + SPR_CTC_Y, 8)) + (onCamera ? coY : 0);
      const frame = frameOf(rom, emu.read(s + SPR_ANIMS, 32), emu.read(s + SPR_ANIM_NUM, 8), emu.read(s + SPR_ANIM_CMD, 8)) ?? 0;
      const hFlip = oamFlipped(emu.read(s + SPR_OAM_MODE, 8), emu.read(s + SPR_OAM_ATTR1, 16));
      const sprite: FieldSprite = { gfx, frame, hFlip, x, y, hidden: offScreen };
      if (emu.read(o + OBJ_PLAYER_BYTE, 8) & 1) {
        player = sprite;
        continue;
      }
      const seat = emu.read(o + OBJ_LOCAL_ID, 8) - GHOST_LOCAL_ID_BASE;
      if (seat >= 0 && seat < SEAT_COUNT) sprite.seat = seat;
      out.push(sprite);
    }
    return { people: out, player };
  }

  /** A graphics id past the table names a var holding the real one. */
  private gfxOf(sb1: number, gfx: number): number {
    if (gfx < GFX_VARS) return gfx;
    return this.deps.emu.read(sb1 + SB1_VARS + 2 * (VAR_OBJ_GFX_ID_0 + gfx - GFX_VARS - VARS_START), 16) & 0xff;
  }

  /** The people the ROM knows of past the box it keeps objects in, and holds none for
   *  (POK-318): read here, in the same frame as the live objects, so a person the ROM
   *  spawns or lets go of this frame is in exactly one of the two lists. A seat the page
   *  walks (POK-323) is the walker's to draw, not gBrSeats' standing copy. */
  private readDropped(sb1: number, cam: CameraPos, live: ReadonlySet<string>): FieldSprite[] {
    // Indoors there is no field past the picture to stand on.
    if (this.sym('gObjectEvents') === undefined || !HOENN.byRef.get(`${cam.group}:${cam.num}`)?.outdoor) return [];
    const { emu } = this.deps;
    const rom = this.deps.rom ?? null;
    const table = (name: string, bytes: number): Uint8Array => {
      const at = this.sym(name);
      return at === undefined ? new Uint8Array(0) : emu.bytes(at, bytes);
    };
    const mySeat = this.sym('gBrMySeat');
    const facings = this.sym('gInitialMovementTypeFacingDirections');
    const infos = this.sym('gObjectEventGraphicsInfoPointers');
    const people = droppedPeople({
      map: { group: cam.group, num: cam.num },
      pos: { x: cam.x, y: cam.y },
      templates: decodeTemplates(emu.bytes(sb1 + SB1_TEMPLATES, TEMPLATE_COUNT * TEMPLATE_SIZE)).map((t) => ({ ...t, gfx: this.gfxOf(sb1, t.gfx) })),
      flag: (id) => ((emu.read(sb1 + SB1_FLAGS + (id >> 3), 8) >> (id & 7)) & 1) !== 0,
      facing: (movementType) => initialFacing(rom, facings, movementType),
      despawned: decodeDespawned(table('gBrDespawned', DESPAWN_COUNT * DESPAWN_SIZE)),
      seats: decodeSeats(table('gBrSeats', SEAT_COUNT * SEAT_SIZE)).filter((s) => !this.walkers.has(s.seat)),
      mySeat: mySeat === undefined ? -1 : emu.read(mySeat, 8),
      loot: decodeLoot(table('gBrLoot', LOOT_COUNT * LOOT_SIZE)),
      live,
    });
    return placePeople(people, lcdOrigin(cam), (gfx, dir) => standingFrame(rom, infos, gfx, dir));
  }

  private image(id: string, dir = 'field-maps'): HTMLImageElement | null {
    return this.images.get(`${dir}/${id}`, `/${dir}/${id}.png`);
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

  /** A canvas whose backing store went away -- Firefox, after the GPU process resets or
   *  a tab comes back from the background -- throws "Canvas is already in error state"
   *  from every call on its context, for good: in the 2026-10-05 play-test that was every
   *  frame and every resize, and the field around the picture stopped moving. Giving the
   *  canvas its size again allocates a new store; the next draw is a whole one. */
  private draw(c: Camera): void {
    try {
      this.paint(c);
    } catch (e) {
      // Only that: any other throw is a bug in paint, and reallocating on it every frame
      // would hide it behind a flickering field.
      const err = e as { name?: string; message?: string } | null;
      if (err?.name !== 'InvalidStateError' && !/error state/i.test(err?.message ?? '')) throw e;
      const { field, overlay } = this.deps;
      console.warn('[field] the field canvas failed; reallocating it', e);
      this.drawn = null;
      field.width = 0;
      field.width = this.lay.cols;
      if (overlay) {
        overlay.width = 0;
        overlay.width = this.lay.cols;
      }
    }
  }

  private paint(c: Camera): void {
    const { field } = this.deps;
    const lay = this.lay;
    if (!lay.scale) return;
    const at = `${c.group}:${c.num}`;
    if (at !== this.drawnMap) {
      this.drawnMap = at;
      this.images.retry();
    }
    const map = HOENN.byRef.get(at);
    const people = c.sprites.map((s) => `${s.gfx}/${s.frame}/${s.hFlip ? 1 : 0}/${s.x}/${s.y}/${s.hidden ? 1 : 0}`).join(',');
    const fog = c.fog ? `${c.fog.x}/${c.fog.y}/${c.fog.eva}/${c.fog.evb}` : '';
    const key = `${c.group}:${c.num}:${c.x}:${c.y}:${c.subX}:${c.subY}:${c.fade}:${c.fadeColor}:${people}:${fog}:${c.onField ? 1 : 0}`;
    if (key === this.drawn) return;
    const ctx = field.getContext('2d');
    if (!ctx) return;
    // With a band the ROM draws the people nearest the window itself, and the ones it
    // hid go on the overlay, above the picture; without one they all go under it. Off
    // the field the band is clipped away and everybody is under it, the fight on top.
    const overlay = this.band ? this.deps.overlay ?? null : null;
    const under = overlay && c.onField ? [] : c.sprites;
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
      for (const n of neighbours(map, HOENN.byId)) {
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
    // A picture missing its still is drawn again when the still arrives -- and not while
    // nothing is on its way, which is what a failed one is.
    this.drawn = complete || this.images.settled ? key : null;
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
