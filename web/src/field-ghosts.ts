// The people the ROM has let go of (POK-318, the ticket's second half). Emerald keeps an
// object only inside a box around the player -- 9 tiles left to 10 right, 7 up to 9 down
// (TrySpawnObjectEvents, RemoveObjectEventIfOutsideView, BrField_InObjectView) -- and
// the field on a phone runs a dozen rows past that, where nobody was drawn at all: Cam's
// trainer who "cuts in and out depending on where I'm located". Widening the box was
// ruled out (sixteen object slots; ghosts and loot would starve), so the page draws
// what the ROM still KNOWS of out there, from its own tables:
//
//   - Hoenn's people: the map's object templates in the save block, minus a set hide
//     flag, a trainer somebody beat (gBrDespawned) and the movement types that are never
//     a plain standing sprite. A wanderer stands at its home tile until the ROM has it.
//   - other players' ghosts: gBrSeats, the ROM's own copy of where every seat is.
//   - the loot on the ground: gBrLoot.
//
// Only outside the box, and only on the map we are on (Kanto's lib/ghosts.lua draws your
// map's ghosts and nobody else's; Emerald never shows a connected map's people either).
// Inside it the ROM is the authority: a person it holds no object for there -- hidden,
// despawned, or short of a slot -- is one it chose not to show. So nothing here is ever
// drawn twice, and nothing here disagrees with the ROM where the ROM draws.
//
// These are pure: field.ts reads the RAM and hands the bytes over. Every offset and
// number is held to the C by parity.test.ts.
import spritesData from './data/sprites.json';
import { SKIN_GFX } from './ui/emerald';
import type { FieldSprite } from './field';

const TILE = 16;
const ROM_BASE = 0x08000000;
/** MAP_OFFSET (include/fieldmap.h): a template's x/y are the map's own; an object's,
 *  a seat's and a ball's carry it. */
export const MAP_OFFSET = 7;
/** The box the ROM keeps objects in, in grid coords (MAP_OFFSET included) from
 *  gSaveBlock1Ptr->pos (the map's own): BrField_InObjectView, and Emerald's own
 *  TrySpawnObjectEvents / RemoveObjectEventIfOutsideView. */
export const VIEW = { left: -2, right: 17, top: 0, bottom: 16 };

/** `gSaveBlock1Ptr->objectEventTemplates`: the current map's, copied in on its load and
 *  moved by setobjectxyperm; a localId of 0 is an empty row. */
export const SB1_TEMPLATES = 0xc70;
export const TEMPLATE_COUNT = 64;
/** `struct ObjectEventTemplate` (include/global.fieldmap.h). */
export const TEMPLATE_SIZE = 0x18;
export const TPL_LOCAL_ID = 0x00;
export const TPL_GFX = 0x01;
export const TPL_X = 0x04;
export const TPL_Y = 0x06;
export const TPL_MOVEMENT_TYPE = 0x09;
export const TPL_FLAG_ID = 0x14;
/** `gSaveBlock1Ptr->flags`. Flag 0 is no flag (GetFlagPointer), and the special flags
 *  live in sSpecialFlags, which the page cannot see: one of those is taken as set. */
export const SB1_FLAGS = 0x1270;
export const SPECIAL_FLAGS_START = 0x4000;
/** `struct ObjectEvent`'s localId and map: which template or seat a live object is. */
export const OBJ_LOCAL_ID = 0x08;
export const OBJ_MAP_NUM = 0x09;
export const OBJ_MAP_GROUP = 0x0a;
/** Never a plain standing sprite: a berry tree is drawn by its growth stage, a disguised
 *  trainer as the tree or the rock, a buried one as nothing, and an invisible one (the
 *  Kecleon) as nothing. */
export const HIDDEN_MOVEMENT_TYPES = [0x0c, 0x39, 0x3a, 0x3f, 0x4c];
export const NUM_MOVEMENT_TYPES = 0x51;

/** `struct BrSeat` (include/br/br_ghosts.h). */
export const SEAT_COUNT = 32;
export const SEAT_SIZE = 16;
export const SEAT_PRESENT = 0;
export const SEAT_SKIN = 1;
export const SEAT_MAP_GROUP = 2;
export const SEAT_MAP_NUM = 3;
export const SEAT_X = 4;
export const SEAT_Y = 6;
export const SEAT_DIR = 8;
export const GHOST_LOCAL_ID_BASE = 0xc8;
/** `struct BrLootItem` (include/br/br_loot.h), gBrLoot.items at the struct's base. */
export const LOOT_COUNT = 8;
export const LOOT_SIZE = 20;
export const LOOT_X = 2;
export const LOOT_Y = 4;
export const LOOT_MAP_GROUP = 8;
export const LOOT_MAP_NUM = 9;
export const LOOT_KIND = 11;
export const LOOT_NONE = 0;
export const LOOT_BAG = 2;
export const LOOT_LOCAL_ID_BASE = 0xc0;
/** What br_loot.c's Spawn draws: Birch's bag for a bag, a ball for the rest. */
export const GFX_BIRCHS_BAG = 97;
export const GFX_ITEM_BALL = 59;
/** `struct BrDespawned`: the trainers somebody beat, a ring of sixteen. */
export const DESPAWN_COUNT = 16;
export const DESPAWN_SIZE = 4;
export const DESPAWN_MAP_GROUP = 0;
export const DESPAWN_MAP_NUM = 1;
export const DESPAWN_LOCAL_ID = 2;

/** DIR_* (include/constants/global.h). */
export const DIR_SOUTH = 1;
/** `sFaceDirectionAnimNums` (src/event_object_movement.c): DIR_NONE..DIR_NORTHEAST to
 *  the ANIM_STD_FACE_* a sprite starts on. */
export const FACE_ANIM = [0, 0, 1, 2, 3, 0, 0, 1, 1];
/** `struct ObjectEventGraphicsInfo`'s anims, and a frame command's hFlip bit
 *  (`struct AnimFrameCmd`: imageValue 16, duration 6, hFlip). */
export const GFX_INFO_ANIMS = 0x18;
export const ANIM_HFLIP_BIT = 22;

const SHEETS = spritesData as Record<string, { w: number; h: number; frames: number }>;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const s16 = (b: Uint8Array, o: number) => (u16(b, o) << 16) >> 16;

export interface Template {
  localId: number;
  gfx: number;
  x: number;
  y: number;
  movementType: number;
  flagId: number;
}

export interface Seat {
  seat: number;
  present: boolean;
  skin: number;
  group: number;
  num: number;
  x: number;
  y: number;
  dir: number;
}

export interface Loot {
  slot: number;
  kind: number;
  group: number;
  num: number;
  x: number;
  y: number;
}

export interface Despawned {
  group: number;
  num: number;
  localId: number;
}

// The decoders keep only the rows in use: they run every frame outdoors, and a map's 64
// template rows, 32 seats and 16 beaten trainers are mostly empty.

export function decodeTemplates(b: Uint8Array): Template[] {
  const out: Template[] = [];
  for (let o = 0; o + TEMPLATE_SIZE <= b.length; o += TEMPLATE_SIZE) {
    if (b[o + TPL_LOCAL_ID] === 0) continue;
    out.push({
      localId: b[o + TPL_LOCAL_ID],
      gfx: b[o + TPL_GFX],
      x: s16(b, o + TPL_X),
      y: s16(b, o + TPL_Y),
      movementType: b[o + TPL_MOVEMENT_TYPE],
      flagId: u16(b, o + TPL_FLAG_ID),
    });
  }
  return out;
}

export function decodeSeats(b: Uint8Array): Seat[] {
  const out: Seat[] = [];
  for (let o = 0, seat = 0; o + SEAT_SIZE <= b.length; o += SEAT_SIZE, seat++) {
    if (b[o + SEAT_PRESENT] === 0) continue;
    out.push({
      seat,
      present: b[o + SEAT_PRESENT] !== 0,
      skin: b[o + SEAT_SKIN],
      group: b[o + SEAT_MAP_GROUP],
      num: b[o + SEAT_MAP_NUM],
      x: s16(b, o + SEAT_X),
      y: s16(b, o + SEAT_Y),
      dir: b[o + SEAT_DIR],
    });
  }
  return out;
}

export function decodeLoot(b: Uint8Array): Loot[] {
  const out: Loot[] = [];
  for (let o = 0, slot = 0; o + LOOT_SIZE <= b.length && slot < LOOT_COUNT; o += LOOT_SIZE, slot++) {
    if (b[o + LOOT_KIND] === LOOT_NONE) continue;
    out.push({ slot, kind: b[o + LOOT_KIND], group: b[o + LOOT_MAP_GROUP], num: b[o + LOOT_MAP_NUM], x: s16(b, o + LOOT_X), y: s16(b, o + LOOT_Y) });
  }
  return out;
}

export function decodeDespawned(b: Uint8Array): Despawned[] {
  const out: Despawned[] = [];
  for (let o = 0; o + DESPAWN_SIZE <= b.length; o += DESPAWN_SIZE) {
    if (b[o + DESPAWN_LOCAL_ID] === 0) continue;
    out.push({ group: b[o + DESPAWN_MAP_GROUP], num: b[o + DESPAWN_MAP_NUM], localId: b[o + DESPAWN_LOCAL_ID] });
  }
  return out;
}

/** Which person a live object is: its local id AND its map, because the same local id
 *  on another map is somebody else (the last map's people stay live across a seam). */
export const objectKey = (localId: number, mapNum: number, mapGroup: number): string => `${localId}:${mapNum}:${mapGroup}`;

/** Everything the ROM knows about who is where, read the same frame. */
export interface Known {
  /** Where we are: the map, and gSaveBlock1Ptr->pos (the map's own coords). */
  map: { group: number; num: number };
  pos: { x: number; y: number };
  templates: Template[];
  /** FlagGet, for the flags the page can read. */
  flag: (id: number) => boolean;
  /** gInitialMovementTypeFacingDirections: the way a template's object starts out facing. */
  facing: (movementType: number) => number;
  despawned: Despawned[];
  seats: Seat[];
  mySeat: number;
  loot: Loot[];
  /** objectKey of every active object. */
  live: ReadonlySet<string>;
}

/** Somebody to draw: their graphics, the way they face, and their tile (the map's own). */
export interface Person {
  gfx: number;
  dir: number;
  x: number;
  y: number;
}

/** Is a grid cell (MAP_OFFSET included) inside the box the ROM keeps objects in? */
export function inObjectView(pos: { x: number; y: number }, gx: number, gy: number): boolean {
  return gx >= pos.x + VIEW.left && gx <= pos.x + VIEW.right && gy >= pos.y + VIEW.top && gy <= pos.y + VIEW.bottom;
}

/** The people past the ROM's box that it knows of and holds no object for. */
export function droppedPeople(k: Known): Person[] {
  const out: Person[] = [];
  const here = (group: number, num: number) => group === k.map.group && num === k.map.num;
  const live = (localId: number) => k.live.has(objectKey(localId, k.map.num, k.map.group));
  const beaten = new Set(k.despawned.filter((d) => d.localId !== 0 && here(d.group, d.num)).map((d) => d.localId));

  for (const t of k.templates) {
    if (t.localId === 0 || live(t.localId) || beaten.has(t.localId)) continue;
    if (inObjectView(k.pos, t.x + MAP_OFFSET, t.y + MAP_OFFSET)) continue;
    if (HIDDEN_MOVEMENT_TYPES.includes(t.movementType)) continue;
    if (t.flagId !== 0 && (t.flagId >= SPECIAL_FLAGS_START || k.flag(t.flagId))) continue;
    out.push({ gfx: t.gfx, dir: k.facing(t.movementType), x: t.x, y: t.y });
  }
  for (const s of k.seats) {
    if (!s.present || s.seat === k.mySeat || !here(s.group, s.num) || live(GHOST_LOCAL_ID_BASE + s.seat)) continue;
    if (inObjectView(k.pos, s.x, s.y)) continue;
    // br_ghosts.c's Spawn clamps a skin it does not know to the first.
    out.push({ gfx: SKIN_GFX[s.skin] ?? SKIN_GFX[0], dir: s.dir, x: s.x - MAP_OFFSET, y: s.y - MAP_OFFSET });
  }
  for (const l of k.loot) {
    if (l.kind === LOOT_NONE || !here(l.group, l.num) || live(LOOT_LOCAL_ID_BASE + l.slot)) continue;
    if (inObjectView(k.pos, l.x, l.y)) continue;
    out.push({ gfx: l.kind === LOOT_BAG ? GFX_BIRCHS_BAG : GFX_ITEM_BALL, dir: DIR_SOUTH, x: l.x - MAP_OFFSET, y: l.y - MAP_OFFSET });
  }
  return out;
}

function romU32(rom: Uint8Array, addr: number): number | null {
  const o = addr - ROM_BASE;
  if (o < 0 || o + 4 > rom.length) return null;
  return (rom[o] | (rom[o + 1] << 8) | (rom[o + 2] << 16) | (rom[o + 3] << 24)) >>> 0;
}

/** The frame a graphics id stands on facing `dir`, the way the ROM starts its sprite:
 *  the first command of anims[sFaceDirectionAnimNums[dir]], read off the ROM through
 *  gObjectEventGraphicsInfoPointers -- East is West's frame mirrored in that command,
 *  not a frame of its own. The sheet's first frame, facing south, without the table. */
export function standingFrame(rom: Uint8Array | null, infoPointers: number | undefined, gfx: number, dir: number): { frame: number; hFlip: boolean } {
  const still = { frame: 0, hFlip: false };
  if (!rom || infoPointers === undefined) return still;
  const info = romU32(rom, infoPointers + gfx * 4);
  const anims = info === null ? null : romU32(rom, info + GFX_INFO_ANIMS);
  const cmds = anims === null ? null : romU32(rom, anims + (FACE_ANIM[dir] ?? 0) * 4);
  const cmd = cmds === null ? null : romU32(rom, cmds);
  if (cmd === null || (cmd & 0xffff) >= 0xfffd) return still;
  return { frame: cmd & 0xffff, hFlip: ((cmd >>> ANIM_HFLIP_BIT) & 1) !== 0 };
}

/** gInitialMovementTypeFacingDirections[movementType], off the ROM; south without it. */
export function initialFacing(rom: Uint8Array | null, facings: number | undefined, movementType: number): number {
  if (!rom || facings === undefined || movementType >= NUM_MOVEMENT_TYPES) return DIR_SOUTH;
  const o = facings + movementType - ROM_BASE;
  return o >= 0 && o < rom.length ? rom[o] : DIR_SOUTH;
}

/** People at their tiles as sprites on the picture: centred on the tile, feet on its
 *  bottom row, the way the ROM places an object's sprite (TrySetupObjectEventSprite:
 *  x + 8, y + 16, less half the graphic each way). `origin` is the map pixel at the
 *  picture's top-left (field.ts's lcdOrigin), so they scroll with the ground. All of
 *  them past the ROM's box, so all of them on the overlay. */
export function placePeople(
  people: Person[],
  origin: { left: number; top: number },
  face: (gfx: number, dir: number) => { frame: number; hFlip: boolean },
): FieldSprite[] {
  const out: FieldSprite[] = [];
  for (const p of people) {
    const info = SHEETS[String(p.gfx)];
    if (!info) continue;
    const { frame, hFlip } = face(p.gfx, p.dir);
    out.push({
      gfx: p.gfx,
      frame,
      hFlip,
      x: p.x * TILE - origin.left + TILE / 2 - (info.w >> 1),
      y: p.y * TILE - origin.top + TILE - info.h,
      hidden: true,
    });
  }
  return out;
}
