// Tap the game, not the pad (Cam, 2026-09-18, from the phone): "use touch screen
// controls to move to a location or click on the moves to use them".
//
// Two things a tap on the picture can mean, and the page can tell which because it
// can read the ROM:
//
//  - **In the overworld, a tap is a place to go.** The tile is the one the picture
//    shows under the finger, found the way field.ts places the picture on the map:
//    measured, and up to a tile short of the pos mid-step. (A grid of this file's own,
//    the player always on screen tile (7, 5), was 8 px off.) The walk starts from
//    where `gBrOwnPos` says we stand. The route is the
//    bots' own A* over `world.json` (bots/path.ts), and it is walked by holding the
//    D-pad the way a thumb would, one step at a time, checking `gBrOwnPos` after each.
//    A tap next to us on something that cannot be stood on -- a sign, a nurse, a
//    trainer -- is "face it and press A". So is a tap on the tile we are already
//    facing after a walk stalled against it, which is how a loot ball on a walkable
//    cell gets picked up: walk up, tap again.
//  - **In a battle, a tap is a menu choice.** `gBrBattle.menu` says which 2x2 is up
//    (the action menu, the moves, the Safari's), the tap picks a quadrant, and the
//    cursor is walked there with D-pad taps and confirmed with A -- through the same
//    handlers a thumb drives, so a slot the game refuses (an empty move) is refused
//    here too, and nothing is chosen that was not under the cursor.
//
// Nothing here writes to the ROM. It presses keys, and it gives up the moment the
// player presses one themselves: `Emulator.keys()` shows bits this file did not set,
// and that is the thumb taking over. In a battle the walker stops; a menu open in the
// field (START, a dialog) shows up as a walk that goes nowhere, and a stall is a stop.
import { KEY_BIT, type Band, type Emulator, type GbaKey } from './emu';
import { GBA_H, GBA_W, lcdRect, readCameraPos, tileAt, type CameraPos } from './field';
import { findPath } from './bots/path';
import type { SeamDir, Spot } from './bots/world';
import { HOENN } from './bots/hoenn';
import { MAP_OFFSET } from './net/cells';

// Offsets into the ROM's structs. parity.test.ts reads the headers and holds these to them.
/** `struct BrOwnPos` (include/br/br_ghosts.h). Object-event coordinates, so they carry
 *  MAP_OFFSET; world.json's do not. */
export const OWN_GROUP = 0;
export const OWN_NUM = 1;
export const OWN_X = 2;
export const OWN_Y = 4;
export const OWN_DIR = 6;
/** `gMain.inBattle`, a bitfield at 0x439 (include/main.h). */
export const MAIN_IN_BATTLE_BYTE = 0x439;
export const MAIN_IN_BATTLE_BIT = 0x02;
/** `struct BrBattle.menu` (include/br/br_battle.h). */
export const BATTLE_MENU = 8;
export const MENU_ACTION = 1;
export const MENU_MOVE = 2;
export const MENU_SAFARI = 3;
/** `struct ChooseMoveStruct` sits at gBattleBufferA[battler][4]; its first field is the
 *  four move ids (include/battle.h). Battler 0 is always the local player on their own
 *  machine, link battles included. */
export const BUFFER_A_ROW = 0x200;
export const CHOOSE_MOVE_MOVES = 4;

/** Emerald's facing directions (include/constants/global.h). */
export const DIR_OF: Record<SeamDir, number> = { south: 1, north: 2, west: 3, east: 4 };
const KEY_OF: Record<SeamDir, GbaKey> = { south: 'down', north: 'up', west: 'left', east: 'right' };

/** A walk that shows no progress for this long is blocked: an NPC, a ledge, a dialog. */
const STALL_FRAMES = 60;
/** A menu tap that cannot land its cursor in this long is abandoned. */
const MENU_FRAMES = 40;
/** A press is held this long, and the next one waits as long: JOY_NEW wants an edge. */
const TAP_FRAMES = 3;
/** A turn in place is a short movement action; A during it is dropped. */
const TURN_FRAMES = 12;

export interface TouchDeps {
  emu: Emulator;
  /** The emulator's canvas: where a tap is measured from (the LCD inside it). */
  canvas: HTMLCanvasElement;
  /** Where taps are listened for. The whole box, when the field is drawn past the
   *  picture (field.ts): a tap on the map out there walks there too. */
  surface?: HTMLElement;
  symbols: Map<string, number>;
}

interface Own {
  map: string | undefined;
  x: number;
  y: number;
  dir: number;
}

/** One press in a short sequence: hold, then wait before the next. */
interface Press {
  key: GbaKey;
  hold: number;
  gapAfter: number;
}

/** A GBA pixel from a tap, measured from the LCD's box -- 240x160 at one scale, since
 *  field.ts places it. Past its edges the numbers run negative or over 240/160: that
 *  is the field drawn around it, and in the field a tap out there is as good as one on
 *  the picture. The core's canvas may be bigger than the LCD (POK-319: a band past it
 *  on each side); `band` says by how much. Null only when the box has no size. */
export function toGbaPixel(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  band: Band | null = null,
): { x: number; y: number } | null {
  if (!rect.width || !rect.height) return null;
  const lcd = lcdRect(rect, band);
  return { x: ((clientX - lcd.left) / lcd.width) * GBA_W, y: ((clientY - lcd.top) / lcd.height) * GBA_H };
}

export function onPicture(px: number, py: number): boolean {
  return px >= 0 && py >= 0 && px < GBA_W && py < GBA_H;
}

/** Which quadrant of which battle menu a GBA pixel is on, or -1 for none. */
export function menuSlot(which: number, px: number, py: number): number {
  // The bottom box: nothing above it is a choice.
  if (py < 120) return -1;
  let col: number;
  if (which === MENU_MOVE) {
    // The four moves fill the left two thirds; the right third is PP and type.
    if (px >= 160) return -1;
    col = px < 80 ? 0 : 1;
  } else if (which === MENU_ACTION || which === MENU_SAFARI) {
    // FIGHT / BAG over POKeMON / RUN (or the Safari's four) sit in the right half.
    if (px < 120) return -1;
    col = px < 180 ? 0 : 1;
  } else {
    return -1;
  }
  const row = py < 140 ? 0 : 1;
  return row * 2 + col;
}

export class TouchLayer {
  /** The key this file is holding right now, if any. */
  private held: GbaKey | null = null;
  private heldFrames = 0;
  private holdFor = 0;
  private gapFor = 0;
  private queue: Press[] = [];
  private walk: { steps: { dir: SeamDir; to: Spot }[]; at: number; stall: number; from: Spot } | null = null;
  private menu: { which: number; target: number; frames: number } | null = null;
  /** After a walk stalls, the tile it was pushing toward: a second tap there is "A". */
  private stalledToward: Spot | null = null;
  /** The camera the picture on screen was drawn from -- the ROM's one frame back
   *  (field.ts) -- and the latest read, which is next frame's picture. */
  private shownCamera: CameraPos | null = null;
  private lastCamera: CameraPos | null = null;
  private off: (() => void) | null = null;

  constructor(private readonly deps: TouchDeps) {}

  attach(): void {
    const { canvas, emu } = this.deps;
    const surface = this.deps.surface ?? canvas;
    let down: { x: number; y: number; at: number; id: number } | null = null;
    surface.addEventListener('pointerdown', (ev) => {
      down = { x: ev.clientX, y: ev.clientY, at: performance.now(), id: ev.pointerId };
    });
    surface.addEventListener('pointerup', (ev) => {
      if (!down || down.id !== ev.pointerId) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      const held = performance.now() - down.at;
      down = null;
      // A drag or a long press is not a tap.
      if (moved > 12 || held > 400) return;
      const px = toGbaPixel(canvas.getBoundingClientRect(), ev.clientX, ev.clientY, emu.viewport);
      if (px) this.tap(px.x, px.y);
    });
    surface.addEventListener('pointercancel', () => { down = null; });
    this.off = emu.onFrame(() => this.frame());
  }

  detach(): void {
    this.off?.();
    this.off = null;
    this.cancel();
  }

  // ---- reading the ROM ----------------------------------------------------------------

  private sym(name: string): number | undefined {
    return this.deps.symbols.get(name);
  }

  private inBattle(): boolean {
    const main = this.sym('gMain');
    if (main === undefined) return false;
    return (this.deps.emu.read(main + MAIN_IN_BATTLE_BYTE, 8) & MAIN_IN_BATTLE_BIT) !== 0;
  }

  private own(): Own | null {
    const base = this.sym('gBrOwnPos');
    if (base === undefined) return null;
    const { emu } = this.deps;
    const group = emu.read(base + OWN_GROUP, 8);
    const num = emu.read(base + OWN_NUM, 8);
    const sx = emu.read(base + OWN_X, 16);
    const sy = emu.read(base + OWN_Y, 16);
    return {
      map: HOENN.idOf({ group, num }),
      x: ((sx << 16) >> 16) - MAP_OFFSET,
      y: ((sy << 16) >> 16) - MAP_OFFSET,
      dir: emu.read(base + OWN_DIR, 8),
    };
  }

  private battleMenu(): number {
    const base = this.sym('gBrBattle');
    if (base === undefined) return 0;
    return this.deps.emu.read(base + BATTLE_MENU, 8);
  }

  private cursor(which: number): number {
    const name = which === MENU_MOVE ? 'gMoveSelectionCursor' : 'gActionSelectionCursor';
    const base = this.sym(name);
    return base === undefined ? 0 : this.deps.emu.read(base, 8) & 3;
  }

  /** The move in a slot of the move menu, 0 for none. */
  private moveInSlot(slot: number): number {
    const base = this.sym('gBattleBufferA');
    if (base === undefined) return 0;
    return this.deps.emu.read(base + 0 * BUFFER_A_ROW + CHOOSE_MOVE_MOVES + slot * 2, 16);
  }

  // ---- a tap ----------------------------------------------------------------------------

  private tap(px: number, py: number): void {
    if (this.inBattle()) {
      // The menus are on the picture; the field around it is scenery here.
      if (onPicture(px, py)) this.tapBattle(px, py);
      return;
    }
    const own = this.own();
    if (!own || !own.map) return;
    // What is on screen is last frame's camera. Across a seam that one counts from the
    // map we just left, and the latest is the one on ours.
    const ours = (c: CameraPos | null): c is CameraPos => c !== null && HOENN.idOf(c) === own.map;
    const cam = ours(this.shownCamera) ? this.shownCamera : readCameraPos(this.deps.emu, (name) => this.sym(name));
    if (!ours(cam)) return;
    this.tapField({ ...own, map: own.map }, tileAt(cam, px, py));
  }

  /** A tap on map tile `at` (world.json's coordinates), from where we stand. */
  private tapField(own: Own & { map: string }, at: { x: number; y: number }): void {
    const world = HOENN.world;
    const dx = at.x - own.x;
    const dy = at.y - own.y;
    if (dx === 0 && dy === 0) return;
    const goal: Spot = { map: own.map, x: own.x + dx, y: own.y + dy };
    const adjacent = Math.abs(dx) + Math.abs(dy) === 1;

    if (adjacent) {
      const toward: SeamDir = dx === 1 ? 'east' : dx === -1 ? 'west' : dy === 1 ? 'south' : 'north';
      const standable = world.standable(goal.map, goal.x, goal.y);
      const facingIt = own.dir === DIR_OF[toward];
      const triedIt = this.stalledToward !== null && this.stalledToward.x === goal.x && this.stalledToward.y === goal.y
        && this.stalledToward.map === goal.map;
      // Something to talk to, or something a walk already bounced off: face it, press A.
      if (!standable || (facingIt && triedIt)) {
        this.cancel();
        this.stalledToward = null;
        this.queue = facingIt
          ? [{ key: 'a', hold: TAP_FRAMES, gapAfter: TAP_FRAMES }]
          // A press shorter than a step's start-up only turns, which is the point.
          : [{ key: KEY_OF[toward], hold: 2, gapAfter: TURN_FRAMES }, { key: 'a', hold: TAP_FRAMES, gapAfter: TAP_FRAMES }];
        return;
      }
    }

    // A tile nothing can stand on is asked for as the nearest one that can, a step
    // closer to us -- a tap on the edge of a pond means the bank, not nothing.
    let target = goal;
    if (!world.standable(target.map, target.x, target.y)) {
      const nearer = [
        { map: goal.map, x: goal.x - Math.sign(dx), y: goal.y },
        { map: goal.map, x: goal.x, y: goal.y - Math.sign(dy) },
        { map: goal.map, x: goal.x - Math.sign(dx), y: goal.y - Math.sign(dy) },
      ].filter((s) => (s.x !== goal.x || s.y !== goal.y) && world.standable(s.map, s.x, s.y));
      if (!nearer.length) return;
      target = nearer[0];
    }
    const from: Spot = { map: own.map, x: own.x, y: own.y };
    const path = findPath(world, from, target);
    if (!path.found || !path.steps.length) return;
    this.cancel();
    this.stalledToward = null;
    this.walk = { steps: path.steps, at: 0, stall: 0, from };
  }

  private tapBattle(px: number, py: number): void {
    const which = this.battleMenu();
    const target = menuSlot(which, px, py);
    if (target < 0) return;
    if (which === MENU_MOVE && this.moveInSlot(target) === 0) return;
    this.cancel();
    this.menu = { which, target, frames: 0 };
  }

  // ---- every frame ----------------------------------------------------------------------

  private frame(): void {
    const { emu } = this.deps;
    this.shownCamera = this.lastCamera;
    this.lastCamera = readCameraPos(emu, (name) => this.sym(name));
    // Whatever is down that this file did not press is the player, and the player wins.
    const mine = this.held ? 1 << KEY_BIT[this.held] : 0;
    if (emu.keys() & ~mine) {
      this.cancel();
      return;
    }
    if (this.walk) {
      this.frameWalk();
      return;
    }
    if (this.held) {
      if (++this.heldFrames >= this.holdFor) this.release();
      return;
    }
    if (this.gapFor > 0) {
      this.gapFor--;
      return;
    }
    if (this.queue.length) {
      const next = this.queue.shift()!;
      this.press(next.key, next.hold, next.gapAfter);
      return;
    }
    if (this.menu) this.frameMenu();
  }

  private frameWalk(): void {
    const w = this.walk!;
    const own = this.inBattle() ? null : this.own();
    if (!own || !own.map) {
      this.cancel();
      return;
    }
    const step = w.steps[w.at];
    if (own.map === step.to.map && own.x === step.to.x && own.y === step.to.y) {
      w.stall = 0;
      if (++w.at >= w.steps.length) this.cancel(); // arrived
      return;
    }
    // A step lands on its own map or, across a seam, on the next one. Anywhere else
    // is a door or a warp the path did not list: the walk is over, not wrong.
    const before = w.at ? w.steps[w.at - 1].to.map : w.from.map;
    if (own.map !== before && own.map !== step.to.map) {
      this.cancel();
      return;
    }
    if (++w.stall > STALL_FRAMES) {
      this.stalledToward = { ...step.to };
      this.cancel();
      return;
    }
    // A continuous hold, re-asserted each frame: the ROM reads one long press.
    const key = KEY_OF[step.dir];
    if (this.held !== key) {
      this.release();
      this.deps.emu.press(key);
      this.held = key;
    }
  }

  private frameMenu(): void {
    const m = this.menu!;
    if (!this.inBattle() || this.battleMenu() !== m.which || ++m.frames > MENU_FRAMES) {
      this.menu = null;
      return;
    }
    const cur = this.cursor(m.which);
    if (cur === m.target) {
      this.menu = null;
      this.press('a', TAP_FRAMES, TAP_FRAMES);
      return;
    }
    // One axis at a time, the way the handlers move it.
    if ((cur ^ m.target) & 1) this.press(m.target & 1 ? 'right' : 'left', TAP_FRAMES, TAP_FRAMES);
    else this.press(m.target & 2 ? 'down' : 'up', TAP_FRAMES, TAP_FRAMES);
  }

  private press(key: GbaKey, hold: number, gapAfter: number): void {
    this.release();
    this.deps.emu.press(key);
    this.held = key;
    this.heldFrames = 0;
    this.holdFor = hold;
    this.gapFor = gapAfter;
  }

  private release(): void {
    if (!this.held) return;
    this.deps.emu.release(this.held);
    this.held = null;
  }

  /** Drop everything in flight and let go of any key. */
  cancel(): void {
    this.walk = null;
    this.menu = null;
    this.queue = [];
    this.release();
  }
}
