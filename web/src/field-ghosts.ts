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
//
// And the ghosts that walk on (POK-323, the end of this file): the other seats, walked by
// the page from its own roster, off the field and past the box.
import spritesData from './data/sprites.json';
import { SKIN_GFX } from './ui/emerald';
import { skinIndex } from './net/slots';
import { romCell, toPage } from './bots/space';
import type { FieldSprite } from './field';
import type { RosterEntry } from './match/roster';

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

/** Somebody to draw: their graphics, the way they face, and their tile (the map's own).
 *  A seat's ghost says whose it is. */
export interface Person {
  gfx: number;
  dir: number;
  x: number;
  y: number;
  seat?: number;
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
    out.push({ gfx: SKIN_GFX[s.skin] ?? SKIN_GFX[0], dir: s.dir, x: s.x - MAP_OFFSET, y: s.y - MAP_OFFSET, seat: s.seat });
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
    const sprite: FieldSprite = { gfx: p.gfx, frame, hFlip, ...onPicture(info, p.x * TILE, p.y * TILE, origin), hidden: true };
    if (p.seat !== undefined) sprite.seat = p.seat;
    out.push(sprite);
  }
  return out;
}

/** A sprite's top-left on the picture for a person whose tile's top-left is map pixel
 *  (px, py): centred on the tile, feet on its bottom row (TrySetupObjectEventSprite). */
function onPicture(info: { w: number; h: number }, px: number, py: number, origin: { left: number; top: number }): { x: number; y: number } {
  return { x: px - origin.left + TILE / 2 - (info.w >> 1), y: py - origin.top + TILE - info.h };
}

// ---- the ghosts that walk on (POK-323) -----------------------------------------------------
//
// Off the field -- a battle, the bag, the party -- the ROM walks no objects and draws none,
// and the field past the picture was the map with nobody on it. Cam's play-test: "if there
// was a bot at the bottom of the screen it should continue moving... the rest of the world
// should keep going." Where the other seats are does not come from the ROM, though: the
// page's roster has every one of them off the wire, and the host's bots are on it too. So
// the page walks them itself, a copy of br_ghosts.c's DriveGhost -- a step queued for each
// tile the roster moves, walked at walk-normal on the ROM's own walk frames, BR_STEP_QUEUE
// held behind the one in flight and a snap past that. Kanto does the same while its
// overworld is not on top (lib/ghosts.lua's advance: "a ghost is a live opponent, not
// scenery"), and leaves its own NPCs frozen, as field.ts leaves Hoenn's.
//
// On the field the ROM walks every ghost inside its box, so these are drawn only past it
// -- the rows past the box on a phone, where gBrSeats could only stand a ghost on a tile
// (POK-318) -- and never on a map but the one we are on.

/** Walk-normal: sStep1Funcs, sixteen frames of a pixel each (NpcTakeStep at
 *  MOVE_SPEED_NORMAL, which GetWalkNormalMovementAction's actions ask for). */
export const WALK_FRAMES = 16;
/** BR_STEP_QUEUE: the steps a ghost holds behind the one it is walking. One more and the
 *  ROM snaps it to the roster's cell. */
export const STEP_QUEUE = 5;
export const DIR_NORTH = 2;
export const DIR_WEST = 3;
export const DIR_EAST = 4;
/** sAnim_GoSouth/North/West/East, by DIR_*: a stride's four frames, GO_FRAME_TICKS each.
 *  East is West's frames mirrored, and so is its standing frame. */
export const GO_FRAMES: Readonly<Record<number, readonly number[]>> = { 1: [3, 0, 4, 0], 2: [5, 1, 6, 1], 3: [7, 2, 8, 2], 4: [7, 2, 8, 2] };
export const GO_FRAME_TICKS = 8;
/** sAnim_FaceSouth/North/West/East: the frame a person stands on. */
export const FACE_FRAMES: Readonly<Record<number, number>> = { 1: 0, 2: 1, 3: 2, 4: 2 };
/** sStepAnimTables' animPos for the people's anim tables (SetStepAnimHandleAlternation):
 *  a stride that rests on command [0] makes the next start at [3], one resting on [1]
 *  at [2] -- so back-to-back steps alternate feet, and a turn, which restarts the anim,
 *  starts them over. */
export const STEP_ANIM_POS = [1, 3, 0, 2];
const STEP: Readonly<Record<number, readonly [number, number]>> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };

interface Walker {
  seat: number;
  gfx: number;
  group: number;
  num: number;
  /** The tile it stands on, or is stepping onto: a live cell (MAP_OFFSET included). */
  x: number;
  y: number;
  facing: number;
  /** The roster's facing, turned to once nothing is left to walk. */
  dir: number;
  /** The step in flight (a DIR_*, 0 at rest) and its frames to go. */
  step: number;
  left: number;
  /** The walk anim's command: where the step in flight started, or where the last rested. */
  cmd: number;
  queue: number[];
  /** The roster's cell as last seen: what is queued walks from the tile to here. */
  seenX: number;
  seenY: number;
}

/** A place: the ROM's Spawn, or DriveGhost's snap -- on the tile, turned, the anim fresh. */
function stand(w: Walker, x: number, y: number): void {
  w.x = w.seenX = x;
  w.y = w.seenY = y;
  w.facing = w.dir;
  w.step = 0;
  w.left = 0;
  w.cmd = 0;
  w.queue = [];
}

/** One frame of DriveGhost and the object under it. */
function walk(w: Walker): void {
  if (w.step === 0) {
    const next = w.queue.shift();
    if (next !== undefined) {
      const [dx, dy] = STEP[next];
      // The object's tile moves as the step begins (ShiftObjectEventCoords); the sprite
      // walks the pixels behind it.
      w.x += dx;
      w.y += dy;
      w.step = w.facing = next;
      w.left = WALK_FRAMES;
      w.cmd = w.cmd === STEP_ANIM_POS[0] ? STEP_ANIM_POS[3] : w.cmd === STEP_ANIM_POS[1] ? STEP_ANIM_POS[2] : w.cmd;
    } else if (w.facing !== w.dir) {
      w.facing = w.dir;
      w.cmd = 0;
    }
  }
  // Step0 takes the first pixel in the frame it starts (MovementAction_WalkNormal*_Step0).
  if (w.step !== 0 && --w.left === 0) {
    w.step = 0;
    w.cmd += 1; // paused on the stride's second command: the standing frame
  }
}

/** The other seats, walked on the page. Fed the roster once an emulator frame. */
export class GhostWalkers {
  private walkers = new Map<number, Walker>();

  /** The roster as it is this frame: a tile moved is a step queued, a new facing a turn,
   *  a new map or more than the queue holds a snap. Our own seat, a seat that is out and
   *  one with nowhere to stand (the lobby) are nobody's to draw. */
  update(rows: readonly RosterEntry[]): void {
    const here = new Set<number>();
    for (const r of rows) {
      if (r.isMe || !r.alive || !r.map || r.x === undefined || r.y === undefined) continue;
      here.add(r.seat);
      // Spawn's clamp: a skin past the table is the first; BrGhosts_Place's, a facing
      // that is not one is south.
      const gfx = SKIN_GFX[skinIndex(r.skin)] ?? SKIN_GFX[0];
      const dir = r.dir >= DIR_SOUTH && r.dir <= DIR_EAST ? r.dir : DIR_SOUTH;
      let w = this.walkers.get(r.seat);
      if (!w || w.group !== r.map.group || w.num !== r.map.num) {
        w = { seat: r.seat, gfx, group: r.map.group, num: r.map.num, x: 0, y: 0, facing: dir, dir, step: 0, left: 0, cmd: 0, queue: [], seenX: 0, seenY: 0 };
        stand(w, r.x, r.y);
        this.walkers.set(r.seat, w);
        continue;
      }
      w.gfx = gfx;
      w.dir = dir;
      const dx = r.x - w.seenX;
      const dy = r.y - w.seenY;
      const n = Math.abs(dx) + Math.abs(dy);
      if (n === 0) continue;
      if (w.queue.length + n > STEP_QUEUE) {
        stand(w, r.x, r.y);
        continue;
      }
      // A run of steps seen at once (a ledge hop, a frame the page missed) is walked
      // across, then down: at sixteen frames a tile the corner it cut is not there to see.
      for (let i = 0; i < Math.abs(dx); i++) w.queue.push(dx > 0 ? DIR_EAST : DIR_WEST);
      for (let i = 0; i < Math.abs(dy); i++) w.queue.push(dy > 0 ? DIR_SOUTH : DIR_NORTH);
      w.seenX = r.x;
      w.seenY = r.y;
    }
    for (const seat of Array.from(this.walkers.keys())) if (!here.has(seat)) this.walkers.delete(seat);
    for (const w of this.walkers.values()) walk(w);
  }

  /** A seat the page is walking: gBrSeats' standing copy of it is not drawn as well. */
  has(seat: number): boolean {
    return this.walkers.has(seat);
  }

  /** The walkers on a map as sprites on the picture, `origin` the map pixel at its
   *  top-left (field.ts's lcdOrigin). `keep` is asked of each by its seat and its tile;
   *  `hidden` puts them on the overlay. */
  sprites(
    map: { group: number; num: number },
    origin: { left: number; top: number },
    keep: (seat: number, x: number, y: number) => boolean,
    hidden: boolean,
  ): FieldSprite[] {
    const out: FieldSprite[] = [];
    for (const w of this.walkers.values()) {
      if (w.group !== map.group || w.num !== map.num || !keep(w.seat, w.x, w.y)) continue;
      const info = SHEETS[String(w.gfx)];
      if (!info) continue;
      const tile = toPage(romCell(w.x, w.y));
      const [dx, dy] = STEP[w.step] ?? [0, 0];
      const at = onPicture(info, tile.x * TILE - dx * w.left, tile.y * TILE - dy * w.left, origin);
      const frame = w.step === 0 ? FACE_FRAMES[w.facing] : GO_FRAMES[w.step][w.cmd + (WALK_FRAMES - w.left > GO_FRAME_TICKS ? 1 : 0)];
      out.push({ gfx: w.gfx, frame, hFlip: w.facing === DIR_EAST, ...at, hidden, seat: w.seat });
    }
    return out;
  }
}
