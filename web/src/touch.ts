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
//  - **On the party screen, a tap is a POKeMON.** While the ROM asks which one (its
//    choose-a-POKeMON task runs: an item's "Use on which?", a switch, the PARTY
//    button), a tap on a POKeMON's box -- or on CANCEL -- walks the cursor there with
//    UP/DOWN and presses A, as a thumb would (Cam, 2026-10-18: "are you able to click
//    in the UI?").
//  - **In a battle, a tap is a menu choice.** `gBrBattle.menu` says which 2x2 is up
//    (the action menu, the moves, the Safari's), the tap picks a quadrant, and the
//    cursor is walked there with D-pad taps and confirmed with A -- through the same
//    handlers a thumb drives, so a slot the game refuses (an empty move) is refused
//    here too, and nothing is chosen that was not under the cursor.
//
// Nothing here writes to the ROM but the dock's SELECT: the item it uses is registered
// for the press and the player's own put back after (useOnField). The rest presses
// keys, and gives up the moment the
// player presses one themselves: `Emulator.keys()` shows bits this file did not set,
// and that is the thumb taking over. In a battle the walker stops; a menu open in the
// field (START, a dialog) shows up as a walk that goes nowhere, and a stall is a stop.
import { KEY_BIT, type Band, type Emulator, type GbaKey } from './emu';
import {
  GBA_H,
  GBA_W,
  OBJ_ACTIVE_BYTE,
  OBJ_COUNT,
  OBJ_PLAYER_BYTE,
  OBJ_SIZE,
  lcdRect,
  readCameraPos,
  tileAt,
  type CameraPos,
} from './field';
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
/** gMain.callback2: which screen the ROM is running. */
export const MAIN_CALLBACK2 = 4;
/** `struct BrBattle.menu` (include/br/br_battle.h). */
export const BATTLE_MENU = 8;
export const MENU_ACTION = 1;
export const MENU_MOVE = 2;
export const MENU_SAFARI = 3;
/** A double battle's target pick: the pad's, so the page's menu steps aside. */
export const MENU_TARGET = 4;
/** `struct ChooseMoveStruct` sits at gBattleBufferA[battler][4]; its first field is the
 *  four move ids (include/battle.h). The battler is the local player's: 0 on its own
 *  machine, but 1 on the challenged side of a link battle (battle_controllers.c), so it
 *  is read off gBattlerPositions (localBattler). */
export const BUFFER_A_ROW = 0x200;
export const CHOOSE_MOVE_MOVES = 4;
/** B_POSITION_PLAYER_LEFT (include/constants/battle.h): where the local player stands. */
export const POSITION_PLAYER_LEFT = 0;
const MAX_BATTLERS = 4;

/** The local player's battler: the one gBattlerPositions puts at PLAYER_LEFT. 0 without
 *  the symbol (a patch from before it was exported) or before the battle sets them. */
export function localBattler(emu: { read(addr: number, bits: 8 | 16 | 32): number }, at: number | undefined): number {
  if (at === undefined) return 0;
  for (let i = 0; i < MAX_BATTLERS; i++) if (emu.read(at + i, 8) === POSITION_PLAYER_LEFT) return i;
  return 0;
}
/** `struct ObjectEvent.currentElevation`, the low nibble of this byte (include/global.fieldmap.h). */
export const OBJ_ELEVATION_BYTE = 0x0b;

/** start_menu.c's MENU_ACTION_* rows the page's buttons ask for (parity.test.ts holds them). */
export const START_POKEMON = 1;
export const START_BR_MAP = 13;
/** `struct BrStartMenu` (include/br/br_menu.h): pointers at start_menu.c's statics. */
export const START_MENU_CURSOR = 0x0;
export const START_MENU_COUNT = 0x4;
export const START_MENU_ACTIONS = 0x8;
export const START_MENU_INPUT = 0xc;
/** `gSaveBlock1Ptr->registeredItem` (include/global.h): what SELECT uses on the field. */
export const SAVE1_REGISTERED_ITEM = 0x496;
/** `struct Task` (include/task.h): func, then isActive; NUM_TASKS of them. */
export const TASK_SIZE = 40;
export const TASK_ACTIVE = 4;
export const NUM_TASKS = 16;
/** `struct PartyMenu` (include/party_menu.h): the bitfield byte (menuType:4, layout:2),
 *  then slotId, slotId2 and action. */
export const PARTY_MENU_LAYOUT_BYTE = 8;
export const PARTY_MENU_SLOT = 9;
export const PARTY_MENU_SLOT2 = 10;
export const PARTY_MENU_ACTION = 11;
/** A SWITCH's or SOFTBOILED's second pick walks slotId2, not slotId (GetCurrentPartySlotPtr). */
const PARTY_ACTION_SWITCH = 8;
const PARTY_ACTION_SOFTBOILED = 10;
/** Picking half the party (multi battles, facilities) adds CONFIRM above CANCEL. */
const PARTY_MENU_TYPE_CHOOSE_HALF = 4;
/** PARTY_SIZE: the CONFIRM button's slotId; PARTY_SIZE + 1: CANCEL's. */
export const PARTY_CONFIRM = 6;
export const PARTY_CANCEL = 7;
/** `struct Task`'s data[0]: the party submenu keeps its cursor there. */
export const TASK_DATA0 = 8;
/** `struct Window` (include/window.h): its template (bg, left, top, width, height), 12
 *  bytes a window, WINDOWS_MAX of them; bg 0xFF is a free one. */
export const WINDOW_SIZE = 12;
export const WINDOWS_MAX = 32;
/** The party screen's submenu (SUMMARY / SWITCH / ITEM / CANCEL, or a battle's SHIFT /
 *  SUMMARY / CANCEL): DisplaySelectionWindow's SELECTWINDOW_ACTIONS, on BG2 at tiles
 *  19..28, its bottom at row 19, a row of 16 pixels an action. */
const SELECT_BG = 2;
const SELECT_LEFT = 19;
const SELECT_WIDTH = 10;
const SELECT_BOTTOM = 19;

/** Which row of the party submenu a GBA pixel is on, of `n` rows; -1 for none. */
export function selectRowAt(px: number, py: number, n: number): number {
  const top = (SELECT_BOTTOM - 2 * n) * 8;
  if (px < SELECT_LEFT * 8 || px >= (SELECT_LEFT + SELECT_WIDTH) * 8 || py < top || py >= SELECT_BOTTOM * 8) return -1;
  return Math.floor((py - top) / 16);
}
const ROM_BASE = 0x08000000;

/** Where start_menu.c keeps the rows, the cursor and its input handler, out of the ROM's
 *  `gBrStartMenu`. Null for a ROM without one (a patch from before br_menu.h). */
export function startMenuTable(rom: Uint8Array | null | undefined, at: number | undefined):
  { cursor: number; count: number; actions: number; input: number } | null {
  if (!rom || at === undefined) return null;
  const o = at - ROM_BASE;
  if (o < 0 || o + 16 > rom.length) return null;
  const view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  const u32 = (off: number) => view.getUint32(o + off, true);
  return { cursor: u32(START_MENU_CURSOR), count: u32(START_MENU_COUNT), actions: u32(START_MENU_ACTIONS), input: u32(START_MENU_INPUT) };
}

/** Emerald's facing directions (include/constants/global.h). */
export const DIR_OF: Record<SeamDir, number> = { south: 1, north: 2, west: 3, east: 4 };
const KEY_OF: Record<SeamDir, GbaKey> = { south: 'down', north: 'up', west: 'left', east: 'right' };

/** How far the core may run ahead of the page while a walk steers (HBR-59). A walk turns
 *  or stops as a step begins (currentCoords moves then), and the keys must land before the
 *  step ends: 4 frames on a Mach Bike at speed. Seeing the step up to 2 frames late, and
 *  the keys landing at the next frame boundary, leaves one to spare. */
const WALK_LEAD = 2;
/** A walk that shows no progress for this long is blocked: an NPC, a ledge, a dialog. */
const STALL_FRAMES = 60;
/** A menu tap that cannot land its cursor in this long is abandoned. */
const MENU_FRAMES = 40;
/** ...and the move menu, after FIGHT, this long to open. */
const OPEN_FRAMES = 90;
/** START with the menu's input handler already in gMenuCallback (it stays there after
 *  the menu shuts): StartMenuTask is still drawing for about this long, and drops keys. */
const START_SETTLE_FRAMES = 12;
/** How long a dock press waits for the D-pad to be let go before it is dropped. */
const DOCK_WAIT_FRAMES = 120;
/** SELECT's item goes back to the player's own this long after the press. */
const RESTORE_FRAMES = 20;
/** The start menu takes this long to open and take keys (its task, then its text). */
const START_FRAMES = 90;
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
  /** The ROM's bytes: `gBrStartMenu` is a const table in it, not in RAM. */
  rom?: Uint8Array | null;
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
  /** A dock press: it waits out the player's own keys (the field only reads START and
   *  SELECT between steps) instead of being dropped by them. */
  dock?: { waited: number; item?: number };
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

/** Which box of the single-layout party screen a GBA pixel is on: 0 the lead's big box,
 *  1..5 the rows down the right (sSinglePartyMenuWindowTemplate), PARTY_CANCEL the
 *  CANCEL button (sCancelButton_Tilemap, tiles 23..29 x 18..19) and, when `confirm`,
 *  PARTY_CONFIRM the one over it (tiles 23..29 x 16..17); -1 for none. Only boxes with a
 *  POKeMON in them, of `count`. */
export function partySlotAt(px: number, py: number, count: number, confirm = false): number {
  if (px >= 184 && px < 240 && py >= 144 && py < 160) return PARTY_CANCEL;
  if (confirm && px >= 184 && px < 240 && py >= 128 && py < 144) return PARTY_CONFIRM;
  let slot = -1;
  if (px >= 8 && px < 88 && py >= 24 && py < 80) slot = 0;
  else if (px >= 96 && px < 240 && py >= 8 && py < 128) slot = 1 + Math.floor((py - 8) / 24);
  return slot < count ? slot : -1;
}

export class TouchLayer {
  /** The key this file is holding right now, if any. */
  private held: GbaKey | null = null;
  private heldFrames = 0;
  private holdFor = 0;
  /** The game's frame count at the last frame this file saw: a busy page sees fewer frames
   *  than the game runs (HBR-59), and every hold, gap and wait here is in the game's frames. */
  private ranAt = 0;
  /** The game's frames since the frame before this one: what every count here adds. */
  private step = 1;
  /** The short lead held while a walk is on (HBR-59, WALK_LEAD), released after. */
  private unlock: (() => void) | null = null;
  private gapFor = 0;
  private queue: Press[] = [];
  private walk: { steps: { dir: SeamDir; to: Spot }[]; at: number; stall: number; from: Spot } | null = null;
  /** A battle menu choice being walked to. `then` is a second one to make once the menu
   *  it opens is up: FIGHT, then a move. `waiting` is the gap before that menu shows. */
  private menu: { which: number; target: number; frames: number; then?: number; waiting?: boolean; onPress?: () => void } | null = null;
  /** A POKeMON tapped on the party screen: its slot, walked to, and how long it has gone. */
  private party: { target: number; frames: number; moves: number } | null = null;
  /** A row of the party submenu tapped: walked to, then A. */
  private select: { row: number; frames: number; moves: number } | null = null;
  /** The task the party screen runs in: the submenu takes it over (its data[0] is the
   *  submenu's cursor). */
  private partyTask = -1;
  /** A start-menu row asked for by a button (PARTY, MAP): START is down, the cursor walks. */
  private startRow: { action: number; frames: number; other: boolean } | null = null;
  /** The player's own registered item, put back after a dock press used SELECT. */
  private restore: { addr: number; item: number; frames: number } | null = null;
  private startTable: ReturnType<typeof startMenuTable> | undefined;
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

  /** A button for a start-menu row: press START, walk the cursor to `action` (a
   *  MENU_ACTION_*) and press A, through HandleStartMenuInput as a thumb would. A row
   *  the menu does not have tonight (MAP before the fog) closes the menu again. */
  openStartRow(action: number): void {
    if (this.inBattle()) return;
    this.cancel();
    this.queue = [{ key: 'start', hold: TAP_FRAMES, gapAfter: TAP_FRAMES, dock: { waited: 0 } }];
    this.startRow = { action, frames: 0, other: false };
  }

  /** SELECT with `item` registered: the bike, a rod. The page registers it the way the
   *  bag's REGISTER would, then presses SELECT; the ROM decides whether it works here. */
  useOnField(item: number): void {
    if (this.sym('gSaveBlock1Ptr') === undefined || this.inBattle()) return;
    this.cancel();
    this.queue = [{ key: 'select', hold: TAP_FRAMES, gapAfter: TAP_FRAMES, dock: { waited: 0, item } }];
  }

  /** Register `item` for the SELECT about to go down. UseRegisteredKeyItemOnField reads
   *  it on the press; after that it is the player's again. A second dock press inside
   *  that window keeps the player's item, not the dock's. */
  private register(item: number): void {
    const { emu } = this.deps;
    const addr = emu.read(this.sym('gSaveBlock1Ptr')!, 32) + SAVE1_REGISTERED_ITEM;
    const own = this.restore?.addr === addr ? this.restore.item : emu.read(addr, 16);
    this.restore = { addr, item: own, frames: 0 };
    emu.write(addr, item, 16);
  }

  /** A choice off the page's own battle menu (ui/battlemenu.ts): `slot` of the menu
   *  `which` (FIGHT 0, BAG 1, POKeMON 2, RUN 3; a move 0..3), walked to and confirmed
   *  as a tap on the picture is. With `move`, `which` is the action menu and the slot is
   *  FIGHT: once the move menu is up, `move` is chosen there too. `onPress` runs as the A
   *  goes down on `slot`, and not at all if the menu never gets there. */
  chooseBattle(which: number, slot: number, move?: number, onPress?: () => void): void {
    if (which === 0 || !this.inBattle()) return;
    // A move asked for while FIGHT is still on its way in: it rides along, after it.
    const m = this.menu;
    if (which === MENU_MOVE && m && m.which === MENU_ACTION && m.target === 0 && m.then === undefined) {
      m.then = slot;
      return;
    }
    const now = this.battleMenu();
    // Another menu up, or none (FIGHT pressed, or BACK, and the next not up yet): it
    // waits for this one. A B still going down is kept: it is what brings it up.
    this.walk = null;
    this.startRow = null;
    this.menu = { which, target: slot, frames: 0, then: move, waiting: now !== which, onPress };
  }

  /** One press of a key, as a tap: B out of the move menu. */
  tapKey(key: GbaKey): void {
    this.cancel();
    this.queue = [{ key, hold: TAP_FRAMES, gapAfter: TAP_FRAMES }];
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

  /** The level we stand at on a bridge (world.levels): the player object's
   *  currentElevation, which ObjectEventUpdateElevation leaves alone on a height-15
   *  cell, so it is the level we walked on at. Undefined off a bridge, where the cell
   *  says, and when the ROM's answer is not one of the bridge's levels. */
  private level(map: string, x: number, y: number): number | undefined {
    const levels = HOENN.world.levels(map, x, y);
    const objs = this.sym('gObjectEvents');
    if (!levels.length || objs === undefined) return undefined;
    const { emu } = this.deps;
    for (let i = 0; i < OBJ_COUNT; i++) {
      const o = objs + i * OBJ_SIZE;
      if (!(emu.read(o + OBJ_ACTIVE_BYTE, 8) & 1) || !(emu.read(o + OBJ_PLAYER_BYTE, 8) & 1)) continue;
      const z = emu.read(o + OBJ_ELEVATION_BYTE, 8) & 0xf;
      return levels.includes(z) ? z : undefined;
    }
    return undefined;
  }

  /** The party screen asking which POKeMON, in its single layout: its choose-a-POKeMON
   *  task is running. (Not its submenus, messages and YES/NOs, which are tasks of their
   *  own, and not the double battle's two-column layout.) */
  private choosingMon(): boolean {
    const tasks = this.sym('gTasks');
    const fn = this.sym('Task_HandleChooseMonInput');
    const pm = this.sym('gPartyMenu');
    if (tasks === undefined || fn === undefined || pm === undefined || this.sym('gPlayerPartyCount') === undefined) return false;
    const { emu } = this.deps;
    if ((emu.read(pm + PARTY_MENU_LAYOUT_BYTE, 8) >> 4) & 3) return false;
    for (let i = 0; i < NUM_TASKS; i++) {
      const t = tasks + i * TASK_SIZE;
      if (emu.read(t + TASK_ACTIVE, 8) && (emu.read(t, 32) | 1) === (fn | 1)) {
        this.partyTask = i;
        return true;
      }
    }
    return false;
  }

  /** Whether the ROM runs neither the field nor a battle's own screen: the party screen,
   *  the bag, a summary. A tap there is not a step or a battle menu. (A ROM without the
   *  two callbacks in its table is let be, as before.) */
  private elsewhere(): boolean {
    const main = this.sym('gMain');
    const field = this.sym('CB2_Overworld');
    const battle = this.sym('BattleMainCB2');
    if (main === undefined || field === undefined || battle === undefined) return false;
    const cb2 = this.deps.emu.read(main + MAIN_CALLBACK2, 32) | 1;
    return cb2 !== (field | 1) && cb2 !== (battle | 1);
  }

  /** The party screen's submenu, if that is what is up: its rows and its cursor. */
  private selectMenu(): { n: number; cur: number } | null {
    const tasks = this.sym('gTasks');
    const windows = this.sym('gWindows');
    if (tasks === undefined || windows === undefined || this.partyTask < 0 || !this.elsewhere()) return null;
    const { emu } = this.deps;
    const t = tasks + this.partyTask * TASK_SIZE;
    if (!emu.read(t + TASK_ACTIVE, 8)) return null;
    for (let i = 0; i < WINDOWS_MAX; i++) {
      const w = windows + i * WINDOW_SIZE;
      const h = emu.read(w + 4, 8);
      if (emu.read(w, 8) !== SELECT_BG || emu.read(w + 1, 8) !== SELECT_LEFT || emu.read(w + 3, 8) !== SELECT_WIDTH) continue;
      if (!h || h & 1 || emu.read(w + 2, 8) + h !== SELECT_BOTTOM) continue;
      const n = h / 2;
      // 0xFF until the submenu's first frame: its cursor starts on the top row.
      const cur = (emu.read(t + TASK_DATA0, 16) << 16) >> 16;
      return { n, cur: cur >= 0 && cur < n ? cur : 0 };
    }
    return null;
  }

  /** Where the party screen's cursor is (a SWITCH's second pick moves slotId2), and
   *  whether it has a CONFIRM button. */
  private partyCursor(): { cur: number; confirm: boolean } {
    const { emu } = this.deps;
    const pm = this.sym('gPartyMenu')!;
    const action = emu.read(pm + PARTY_MENU_ACTION, 8);
    const second = action === PARTY_ACTION_SWITCH || action === PARTY_ACTION_SOFTBOILED;
    return {
      cur: (emu.read(pm + (second ? PARTY_MENU_SLOT2 : PARTY_MENU_SLOT), 8) << 24) >> 24,
      confirm: (emu.read(pm + PARTY_MENU_LAYOUT_BYTE, 8) & 0xf) === PARTY_MENU_TYPE_CHOOSE_HALF,
    };
  }

  private battleMenu(): number {
    const base = this.sym('gBrBattle');
    if (base === undefined) return 0;
    return this.deps.emu.read(base + BATTLE_MENU, 8);
  }

  private local(): number {
    return localBattler(this.deps.emu, this.sym('gBattlerPositions'));
  }

  private cursor(which: number): number {
    const name = which === MENU_MOVE ? 'gMoveSelectionCursor' : 'gActionSelectionCursor';
    const base = this.sym(name);
    return base === undefined ? 0 : this.deps.emu.read(base + this.local(), 8) & 3;
  }

  /** The move in a slot of the move menu, 0 for none. */
  private moveInSlot(slot: number): number {
    const base = this.sym('gBattleBufferA');
    if (base === undefined) return 0;
    return this.deps.emu.read(base + this.local() * BUFFER_A_ROW + CHOOSE_MOVE_MOVES + slot * 2, 16);
  }

  // ---- a tap ----------------------------------------------------------------------------

  private tap(px: number, py: number): void {
    if (this.choosingMon()) {
      const { confirm } = this.partyCursor();
      const target = partySlotAt(px, py, this.deps.emu.read(this.sym('gPlayerPartyCount')!, 8), confirm);
      if (target >= 0) {
        this.cancel();
        this.party = { target, frames: 0, moves: 0 };
      }
      return;
    }
    const sel = this.selectMenu();
    if (sel) {
      const row = selectRowAt(px, py, sel.n);
      if (row >= 0) {
        this.cancel();
        this.select = { row, frames: 0, moves: 0 };
      }
      return;
    }
    // Any other screen of its own (a message on the party screen, the bag, a summary):
    // the field is not under the tap, and neither is a battle menu.
    if (this.elsewhere()) return;
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
    // On a bridge, the level too: without it the search may step off at the other
    // height, and the ROM refuses the step (POK-331 #2 review).
    const from: Spot = { map: own.map, x: own.x, y: own.y };
    const z = this.level(own.map, own.x, own.y);
    if (z !== undefined) from.z = z;
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
    const ran = emu.ran ?? this.ranAt + 1;
    this.step = Math.max(1, ran - this.ranAt);
    this.ranAt = ran;
    this.shownCamera = this.lastCamera;
    this.lastCamera = readCameraPos(emu, (name) => this.sym(name));
    // Whatever is down that this file did not press is the player, and the player wins.
    if (this.restore && (this.restore.frames += this.step) >= RESTORE_FRAMES) {
      emu.write(this.restore.addr, this.restore.item, 16);
      this.restore = null;
    }
    const mine = this.held ? 1 << KEY_BIT[this.held] : 0;
    if (emu.keys() & ~mine) {
      // A dock press not yet down waits for the player's keys to come up, a while.
      const next = this.queue[0];
      if (!this.held && next?.dock && (next.dock.waited += this.step) <= DOCK_WAIT_FRAMES) {
        this.walk = null;
        this.menu = null;
        return;
      }
      this.cancel();
      return;
    }
    if (this.walk) {
      this.unlock ??= emu.holdLead?.(WALK_LEAD) ?? null;
      this.frameWalk();
      if (!this.walk) this.letGo();
      return;
    }
    this.letGo();
    if (this.held) {
      this.heldFrames += this.step;
      if (this.heldFrames >= this.holdFor) this.release();
      return;
    }
    if (this.gapFor > 0) {
      this.gapFor -= this.step;
      return;
    }
    if (this.queue.length) {
      const next = this.queue.shift()!;
      if (next.dock?.item !== undefined) this.register(next.dock.item);
      this.press(next.key, next.hold, next.gapAfter);
      return;
    }
    if (this.menu) this.frameMenu();
    else if (this.startRow) this.frameStartRow();
    else if (this.party) this.frameParty();
    else if (this.select) this.frameSelect();
  }

  private frameParty(): void {
    const p = this.party!;
    if (!this.choosingMon() || (p.frames += this.step) > MENU_FRAMES) {
      this.party = null;
      return;
    }
    const { cur, confirm } = this.partyCursor();
    if (cur === p.target) {
      this.party = null;
      this.press('a', TAP_FRAMES, TAP_FRAMES);
      return;
    }
    // UP and DOWN run round the POKeMON, CONFIRM if there is one, and CANCEL
    // (UpdatePartySelectionSingleLayout): the short way. A cursor that is nowhere on that
    // ring is not ours to walk.
    const count = this.deps.emu.read(this.sym('gPlayerPartyCount')!, 8);
    const ring = [...Array.from({ length: count }, (_, i) => i), ...(confirm ? [PARTY_CONFIRM] : []), PARTY_CANCEL];
    const from = ring.indexOf(cur);
    const to = ring.indexOf(p.target);
    if (from < 0 || to < 0 || ++p.moves > ring.length) {
      this.party = null;
      return;
    }
    const down = (to - from + ring.length) % ring.length;
    this.press(down <= ring.length - down ? 'down' : 'up', TAP_FRAMES, TAP_FRAMES);
  }

  private frameSelect(): void {
    const s = this.select!;
    const menu = this.selectMenu();
    if (!menu || (s.frames += this.step) > MENU_FRAMES || s.row >= menu.n) {
      this.select = null;
      return;
    }
    if (menu.cur === s.row) {
      this.select = null;
      this.press('a', TAP_FRAMES, TAP_FRAMES);
      return;
    }
    if (++s.moves > menu.n) {
      this.select = null;
      return;
    }
    // Three rows or fewer stop at the ends (Menu_ProcessInputNoWrapAround_other); more
    // wrap round (ProcessMenuInput_other): the short way.
    const down = menu.n <= 3 ? (s.row > menu.cur ? 1 : menu.n) : (s.row - menu.cur + menu.n) % menu.n;
    this.press(down <= menu.n - down ? 'down' : 'up', TAP_FRAMES, TAP_FRAMES);
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
    if ((w.stall += this.step) > STALL_FRAMES) {
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
    if (m.waiting) {
      // FIGHT was pressed: the move menu takes a few frames to come up.
      if (!this.inBattle() || (m.frames += this.step) > OPEN_FRAMES) {
        this.menu = null;
        return;
      }
      if (this.battleMenu() !== m.which) return;
      m.waiting = false;
      m.frames = 0;
    }
    if (!this.inBattle() || this.battleMenu() !== m.which || (m.frames += this.step) > MENU_FRAMES) {
      this.menu = null;
      return;
    }
    const cur = this.cursor(m.which);
    if (cur === m.target) {
      this.menu = m.then === undefined ? null : { which: MENU_MOVE, target: m.then, frames: 0, waiting: true };
      m.onPress?.();
      this.press('a', TAP_FRAMES, TAP_FRAMES);
      return;
    }
    // One axis at a time, the way the handlers move it -- and never through a slot the
    // move menu refuses (one past gNumberOfMovesToChoose): from 2 to 1 with three moves,
    // RIGHT would be 3, so it goes up first.
    const count = m.which === MENU_MOVE ? [0, 1, 2, 3].filter((i) => this.moveInSlot(i) !== 0).length : 4;
    const across = (cur ^ m.target) & 1;
    const down = (cur ^ m.target) & 2;
    if (across && ((cur ^ 1) < count || !down)) this.press(m.target & 1 ? 'right' : 'left', TAP_FRAMES, TAP_FRAMES);
    else this.press(m.target & 2 ? 'down' : 'up', TAP_FRAMES, TAP_FRAMES);
  }

  private frameStartRow(): void {
    const r = this.startRow!;
    this.startTable ??= startMenuTable(this.deps.rom, this.sym('gBrStartMenu'));
    const t = this.startTable;
    const callback = this.sym('gMenuCallback');
    if (!t || callback === undefined || this.inBattle() || (r.frames += this.step) > START_FRAMES) {
      this.startRow = null;
      return;
    }
    const { emu } = this.deps;
    // Not taking keys yet: its task is still drawing it. Its handler can be left over
    // from the last time the menu was up, so until something else is seen there it
    // gets the time the task takes too.
    if (emu.read(callback, 32) !== t.input) {
      r.other = true;
      return;
    }
    if (!r.other && r.frames < START_SETTLE_FRAMES) return;
    const count = emu.read(t.count, 8);
    const rows: number[] = [];
    for (let i = 0; i < count; i++) rows.push(emu.read(t.actions + i, 8));
    const target = rows.indexOf(r.action);
    const cur = emu.read(t.cursor, 8);
    if (target < 0) {
      this.startRow = null;
      this.press('b', TAP_FRAMES, TAP_FRAMES);
      return;
    }
    if (cur === target) {
      this.startRow = null;
      this.press('a', TAP_FRAMES, TAP_FRAMES);
      return;
    }
    // The menu wraps, so the short way round.
    const down = (target - cur + count) % count;
    this.press(down <= count - down ? 'down' : 'up', TAP_FRAMES, TAP_FRAMES);
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
    this.startRow = null;
    this.party = null;
    this.select = null;
    this.queue = [];
    this.release();
    this.letGo();
  }

  private letGo(): void {
    this.unlock?.();
    this.unlock = null;
  }
}
