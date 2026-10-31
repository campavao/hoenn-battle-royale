// Spike B (engine-path thread, 2026-10-27): the overworld as one world the page owns.
//
// Throwaway. It answers one question: if every trainer -- you, the bots, the people you
// watch -- stands in ONE world model the page simulates, and the ROM is only asked to
// fight, do the sync bugs go away, does it hold 60 fps on a phone, and does walking still
// feel like Emerald?
//
// One source of position: the shared Room (shared/room.ts), run by the relay for every
// phone that opens the page, or by the page itself when there is no relay (net.ts). The
// renderer only reads it. The camera is either glued to a trainer or dragged freely over
// the whole of Hoenn.
//
// Reuses the shell's walkability through bots/world.ts, on data/world.json: the shell's
// world.json regenerated with export-world.py's ledge fix (the shipped one walls every
// ledge, and changing it moves the live bots, so that ships on its own). Every picture is cut from the
// player's ROM in the browser (romart.ts): the site ships none. Nothing here is shell code.

import { WorldIndex } from '../src/bots/hoenn';
import { isTallGrass, isWater, type WorldMap, type Spot } from '../src/bots/world';
import { loadPatches } from '../src/bots/patches';
import { dealParty, rungForPhase } from '../src/bots/party';
import { gradeOf } from '../src/bots/roster';
import { DIR_EAST } from './sim';
import { ATTENDANT, DOCKS, islandMaps, HOME_N, KEY_A, KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_SELECT, KEY_UP, SAFARI, WALKUP_BANG, emptyBag, interiors, makeRoom, type Actor, type Bag, type RoomEvent, type Results, type Ring, type Spill } from './shared/room';
type Person = NonNullable<Spill['person']>;
import { SKIN_GFX } from './shared/bots';
import { connectWorld, soloLink, type WorldLink, type WorldSocket } from './net';
import { over } from './shared/over';
import { Lobby, me, seeThrough, type RoomInfo } from './lobby';
import { loadCareer, ordinal, recordMatch } from '../src/match/career';
import type { MatchTally } from '../src/match/tally';
import { tallySince } from './carry';
import { STICK_KEY, guessedStickKeys, learnAxis, loadStickMap, startStickLearn, stickKeys, stickLearnStep, type AxisSense, type StickMap } from '../src/pad';
import { fameOf, resultsView, standingsOf, tallyLines, type FameMon } from '../src/ui/results';
import { favourite } from '../src/match/tally';
import { moveInfo, type Rom as MoveTables } from '../src/battle/movebook';
import { OUT_BATCH_MS, event, felled, opening, outs, won } from '../src/match/ticker';
import { MessageBox } from './msgbox';
import { MusicCue, type Where } from './music';
import { bootRom, loadRom, lastStart, type DuelLink, type Fought, type RomBattles } from './rom';
import { devRomParam, importRom } from './import';
import { askToKeepStorage, registerServiceWorker } from '../src/pwa';
import { devPace, parseRoomHash, withRoom, withoutRoom } from '../src/hash';
import { recordSolo, statFlushed, statMessage } from '../src/match/stats';
import { WORLD_HASH_SHORT, battlesOn } from './net';
import { groundCount, isTm, tradedInto } from './shared/items';
import { GIFTS } from '../src/match/gifts';
import { GOLD } from '../src/match/events';
import { FLYING, STORIES } from '../src/match/story';
import hiddenJson from './data/hidden.json';
import { RomArt, type MapAnim } from './romart';
import { AskBox } from './askbox';
import { ANIM_COUNTER_MAX } from '../src/tile-anims';
import { RingMap } from './ringmap';
import { Watch } from './watch';
import { FADE_COLOR_WORD, FADE_Y_WORD, FOG_EVA, FOG_EVB, fadeOf, keyPicture } from '../src/field';
import { PadPrefsControl } from '../src/ui/padprefs';
import { wireDpad } from './dpad';
import { StartMenu } from './startmenu';
import { BACK_H, BATTLE_TYPE_RECORDED, BattleMenu, CELL_H, battleWantsNoPad, readBattleView } from '../src/ui/battlemenu';
import { BATTLE_TYPE_TRAINER, CARD_H, SidesView } from '../src/ui/sides';
import { BAG_POSITION_POCKET, readBattleBag } from '../src/ui/bag';
import { MENU_ACTION, TouchLayer } from '../src/touch';
import { HUD } from '../src/net/hud';
import { ITEM_MACH_BIKE, PhoneHud, fogPhase, signFor } from '../src/ui/phonehud';
import { noticeScreen, type RoomSeat, type SheetModel } from '../src/ui/screens';
import { cardFields } from '../src/ui/profile';
import { makeJudge, type Judge } from './judge';
import { nameBstart } from '../src/match/spectate';
import { LEADERS } from './shared/gyms';
import { CLERKS, priceOf, shelf } from './shared/marts';
import type { GbaKey } from '../src/emu';
import spritesData from '../src/data/sprites.json';
import encounterData from '../src/data/encounters.json';

const TILE = 16;
// include/constants/event_objects.h.
const OBJ_EVENT_GFX_ITEM_BALL = 59;
const OBJ_EVENT_GFX_NURSE = 58;
const OBJ_EVENT_GFX_WOMAN_3 = 24;
const OBJ_EVENT_GFX_MART_EMPLOYEE = 83;
const OBJ_EVENT_GFX_GENTLEMAN = 48;
const OBJ_EVENT_GFX_BRENDAN_SURFING = 2, OBJ_EVENT_GFX_MAY_SURFING = 92;
const BIKE_GFX = [1, 90]; // OBJ_EVENT_GFX_BRENDAN_MACH_BIKE, _MAY_MACH_BIKE
const OBJ_EVENT_GFX_CUTTABLE_TREE = 82, OBJ_EVENT_GFX_BREAKABLE_ROCK = 86, OBJ_EVENT_GFX_PUSHABLE_BOULDER = 87;
// export-world.py's classes for them.
const CLASS_WATER = 2, CLASS_CUT = 9, CLASS_BOULDER = 10;
const OBJ_EVENT_GFX_BIRCHS_BAG = 97;
const SHEETS = spritesData as Record<string, { name: string; w: number; h: number; frames: number }>;

// ---- layout: every outdoor map at a place in one plane --------------------------------

interface Placed {
  m: WorldMap;
  gx: number; // tiles
  gy: number;
  ground?: HTMLCanvasElement;
  cover?: HTMLCanvasElement;
  border?: HTMLCanvasElement;
  /** Its animated cells (romart.ts), laid over the ground each frame. */
  anims?: MapAnim[];
  borderTint?: string;
  mips?: HTMLCanvasElement[]; // 1/4, 1/8, 1/16, each averaged from the one before
  /** Painted with its REGI wall open (br_story.c's Open). */
  open?: boolean;
  classes: Uint8Array;
  /** The cut trees and Strength boulders standing on it: [x, y, gfx]. */
  props?: [number, number, number][];
}

function decode(grid: string, cells: number): Uint8Array {
  const out = new Uint8Array(cells);
  let i = 0;
  for (const run of grid.split(';')) {
    if (!run) continue;
    const [n, v] = run.split('x').map(Number);
    out.fill(v, i, i + n);
    i += n;
  }
  return out;
}

/** BFS over the seams from Littleroot: a neighbour's origin is this map's, shifted by the
 *  connection's offset along the shared edge (World.landAcross is the same sum backwards). */
/** The ferry's islands (room.ts islandMaps): not a place to drop. */
const ISLANDS = new Set<string>();
function layout(maps: WorldMap[]): Map<string, Placed> {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const placed = new Map<string, Placed>();
  const start = byId.get('MAP_LITTLEROOT_TOWN')!;
  placed.set(start.id, { m: start, gx: 0, gy: 0, classes: decode(start.grid, start.w * start.h) });
  const queue = [start.id];
  while (queue.length) {
    const p = placed.get(queue.shift()!)!;
    for (const s of p.m.seams) {
      const to = byId.get(s.to);
      if (!to || !to.outdoor || placed.has(to.id)) continue;
      let gx = p.gx;
      let gy = p.gy;
      if (s.dir === 'north') { gx += s.offset; gy -= to.h; }
      else if (s.dir === 'south') { gx += s.offset; gy += p.m.h; }
      else if (s.dir === 'west') { gx -= to.w; gy += s.offset; }
      else { gx += p.m.w; gy += s.offset; }
      placed.set(to.id, { m: to, gx, gy, classes: decode(to.grid, to.w * to.h) });
      queue.push(to.id);
    }
  }
  // The buildings and caves, each on its own, in rows well east of Hoenn: drawn where the
  // camera follows a trainer in, and never in sight of the outdoors.
  let right = 0, top = Infinity;
  for (const p of placed.values()) { right = Math.max(right, p.gx + p.m.w); top = Math.min(top, p.gy); }
  const GAP = 48, ROW = 640;
  let x = right + 200, y = top, rowH = 0;
  for (const [id, { m }] of interiors(maps, placed)) {
    if (x + m.w > right + 200 + ROW) { x = right + 200; y += rowH + GAP; rowH = 0; }
    placed.set(id, { m, gx: x, gy: y, classes: decode(m.grid, m.w * m.h) });
    x += m.w + GAP;
    rowH = Math.max(rowH, m.h);
  }
  // The ferry's islands, each on its own, in the row past the buildings'.
  x = right + 200; y += rowH + GAP; rowH = 0;
  for (const m of islandMaps(maps)) {
    ISLANDS.add(m.id);
    placed.set(m.id, { m, gx: x, gy: y, classes: decode(m.grid, m.w * m.h) });
    x += m.w + GAP;
    rowH = Math.max(rowH, m.h);
  }
  // The Safari Zone (the opening's, behind a closed gate), by its own seams, below them.
  const south = byId.get('MAP_SAFARI_ZONE_SOUTH');
  if (south) {
    placed.set(south.id, { m: south, gx: right + 200, gy: y + rowH + 200, classes: decode(south.grid, south.w * south.h) });
    const q = [south.id];
    while (q.length) {
      const p = placed.get(q.shift()!)!;
      for (const s of p.m.seams) {
        const to = byId.get(s.to);
        if (!to || !to.id.startsWith('MAP_SAFARI_ZONE_') || placed.has(to.id)) continue;
        let gx = p.gx, gy = p.gy;
        if (s.dir === 'north') { gx += s.offset; gy -= to.h; }
        else if (s.dir === 'south') { gx += s.offset; gy += p.m.h; }
        else if (s.dir === 'west') { gx -= to.w; gy += s.offset; }
        else { gx += p.m.w; gy += s.offset; }
        placed.set(to.id, { m: to, gx, gy, classes: decode(to.grid, to.w * to.h) });
        q.push(to.id);
      }
    }
  }
  return placed;
}

let art: RomArt | null = null;
/** METATILE_Cave_SealedChamberEntrance_* (metatile_labels.h), where Open lays them. */
const SEALED_CHAMBER: [number, number, number][] = [[7, 19, 0x22a], [8, 19, 0x22b], [9, 19, 0x22c], [7, 20, 0x232], [8, 20, 0x233], [9, 20, 0x234]];
/** METATILE_Cave_EntranceCover over SealedChamberBraille_Mid: the wall before it opens. */
const HIDDEN_CHAMBER: [number, number, number][] = [[7, 19, 0x229], [8, 19, 0x229], [9, 19, 0x229], [7, 20, 0x235], [8, 20, 0x235], [9, 20, 0x235]];
const DOOR_MAPS = new Set(STORIES.filter((s) => s.door).map((s) => s.map));
/** A wall opened since its map was painted: painted again. */
function doorsFrame(): void {
  for (const e of link.room.events) {
    const p = e.opened ? placed.get(e.map) : undefined;
    if (p && !p.open) { p.open = true; p.ground = p.cover = p.mips = undefined; }
  }
  // A new round's walls are shut again.
  for (const p of placed.values()) if (p.open && !link.room.events.some((e) => e.opened && e.map === p.m.id)) { p.open = false; p.ground = p.cover = p.mips = undefined; }
}
let ringMap: RingMap | null = null;
/** A map's pictures, cut from the ROM the first time it is seen (~20 ms a map); the rest
 *  are cut in the background after boot so a zoom-out never waits on them. */
function paint(p: Placed): boolean {
  if (p.ground) return true;
  if (!art) return false;
  // A REGI wall: shut as the map's OnLoad hides it (HideRegiEntrance), or open, the
  // sealed chamber's entrance on its six cells (br_story.c's Open).
  const wall = !DOOR_MAPS.has(p.m.id) ? undefined : p.open ? SEALED_CHAMBER : HIDDEN_CHAMBER;
  const over = wall && new Map(wall.map(([x, y, block]) => [y * p.m.w + x, block]));
  const a = art.map(p.m.group, p.m.num, over);
  p.ground = a.ground;
  p.cover = a.cover;
  p.border = a.border;
  p.anims = a.anims;
  return true;
}

/** The map's animated cells in view (romart.ts anims), each in the look tileset_anims.c's
 *  counter has on show now: the sea, its edges, the waterfalls, the flowers, the towns'
 *  own (Cam, 10-30: "water animation not working"). */
function drawAnims(ctx: CanvasRenderingContext2D, p: Placed, vx0: number, vy0: number, vx1: number, vy1: number): void {
  if (!p.anims?.length) return;
  const step = frame % ANIM_COUNTER_MAX;
  const x0 = Math.floor(vx0 / TILE) - p.gx, y0 = Math.floor(vy0 / TILE) - p.gy;
  const x1 = Math.ceil(vx1 / TILE) - p.gx, y1 = Math.ceil(vy1 / TILE) - p.gy;
  const w = p.m.w;
  for (const a of p.anims) {
    const sx = a.states[step] * TILE;
    for (const i of a.cells) {
      const cx = i % w, cy = (i - cx) / w;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      ctx.drawImage(a.sheet, sx, 0, TILE, TILE, (p.gx + cx) * TILE, (p.gy + cy) * TILE, TILE, TILE);
    }
  }
}

// ---- actors: the one source of position ------------------------------------------------

// sAnim_GoSouth/North/West/East, and the running sheet's (frames 9..17 of BrendanNormal).
const GO = { 1: [3, 0, 4, 0], 2: [5, 1, 6, 1], 3: [7, 2, 8, 2], 4: [7, 2, 8, 2] } as Record<number, number[]>;
const RUN = { 1: [12, 9, 13, 9], 2: [14, 10, 15, 10], 3: [16, 11, 17, 11], 4: [16, 11, 17, 11] } as Record<number, number[]>;
const FACE = { 1: 0, 2: 1, 3: 2, 4: 2 } as Record<number, number>;

// ---- input ----------------------------------------------------------------------------

const held = new Set<string>();
const pressed = new Set<string>();
const KEYMAP: Record<string, string> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', x: 'b', X: 'b', z: 'a', Z: 'a', Shift: 'select', Enter: 'a', ' ': 'a',
};
// A long press is a held button, never a page's selection, callout or drag (HBR-98).
const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
for (const type of ['contextmenu', 'selectstart', 'dragstart']) document.addEventListener(type, (e) => { if (!typing(e.target)) e.preventDefault(); });
/** The start card is up: nothing behind it moves (review of #157). */
const intro = () => document.getElementById('intro') !== null;
// The menu and the room (lobby.ts) have the keys while they are up: Emerald's, as the
// live game's stage takes them, and a keyboard's letters for an entry.
const STAGE_KEY: Record<string, GbaKey> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', z: 'a', x: 'b', Enter: 'start', Escape: 'b' };
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && remap.cancel) { remap.cancel(); e.stopImmediatePropagation(); return; }
  if (!lobby?.shown) return;
  e.stopImmediatePropagation();
  if (!e.ctrlKey && !e.metaKey && !e.altKey && lobby.stage.char(e.key)) { e.preventDefault(); return; }
  const k = STAGE_KEY[e.key];
  if (k) { e.preventDefault(); if (!e.repeat) lobby.stage.key(k); }
}, true);
addEventListener('keydown', (e) => {
  if (intro()) return;
  if (e.key === 'v' || e.key === 'V') { toggleSpectate(); return; }
  if ((e.key === 'm' || e.key === 'M' || e.key === 'Escape') && !e.repeat) { void openMenu(); return; }
  if ((e.key === 'f' || e.key === 'F') && !e.repeat) { itemfinder(); return; }
  if ((e.key === 'r' || e.key === 'R') && !e.repeat) { openSheet(); return; }
  const k = KEYMAP[e.key];
  if (!k) return;
  e.preventDefault();
  if (!held.has(k)) pressed.add(k);
  held.add(k);
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.key]; if (k) held.delete(k); });
addEventListener('blur', () => held.clear());
// ---- the room ------------------------------------------------------------------------

let placed: Map<string, Placed>;
let link: WorldLink;
let frame = 0;

function global(s: Spot): { gx: number; gy: number } | null {
  const p = placed.get(s.map);
  return p ? { gx: p.gx + s.x, gy: p.gy + s.y } : null;
}

function classAt(s: Spot): number {
  const p = placed.get(s.map);
  if (!p || s.x < 0 || s.y < 0 || s.x >= p.m.w || s.y >= p.m.h) return 1;
  return p.classes[s.y * p.m.w + s.x];
}

/** Every trainer as drawn: the room's, with mine where my thumb has it. */
function actors(): Actor[] {
  const me = link.mine();
  return link.room.actors.map((a) => (me && a.id === link.me ? me : a));
}

/** My keys this frame, as the room takes them. Pressing A to talk and walking are the
 *  room's business (a bot you face, a marked spot you land on); the page only keeps a
 *  held A from the last battle's text out of the next one. */
/** The dock's BIKE / WALK, a tap: SELECT held long enough for the step under way to end
 *  and the bike to be got on or off (sim.ts reads it as the next action is chosen). */
let selectUntil = 0;
let toldLoading = false;
function myBits(): number {
  if (spectating || battle || swapping || romUp || asking || intro()) return 0;
  // The battle ROM still booting (a match started seconds after the page opened): a
  // marked spot or a trainer stepped into now could only say "still loading" and spend
  // the spot, so the trainer waits for it, once told why.
  if (!rom) {
    if (held.size && !toldLoading) { toldLoading = true; tick('Getting the game ready…'); }
    return 0;
  }
  const bits = (held.has('up') ? KEY_UP : 0) | (held.has('down') ? KEY_DOWN : 0) | (held.has('left') ? KEY_LEFT : 0) |
    (held.has('right') ? KEY_RIGHT : 0) | (held.has('b') ? KEY_B : 0) | (held.has('a') && frame >= calmUntil ? KEY_A : 0) |
    (held.has('select') || frame < selectUntil ? KEY_SELECT : 0);
  // A thumb on the pad takes over from a tapped walk.
  if (bits) { tapWalk = null; return bits; }
  return tapBits();
}

// ---- tap to walk (the live game's touch.ts, on the page's own world) ------------------
// A tap on the map is a place to go: the route is a walk over the room's own steps (what a
// thumb on the pad could walk), held a cell at a time. A tap on something that cannot be
// stood on (a trainer, a sign, the nurse) is "walk up to it, face it, press A".

const DIR_BIT: Record<number, number> = { 1: KEY_DOWN, 2: KEY_UP, 3: KEY_LEFT, 4: KEY_RIGHT };
let tapWalk: { dirs: number[]; at: string; since: number; press: boolean } | null = null;
const spotKey = (p: Spot) => `${p.map}:${p.x}:${p.y}`;

function tapBits(): number {
  const me = link.mine();
  if (!tapWalk || !me) return 0;
  const here = spotKey(me.m.spot);
  if (here !== tapWalk.at) { tapWalk.at = here; tapWalk.since = frame; tapWalk.dirs.shift(); }
  // Turned to face what was tapped (a bump turns): A, once, and the walk is done.
  if (!tapWalk.dirs.length || (tapWalk.dirs.length === 1 && tapWalk.press && me.m.facing === tapWalk.dirs[0] && frame - tapWalk.since > 6)) {
    const a = tapWalk.press && frame >= calmUntil;
    tapWalk = null;
    return a ? KEY_A : 0;
  }
  // Nothing moves for a second: something is in the way (another trainer). Stop.
  if (frame - tapWalk.since > 60) { tapWalk = null; return 0; }
  return DIR_BIT[tapWalk.dirs[0]];
}

/** Starts a walk to the cell under the finger. */
function tapTo(clientX: number, clientY: number): void {
  const me = link?.mine();
  if (!me || !rom || isOut || battle || swapping || romUp || asking || intro()) return;
  const dpr = devicePixelRatio || 1;
  const wx = cam.x + (clientX * dpr - devW / 2) / zoom;
  const wy = cam.y + (clientY * dpr - devH / 2) / zoom;
  const p = mapUnder(wx, wy);
  if (!p) return;
  const goal = { map: p.m.id, x: Math.floor(wx / TILE) - p.gx, y: Math.floor(wy / TILE) - p.gy };
  if (goal.x < 0 || goal.y < 0 || goal.x >= p.m.w || goal.y >= p.m.h) return;
  const route = routeTo(me, goal);
  tapWalk = route ? { dirs: route.dirs, at: spotKey(me.m.spot), since: frame, press: route.press } : null;
}

/** The steps to `goal`, or to beside it and one more toward it (a bump: face it, then A)
 *  when it cannot be stood on. A breadth-first walk over the room's own step function. */
function routeTo(me: Actor, goal: Spot): { dirs: number[]; press: boolean } | null {
  const step = link.room.stepFor(me);
  const want = spotKey(goal);
  // A trainer on it: walk up and talk (the step function knows the ground, not who stands on it).
  const taken = link.room.actors.some((a) => a.id !== me.id && spotKey(a.m.spot) === want);
  const from = new Map<string, [string, number] | null>([[spotKey(me.m.spot), null]]);
  const q: Spot[] = [me.m.spot];
  const back = (k: string) => { const dirs: number[] = []; for (let c = k; from.get(c); c = from.get(c)![0]) dirs.unshift(from.get(c)![1]); return dirs; };
  let beside: { k: string; d: number } | null = null;
  for (let i = 0; i < q.length && i < 4000; i++) {
    const at = q[i];
    const k = spotKey(at);
    if (k === want && !taken) return { dirs: back(k), press: false };
    for (const d of [1, 2, 3, 4]) {
      const r = step(at, d);
      // The goal one step off, and not to be stood on: beside it is where to go.
      const dx = d === 3 ? -1 : d === 4 ? 1 : 0, dy = d === 1 ? 1 : d === 2 ? -1 : 0;
      if (!beside && at.map === goal.map && at.x + dx === goal.x && at.y + dy === goal.y && (!r || spotKey(r.to) !== want || taken)) beside = { k, d };
      if (!r || r.warp || from.has(spotKey(r.to)) || (taken && spotKey(r.to) === want)) continue;
      from.set(spotKey(r.to), [k, d]);
      q.push(r.to);
    }
    if (beside) return { dirs: [...back(beside.k), beside.d], press: true };
  }
  return null;
}

// ---- marked spots: the live game's visible encounters ------------------------------------

// The room deals them from its seed the way every ROM deals them (bots/patches.ts,
// br_patch.c's Pick), and the ROM rolls the national stand-ins off the same seed.

// ---- the battle handoff: the real ROM fights, the page waits ---------------------------

const battleEl = document.getElementById('battle')!;
const fogEl = document.getElementById('ringfog') as HTMLCanvasElement;
document.getElementById('intro-go')!.addEventListener('click', () => document.getElementById('intro')!.remove());
const battleNote = document.getElementById('battle-note')!;
const gbaCanvas = document.getElementById('gba') as HTMLCanvasElement;
let rom: RomBattles | null = null;
/** Bot-vs-bot fights the room gives this page, in a hidden second ROM (judge.ts). */
let judge: Judge | null = null;
let artMs = 0;
let battle: { foe: Actor | null; shownAt: number; foeGone?: boolean; heardAt?: number; round: number; link: WorldLink; boss?: number } | null = null;
/** The ROM has the screen for a dropped bag's team (rom.team). */
let swapping = false;
let calmUntil = 0;
const handoff: number[] = []; // ms from the trigger to the ROM's first battle frame, and back


/** A battle the ROM fights, the page showing it from its first frame and taking the
 *  screen back when it is over. */
function handOff(foe: Actor | null, run: (r: RomBattles, onStart: () => void) => Promise<Fought>): void {
  // One battle at a time: one still running from the match before (its ROM is busy with
  // it) turns this one down, or its end would be credited to this foe.
  if (battle) { link.end(); return; }
  held.clear();
  battle = { foe, shownAt: performance.now(), round: link.room.results.round, link };
  if (!rom) {
    battleEl.classList.add('on');
    battleNote.textContent = 'The game is still loading. Try again in a moment.';
    setTimeout(() => endBattle(null), 1500);
    return;
  }
  battleNote.textContent = '';
  const t0 = performance.now();
  const firstFrame = rom.emu.onFrame(() => { handoff.push(performance.now() - t0); firstFrame(); });
  // The page keeps the screen until the ROM's battle is up: before that the hidden ROM
  // is still standing in its own Littleroot, which is what showed through ("teleported
  // back to my house", Cam). A battle that never starts never takes the screen.
  const r = rom;
  void Promise.resolve()
    .then(() => run(r, () => battleEl.classList.add('on')))
    .then(endBattle, (e) => {
      console.warn('spike battle failed', e);
      endBattle(null);
      lastResult = 'The battle engine stopped working. Reload the page to battle again.';
    });
}

// Item balls (room.ts's ground): what I picked up goes into the ROM's bag, one at a time,
// and waits for the ROM if it is still booting.
/** The message box above the dock (msgbox.ts): what just happened to me, and the ticker. */
const msgBox = new MessageBox(document.getElementById('msg')!);
let sayUntil = 0;
// The phone HUD's scale (wirePhoneHud sets both on a phone).
msgBox.setScale(Math.min(2, Math.max(1, innerWidth / 250)));
const toGive: ({ key: number; item: number; gift?: boolean; hidden?: string } | { key: number; bag: Bag; name: string; person?: Person })[] = [];
let giving = false;

function say(text: string): void {
  msgBox.show(text);
  sayUntil = performance.now() + 2500;
}

function giveNext(): void {
  if (giving || !rom || !toGive.length) return;
  giving = true;
  const next = toGive.shift()!;
  const name = (id: number) => art?.itemName(id) || `item ${id}`;
  if ('bag' in next) {
    (next.person ? meet(next.key, next.bag, next.person) : openBag(next.key, next.bag, next.name)).catch((e) => console.warn('spike bag failed', e)).finally(() => { giving = false; giveNext(); });
    return;
  }
  const { key, item, gift, hidden } = next;
  // A TM is taught and a held item given, there and then, on the ROM's own screens.
  const screen = isTm(item) || GIFTS.includes(item);
  if (screen) { if (gift) say(`A gift: ${name(item)}!`); romUp = true; }
  const took = screen
    ? rom.teach(item, () => battleEl.classList.add('on')).finally(() => { romUp = false; battleEl.classList.remove('on'); })
    : rom.give(item, groundCount(item));
  took.then((got) => {
    // What the ROM made of it (br_items.c's Apply), not what was on the ground.
    if (!got) {
      say(`No room in the bag for ${name(item)}.`);
      if (hidden) dug.delete(hidden); // still buried
      else link.drop(key); // it stays where it lay
    } else if (screen) {
      const kept = got.items.some((g) => g.id === item);
      if (kept) say(`${name(item)} went in the BAG.`);
      else if (!gift) say(`Taught ${name(item)}!`);
    }
    else if (got.items.length) say(`Found ${got.items.map((g) => `${g.n > 1 ? `${g.n} ` : ''}${name(g.id)}`).join(', ')}!`);
    else if (got.money) say(`Sold ${name(item)} for ¥${got.money}.`);
    else say(`${name(item)}! Your team got stronger.`);
  }, (e) => console.warn('spike give failed', e)).finally(() => { giving = false; giveNext(); });
}

// A dropped bag asks what to take (HBR-82): POKéMON, its team on the ROM's BAG screen, or
// BAG, its items. B or CANCEL leaves it lying. The pad drives the question.
/** A MART's shelf (shop.c's buy list): each row's price and what the picked one is. */
interface Shelf { money: number; prices: (number | undefined)[]; words: (pick: number) => string[] }
/** shop.c's quantity roller: up and down one, left and right ten, 1..max. */
interface Roller { n: number; max: number; each: number; inBag: number; money: number }
let asking: { pick: number; start: boolean; title: string; rows: [string, string][]; shelf?: Shelf; roller?: Roller; done: (c: string) => void } | null = null;
const startMenu = new StartMenu(document.getElementById('startmenu') as HTMLCanvasElement, document.getElementById('stock') as HTMLCanvasElement);
const askBox = new AskBox(document.getElementById('askbox') as HTMLCanvasElement);
for (const [id, rowFor] of [['startmenu', (x: number, y: number) => startMenu.rowFor(x, y)], ['askbox', (x: number, y: number) => askBox.rowFor(x, y)]] as const) {
  document.getElementById(id)!.addEventListener('pointerdown', (e) => {
    const i = rowFor(e.clientX, e.clientY);
    if (asking && i >= 0 && asking.rows[i]) { asking.pick = i; asking.done(asking.rows[i][1]); }
  });
}

function askPaint(): void {
  if (!asking) return;
  const scale = zoom / (devicePixelRatio || 1);
  const labels = asking.rows.map(([label]) => label);
  if (asking.start) {
    const balls = link.room.ring().safari && rom ? rom.safariBalls() : null;
    startMenu.show(labels, asking.pick, balls, scale);
  } else if (asking.roller) {
    askBox.show({ kind: 'count', title: asking.title, ...asking.roller }, scale);
  } else if (asking.shelf) {
    const { money, prices, words } = asking.shelf;
    askBox.show({ kind: 'shop', money, rows: labels.map((name, i) => ({ name, price: prices[i] })), pick: asking.pick, words: words(asking.pick) }, scale);
  } else askBox.show({ kind: 'choice', title: asking.title, rows: labels, pick: asking.pick }, scale);
}

function askKey(k: string): void {
  if (!asking) return;
  const r = asking.roller;
  if (r) {
    if (k === 'up') r.n = r.n % r.max + 1;
    else if (k === 'down') r.n = (r.n + r.max - 2) % r.max + 1;
    else if (k === 'right') r.n = Math.min(r.max, r.n + 10);
    else if (k === 'left') r.n = Math.max(1, r.n - 10);
    else if (k === 'a') return asking.done(String(r.n));
    else if (k === 'b') return asking.done('');
    askPaint();
    return;
  }
  const n = asking.rows.length;
  if (k === 'up') asking.pick = (asking.pick + n - 1) % n;
  else if (k === 'down') asking.pick = (asking.pick + 1) % n;
  else if (k === 'a') return asking.done(asking.rows[asking.pick][1]);
  else if (k === 'b' || (k === 'start' && asking.start)) return asking.done('');
  askPaint();
}

/** A question as Emerald asks it (askbox.ts): `title` in the message box, its rows
 *  `[label, answer]` in a window over it; '' is no (B answers it too). The START menu
 *  (`start`) is its own window on the field; a MART's `shelf` and `roller` are shop.c's. */
function ask(title: string, rows: [string, string][], start = false, more: { pick?: number; shelf?: Shelf; roller?: Roller } = {}): Promise<string> {
  return new Promise((resolve) => {
    asking = { pick: 0, start, title, rows, ...more, done: (c) => { asking = null; startMenu.hide(); askBox.hide(); calmUntil = frame + 30; resolve(c); } };
    askPaint();
  });
}

/** A at a dropped bag: what it holds, the way the match asks (br_loot.c's TryTake). What
 *  is left goes back down as the bag, for somebody else (POK-294: nothing leaves). */
async function openBag(key: number, bag: Bag, who: string): Promise<void> {
  const mons = bag.mons ?? [];
  const things = bag.items.length > 0 || bag.money > 0;
  const c = mons.length && things ? await ask(`What will you take from ${who}'s BAG?`, [['POKéMON', 'mons'], ['BAG', 'items'], ['CANCEL', '']]) : mons.length ? 'mons' : 'items';
  if (c === 'items') return takeBag(key, bag, who);
  if (c !== 'mons' || isOut || !rom) { link.drop(key, bag); return; }
  swapping = true;
  held.clear();
  let left = mons;
  try {
    left = await rom.team(mons, who, () => battleEl.classList.add('on'));
  } finally {
    swapping = false;
    battleEl.classList.remove('on');
    held.clear();
    pressed.clear();
    calmUntil = frame + 30;
  }
  const rest: Bag = { items: bag.items, money: bag.money, mons: left };
  if (!emptyBag(rest)) link.drop(key, rest);
}

/** START: the match's own menu rows on the ROM's screens (start_menu.c's MENU_ACTION_*),
 *  asked here first so the hidden field never shows. MAP (13) is the ROM's, standing where
 *  I stand, with this world's fog laid over it (ringmap.ts). */
async function openMenu(): Promise<void> {
  if (!rom || isOut || battle || swapping || asking || spectating) return;
  // The ROM's rows (start_menu.c): POKéMON once I have one, no MAP in the Safari, my
  // name for the trainer card. A phone has the room on its dock, as live.
  const name = link.room.actor(link.me)?.name || 'YOU';
  const rows: [string, string][] = [
    ...(rom.partyCount() > 0 ? [['POKéMON', '1'] as [string, string]] : []),
    ['BAG', '2'],
    ...(ringMap && !link.room.ring().safari ? [['MAP', '13'] as [string, string]] : []),
    [name, '4'],
    ...(lobby && !touchPad ? [['ROOM', 'room'] as [string, string]] : []),
    ['EXIT', ''],
  ];
  const c = await ask('MENU', rows, true);
  if (c === 'room') { openSheet(); return; }
  await runMenu(c);
}

/** A row of the START menu (start_menu.c's MENU_ACTION_*) on the ROM's own screen: what
 *  MENU picked, or the phone dock's PARTY and MAP straight away. */
async function runMenu(c: string): Promise<void> {
  if (!c || !rom || isOut || battle || swapping || asking || spectating) return;
  const me = link.room.actor(link.me);
  const look = c === '13' && me && ringMap ? ringMap.look(me.m.spot) : undefined;
  let uncover = () => {};
  swapping = true;
  held.clear();
  try {
    const { said } = await rom.menu(Number(c), () => {
      if (!swapping) return;
      battleEl.classList.add('on');
      if (look) uncover = ringMap!.cover(fogEl, rom!.emu);
    }, () => { uncover(); battleEl.classList.remove('on'); }, look);
    if (said) say(said);
  } finally {
    uncover();
    swapping = false;
    battleEl.classList.remove('on');
    held.clear();
    pressed.clear();
    calmUntil = frame + 30;
  }
}

/** A at a REGI chamber's sealed wall (br_story.c): DESERT RUINS' cracks for anybody,
 *  ANCIENT TOMB's for a team with a Flying-type in it, ISLAND CAVE's by itself once the
 *  ring has moved on. */
async function door(n: number, how: string, opened: boolean): Promise<void> {
  if (opened) { say('The wall crumbled away! A way in opened up.'); return; }
  if (how === 'wait') { say("It's sealed tight. It will open when the ring closes in."); return; }
  const mons = rom ? (await rom.spill()).mons : [];
  if (mons.some((m) => FLYING.has(m.species))) {
    link.open(n);
    say('Your Flying-type POKéMON beat its wings... The wall opened!');
  } else say('A gust of wind seems to come from inside. A Flying-type POKéMON could open it.');
}

/** The ferry (br_story.c): Lilycove's attendant sails to an island a live story is on, and
 *  its sailor sails back. Bots never take it. */
async function ferry(to: { id: string; name: string }[], home: boolean): Promise<void> {
  if (home) {
    if (await ask('Sail back to LILYCOVE CITY?', [['YES', 'y'], ['NO', '']]) === 'y') link.sail('');
    return;
  }
  if (!to.length) { say('The ferry is not sailing anywhere right now.'); return; }
  const c = await ask('Where would you like to sail?', [...to.map((t): [string, string] => [t.name, t.id]), ['CANCEL', '']]);
  if (c) link.sail(c);
}

/** A story's person (story.ts's people): STEVEN hands his over; CAPT. STERN wants the
 *  SCANNER first, out of my bag, as br_story.c's BrStory_Hands asks. */
async function meet(key: number, bag: Bag, person: Person): Promise<void> {
  const item = (id: number) => art?.itemName(id) || `item ${id}`;
  if (person.wants && !(await rom!.take(person.wants))) {
    say(`${person.name} wants the ${item(person.wants)}.`);
    link.drop(key, bag);
    return;
  }
  const given = bag.items.map((r) => item(r.id)).join(', ');
  await takeBag(key, bag, person.name, true);
  say(person.wants ? `${person.name} took the ${item(person.wants)} and gave you ${given}!` : `${person.name} gave you ${given}!`);
}

/** A fallen trainer's bag, row by row into mine the ROM's way, and its money. What did
 *  not fit, and the team, go back down as the bag. */
async function takeBag(key: number, bag: Bag, who: string, quiet = false): Promise<void> {
  const r = rom!;
  const rest: Bag = { items: [], money: 0, mons: bag.mons };
  let took = 0;
  for (const row of bag.items) {
    // A GIVE's count is a byte: a berry stack (up to 999) goes in pieces, and what did not
    // fit of it goes back.
    let left = row.n;
    while (left > 0 && !isOut) {
      const n = Math.min(left, 99);
      if (!await r.give(row.id, n)) break;
      left -= n;
    }
    if (left < row.n) took++;
    if (left) rest.items.push({ id: row.id, n: left });
  }
  // Out by now: the money stays in the bag too, not in a ROM whose spill is already read.
  if (isOut) rest.money = bag.money;
  else await r.addMoney(bag.money);
  const money = bag.money && !isOut ? ` and ¥${bag.money}` : '';
  if (!quiet) say(`Took ${who}'s bag: ${took} item${took === 1 ? '' : 's'}${money}.${rest.items.length ? ' Some would not fit.' : ''}`);
  if (!emptyBag(rest)) link.drop(key, rest);
}

/** What the room started for me: A at a bot, or a marked spot I landed on (the room took
 *  it as the battle started, as BrPatch_Take does), or A at an item ball. */
function startFor(e: RoomEvent): void {
  if (e.type === 'nurse') { void nurse(); return; }
  if (e.type === 'mart') { void mart(e.map); return; }
  if (e.type === 'trade') { void (e.gives ? gift(e.n, e.species) : trade(e.n, e.species)); return; }
  if (e.type === 'door') { void door(e.n, e.how, !!e.opened); return; }
  if (e.type === 'guarded') { say(`${e.name} guards it!`); return; }
  if (e.type === 'ferry') { void ferry(e.to, !!e.home); return; }
  if (e.type === 'gate') {
    // A story's gate (br_story.c): his own fight in the hidden ROM, past the eight gym
    // leaders (BrStory_StartGate); won, what he held is mine, and lost, it is his again.
    if (swapping) rom?.leave();
    asking?.done('');
    const l = link, key = e.key, fog = inFogNow();
    handOff(null, (r, onStart) => r.boss(LEADERS.length + e.gate, onStart, fog).then((f) => {
      if (f.ok && f.outcome === 1) {
        say(`You beat ${e.name}!`);
        toGive.push({ key, bag: e.bag, name: e.name });
        giveNext();
      } else l.drop(key);
      return f;
    }, (err) => { l.drop(key); throw err; }));
    return;
  }
  if (e.type === 'legend') {
    // Its own battle; caught, it is mine, and anything else puts it back where it stood
    // for the next trainer (Cam: losing to one puts you out, and it goes back for retries).
    if (swapping) rom?.leave();
    asking?.done('');
    const l = link, key = e.key, fog = inFogNow();
    handOff(null, (r, onStart) => r.legend(e.species, e.level, onStart, fog).then((f) => {
      if (!(f.ok && f.outcome === CAUGHT)) l.drop(key);
      return f;
    }, (err) => { l.drop(key); throw err; }));
    return;
  }
  if (e.type === 'bots') { void judgeBots(e.a, e.b); return; }
  if (e.type === 'boss') {
    // A gym leader (gyms.ts): their own battle in the hidden ROM; won, the gym's TM and purse.
    if (swapping) rom?.leave();
    asking?.done('');
    const leader = LEADERS[e.n], fog = inFogNow();
    handOff(null, (r, onStart) => r.boss(e.n, onStart, fog).then((f) => {
      if (!f.ok && f.outcome === 0) say(`${leader.name}: Come back with two POKéMON that can battle!`);
      return f;
    }));
    battle!.boss = e.n;
    return;
  }
  if (e.type === 'item' || e.type === 'bag') {
    toGive.push(e.type === 'item' ? { key: e.key, item: e.item, gift: e.gift } : { key: e.key, bag: e.bag, name: e.name, person: e.person });
    giveNext();
    return;
  }
  if (e.type === 'fight') {
    // A bot can come at me now (it saw me): a menu is no hiding place here either.
    if (swapping) rom?.leave();
    asking?.done('');
    const foe = link.room.actor(e.foe);
    if (!foe) { link.end(); return; }
    // A bot's team as the match deals it (bots/party.ts): from the seed and its seat, the
    // map it stands on, at the rung, one more mon every two phases.
    // Its grade too (roster.ts). No Zone pool: the ROM deals one at the Safari opening,
    // which this world has not got yet.
    const party = dealParty(link.room.seed, foe.id, link.room.ring().phase + 1, foe.m.spot.map, gradeOf(link.room.seed, foe.id));
    const fog = inFogNow();
    handOff(foe, (r, onStart) => r.fight(foe.name, party, foe.skin, onStart, fog));
  } else if (e.type === 'duel') {
    // Another trainer: both ROMs fight it out as a link battle, the blocks through the relay.
    // A menu is no hiding place: whatever screen I have open closes, a question goes unanswered.
    if (swapping) rom?.leave();
    asking?.done('');
    const foe = link.room.actor(e.foe);
    const me = link.room.actor(link.me);
    if (!foe || !me) { link.end(); return; }
    const fog = inFogNow();
    // Their blocks can come before our ROM is free to take them: held from now.
    const early: [number, number[]][] = [];
    const heard = () => { if (battle) battle.heardAt = performance.now(); };
    link.onBt = (q, d) => { heard(); early.push([q, d]); };
    const wire: DuelLink = {
      send: (q, d) => link.bt(q, d),
      listen: (take) => {
        link.onBt = take && ((q, d) => { heard(); take(q, d); });
        if (take) for (const [q, d] of early.splice(0)) take(q, d);
      },
    };
    handOff(foe, (r, onStart) => r.duel(me.name, foe.name, foe.skin, e.first, wire, onStart, fog));
  } else {
    const m = placed.get(e.map)!.m;
    const fog = inFogNow();
    handOff(null, (r, onStart) => r.wild(m.group, m.num, art!.behavior(m.group, m.num, e.x, e.y), onStart, fog));
  }
}

/** Two bots met and the room gave me their fight: both teams as the match deals them,
 *  fought out in the hidden ROM, and the winner told to the room. No answer (no ROM, a
 *  fight that would not end, a draw): 0, and both walk on. */
async function judgeBots(ida: number, idb: number): Promise<void> {
  const l = link, r = l.room;
  const side = (id: number) => {
    const b = r.actor(id);
    return { seat: id, party: b ? dealParty(r.seed, id, r.ring().phase + 1, b.m.spot.map, gradeOf(r.seed, id)) : [] };
  };
  const a = side(ida), b = side(idb);
  const out = judge ? await judge(a, b).catch(() => null) : null;
  if (link === l) l.bots(ida, idb, out?.winner ?? 0);
}

/** Once a second, between battles: what my team could do on the field (SURF, CUT,
 *  STRENGTH), told to the room when it changes -- a catch, a swap or a trade can. */
let fieldAsking = false;
function fieldFrame(): void {
  if (frame % 60 || fieldAsking || !rom || battle || swapping || isOut) return;
  const me = link.room.actor(link.me);
  if (!me) return;
  fieldAsking = true;
  const l = link;
  void rom.field().then((bits) => { if (l === link && bits !== (link.room.actor(link.me)?.field ?? 0)) link.field(bits); }).finally(() => { fieldAsking = false; });
}

/** BATTLE BACKDROP (the live trainer card's row, the same browser setting): OVER MAP,
 *  the default, has the ROM paint the battle's backdrop in the key blue and the page key
 *  it out (field.ts keyPicture), so the world shows under the fight; CLASSIC is black. */
const keyCanvas = document.getElementById('gba-key') as HTMLCanvasElement;
const keyImage = new ImageData(240, 160);
let seeing = false;
/** The ROM's BAG under a battle, emulator frame by emulator frame: opening (the page's
 *  pick not taken yet) or up; then, for a ball, the battle's redraw after it (the reshow,
 *  until the battle is back and done fading in). A bag that closes onto anything else (a
 *  POTION's party screen) is not held, nor one up longer than BAG_HOLD: the player's. */
let romBag: 'bag' | 'reshow' | 'free' | null = null;
let bagFrames = 0;
const BAG_HOLD = 150;
function trackBag(): void {
  const sym = romTables.sym;
  const main = sym('gMain'), run = sym('CB2_BagMenuRun'), pick = sym('gBrBag'), battleCb = sym('BattleMainCB2');
  if (!rom || main === undefined || run === undefined || pick === undefined || battleCb === undefined) return;
  const cb2 = rom.emu.read(main + 4, 32);
  const is = (n: string | number | undefined) => { const a = typeof n === 'string' ? sym(n) : n; return a !== undefined && ((cb2 ^ a) & ~1) === 0; };
  const bag = rom.emu.read(pick, 16) !== 0 || is(run);
  if (!bag && !romBag) return;
  if (romBag === 'free') { if (!bag) romBag = null; return; }
  if (bag) romBag = 'bag';
  else if (romBag === 'bag') romBag = is('CB2_SetUpReshowBattleScreenAfterMenu2') || is('ReshowBattleScreenAfterMenu') || is(battleCb) ? 'reshow' : null;
  else if (is(battleCb) && !romFading()) romBag = null;
  bagFrames = romBag ? bagFrames + 1 : 0;
  if (bagFrames > BAG_HOLD) romBag = 'free';
}
function romFading(): boolean {
  const at = romTables.sym('gPaletteFade');
  return !!rom && at !== undefined && fadeOf(rom.emu.read(at + FADE_Y_WORD, 16), rom.emu.read(at + FADE_COLOR_WORD, 16)).active;
}
function seeFrame(): void {
  const up = !!rom && battleEl.classList.contains('on');
  const keyed = up && rom!.seeThrough(seeThrough()) && rom!.picture(keyImage.data);
  // USE in the page's bag is the ROM's own BAG doing it (br_bag.h): its screen, and the
  // battle's redraw after it, have no key and showed bare -- black, the bag, a blue fade
  // (HBR-110). The battle's last picture stays up over them (trackBag).
  if (up && seeing && (romBag === 'bag' || romBag === 'reshow')) return;
  if (keyed) {
    keyPicture(keyImage.data);
    keyCanvas.getContext('2d')?.putImageData(keyImage, 0, 0);
  } else if (rom && !up) rom.seeThrough(false);
  if (keyed !== seeing) { seeing = keyed; battleEl.classList.toggle('see', keyed); }
  battleEl.classList.toggle('screen', up && !battle);
}

/** Every few seconds, between battles: my team as it stands, told to the room when it
 *  changes, so the results screen can show the champion's (the live game's PARTY). */
let teamAsking = false;
let teamSent = '';
function teamFrame(): void {
  if (frame % 300 !== 150 || battle || swapping || isOut) return;
  tellTeam();
}

function sendTeam(mons: FameMon[]): void {
  const text = JSON.stringify(mons);
  if (text === teamSent) return;
  teamSent = text;
  link.team(mons);
}

/** My team to the room now, if it changed since I last told it. */
function tellTeam(): void {
  if (teamAsking || !rom) return;
  teamAsking = true;
  const l = link;
  void rom.fameTeam().then((mons) => { if (l === link) sendTeam(mons); }).catch(() => undefined).finally(() => { teamAsking = false; });
}

/** The CENTER's nurse, as the match has her (pkmn_center_nurse.inc): one question, and
 *  closed once the fog is on the town. */
async function nurse(): Promise<void> {
  if (!rom || isOut || battle || swapping || asking) return;
  if (inFogNow()) { say('The fog is here. This CENTER is closed.'); return; }
  const c = await ask('HEAL your party?', [['YES', 'yes'], ['NO', '']]);
  if (c !== 'yes' || isOut || !rom) { say('Good luck.'); return; }
  await rom.heal();
  say('Done. Your POKéMON are fully healed.');
}

/** An event's trader (br_event.c): his offer, and if yes, the party menu on the ROM's
 *  screen to pick which one he gets. He keeps it and offers it next. */
async function trade(n: number, species: number): Promise<void> {
  const l = link;
  let given = 0;
  try {
    if (!rom || isOut || battle || swapping) return;
    if (swapping) rom.leave();
    asking?.done('');
    const name = speciesName(species);
    const c = await ask(`I'll trade you my ${name} for one of yours. Which one?`, [['CHOOSE', 'y'], ['NO, THANKS', '']]);
    // Somebody at home's goes through a trade's evolution on the way over (br_loot.c's
    // BrLoot_HomeTrade); an event's trader's does not (br_event.c's Swap).
    const got = n >= HOME_N ? tradedInto(species) : species;
    if (c !== 'y' || !rom || isOut) return;
    swapping = true;
    held.clear();
    try {
      given = await rom.trade(got, () => battleEl.classList.add('on'));
    } finally {
      swapping = false;
      battleEl.classList.remove('on');
      held.clear();
      pressed.clear();
      calmUntil = frame + 30;
    }
    if (given) say(got === species ? `Traded for ${name}!` : `Traded for ${name}! It evolved into ${speciesName(got)}!`);
  } finally {
    if (link === l) l.traded(n, given);
  }
}

/** Somebody at home with a Pokémon to give (br_balls.c): taken across on the ROM's team
 *  screen, as a dropped bag's team is; taken, he is gone for everybody. */
async function gift(n: number, species: number): Promise<void> {
  const l = link;
  let taken = 0;
  try {
    if (!rom || isOut || battle || swapping) return;
    asking?.done('');
    const name = speciesName(species);
    const c = await ask(`Will you look after my ${name} for me?`, [['YES', 'y'], ['NO, THANKS', '']]);
    if (c !== 'y' || !rom || isOut) return;
    swapping = true;
    held.clear();
    try {
      const left = await rom.team([{ species, level: rungForPhase(link.room.ring().phase + 1) }], 'GIFT', () => battleEl.classList.add('on'));
      if (!left.length) taken = species;
    } finally {
      swapping = false;
      battleEl.classList.remove('on');
      held.clear();
      pressed.clear();
      calmUntil = frame + 30;
    }
    // The team screen takes it across as somebody else's, so a trade evolution goes off.
    if (taken) say(`Took the ${speciesName(tradedInto(species))}!`);
  } finally {
    if (link === l) l.traded(n, taken);
  }
}

/** A MART's clerk (pokemart.inc): the shelf at this rung, or the LILYCOVE DEPARTMENT
 *  STORE's, priced as a match prices it; a row, how many, and into the bag the ROM's own
 *  way. Closed in the fog, as the CENTER is. */
async function mart(map: string): Promise<void> {
  if (!rom || !art || isOut || battle || swapping || asking) return;
  const clerk = CLERKS.find((c) => c.map === map);
  if (!clerk) return;
  if (inFogNow()) { say('The fog is here. This MART is closed.'); return; }
  const a = art;
  const name = (id: number) => a.itemName(id) || `item ${id}`;
  // shop.c's way: the shelf with the money box and what the picked item is, how many on
  // the roller, the price asked YES/NO, and back to the shelf.
  let pick = 0;
  for (;;) {
    if (!rom || isOut || battle) return;
    const money = await rom.money();
    const items = shelf(clerk, link.room.ring().phase);
    const prices = items.map((id) => priceOf(id, a.itemPrice(id)));
    const c = await ask('', [...items.map((id): [string, string] => [name(id), String(id)]), ['CANCEL', '']], false, {
      pick: Math.max(0, Math.min(pick, items.length)),
      shelf: { money, prices, words: (i) => (i < items.length ? a.itemDescription(items[i]) : ['Quit shopping.']) },
    });
    if (!c || !rom || isOut || battle) { say('Please come again!'); return; }
    const id = Number(c), each = priceOf(id, a.itemPrice(id));
    pick = items.indexOf(id);
    if (each > money) { say("You don't have enough money."); continue; }
    const inBag = (await rom.spill()).items.find((r) => r.id === id)?.n ?? 0;
    const max = Math.max(1, Math.min(99, Math.floor(money / each), 999 - inBag));
    const n = Number(await ask(`${name(id)}? Certainly. How many would you like?`, [], false, { roller: { n: 1, max, each, inBag, money } }));
    if (!n || !rom) continue;
    if (await ask(`${name(id)}, and you want ${n}. That will be ¥${n * each}. Okay?`, [['YES', 'y'], ['NO', '']]) !== 'y' || !rom) continue;
    const took = await rom.buy(id, n, each);
    say(took ? 'Here you go! Thank you very much.' : 'You have no more room for items.');
  }
}

const CAUGHT = 7;
const OUTCOME = ['', 'won', 'lost', 'drew', 'ran', 'teleported', 'it fled', 'caught it', 'out of balls', 'forfeited'];
let lastResult = '';

function endBattle(r: Fought | null): void {
  battleEl.classList.remove('on');
  // A fight with a trainer that never got going, or was run from (a forfeit): we keep
  // apart a while, as the match's fleer does, or the two would engage again at once.
  const duel = !!battle?.foe && !battle.foe.bot;
  // A fight that ran over into a new round was the old round's: it neither beats a bot
  // nor puts anybody out of this one (the new round's fresh team is already on its way).
  // Another round, or another match altogether (each one's rounds count from 0).
  const stale = !!battle && (battle.link !== link || battle.round !== link.room.results.round);
  const boss = battle?.boss;
  // My team as the fight left it, to the room before the fight's end: a last battle that
  // wins the match shows on everybody's results as it ended (review of batch 3).
  const after = rom?.teamNow();
  if (after && !stale) sendTeam(after);
  (battle?.link ?? link).end(duel && (!r?.ok || [4, 9].includes(r.outcome & 0x7f)), !stale && (!!battle?.foe?.bot || boss !== undefined) && !!r?.ok && r.outcome === 1);
  if (!stale && boss !== undefined && r?.ok && r.outcome === 1) say(`You beat ${LEADERS[boss].name}! Took their TM and ¥1000.`);
  const wild = battle && !battle.foe && boss === undefined;
  const by = battle?.foe?.id;
  battle = null;
  tellTeam();
  held.clear();
  pressed.clear();
  // A held A from the battle's last text must not walk straight into another one.
  calmUntil = frame + 30;
  if (r && !r.ok) lastResult = 'last battle: the ROM did not start it';
  else if (r) lastResult = `last battle: ${wild ? `wild #${r.species} Lv${r.level}, ` : ''}${OUTCOME[r.outcome] ?? r.outcome}`;
  // A whiteout is the end of a trainer's match (Kanto's rules, DESIGN.md §10). So is a
  // team with nobody standing whatever the battle called its end (the fog's KO in a
  // battle): not out until the next fog bite found it, it was a minute late (Cam, 10-29).
  const fainted = !!after?.length && after.every((m) => !m.hp);
  if (!stale && r?.ok && (r.outcome === 2 || r.outcome === 3 || fainted)) goOut('', by, !!wild);
}

/** How long a trainer the room says is no longer fighting me may go quiet before the
 *  fight is mine: their page lost the battle engine, or ended it some other way. */
const FOE_QUIET_MS = 10_000;

/** The trainer I am fighting left the room (closed the tab, or went out elsewhere), or
 *  stopped fighting me and went quiet: the fight is mine, as in a match (BrNetlink_PeerOut). */
function foeFrame(): void {
  const foe = battle?.foe;
  if (!foe || foe.bot || battle!.foeGone) return;
  const now = link.room.actor(foe.id);
  const quiet = performance.now() - (battle!.heardAt ?? battle!.shownAt) > FOE_QUIET_MS;
  if (now && ((now.battling && now.foe === link.me) || !quiet)) return;
  battle!.foeGone = true;
  rom?.foeOut();
}

// ---- the fog (room.ts's ring) ----------------------------------------------------------

let isOut = false;
let fogTimer = 0;
let lastPhase = -1;
/** The room's events I have told of. */
let toldEvents = 0;
const NAMES = (encounterData as { names: Record<string, string> }).names;
const speciesName = (id: number) => NAMES[id] ?? 'POKéMON';
let wasInFog = false;
/** br_ring.h: BR_FOG_TICK_FRAMES, a bite every four seconds. */
const FOG_TICK = 240;

/** Which way is out of the fog, as arrows ('' inside, or with nowhere to go). */
function safeWay(): string {
  const me = link.room.actor(link.me);
  return me && ringMap ? ringMap.way(me.m.spot) : '';
}

function inFogNow(): boolean {
  const me = link.room.actor(link.me);
  return !!me && link.room.inFog(me.m.spot);
}

/** Out of the match: off the map, watching, and a way back in. */
function goOut(why: string, by?: number, wild?: boolean): void {
  if (isOut || !link.room.actor(link.me)) return;
  isOut = true;
  forget();
  // Nothing more goes into a trainer who is out: what was on its way stays on the ground.
  for (const g of toGive.splice(0)) link.drop(g.key);
  // What I carried lies where I fell (POK-232), once what was already going in is in.
  if (rom) rom.spill().then((bag) => link.out(bag, by, wild), () => link.out(undefined, by, wild));
  else link.out(undefined, by, wild);
  // A battle's loss said itself (the ROM's whiteout); the fog's or the Safari's says why.
  if (why) say(why);
  watchOn(by);
}

/** Out, or benched: straight to following somebody else, as live (HBR-106, Cam's pick),
 *  with no card to dismiss. Who beat me, if they are still in it; else whoever is nearest
 *  the camera. */
function watchOn(by?: number): void {
  if (!spectating) toggleSpectate();
  const others = actors().filter((a) => a.id !== link.me);
  const near = (a: Actor) => { const p = pixelOf(a); return Math.hypot(p.x - cam.x, p.y - cam.y); };
  const next = others.find((a) => a.id === by) ?? others.sort((p, q) => near(p) - near(q))[0];
  if (next) { follow = next.id; if (zoom < 1) zoom = fitZoom(); }
}

// ---- rounds (room.ts's results) --------------------------------------------------------

const winEl = document.getElementById('win')!;
document.getElementById('win-ok')!.addEventListener('click', () => {
  winEl.classList.remove('on');
  // PLAY AGAIN: the room, for its next START.
  if (!matchOn && lobby) { if (room) lobby.roomIs(room); else lobby.backToRoom(); }
});
/** On the bench: came in after the fog closed on this round. */
let waiting = false;
let seenRound = -1;
let shownWin = false;
/** The ROM was told this round's crown in the middle of a fight (rom.wonMatch). */
let wonMidFight = false;

/** Once a frame: a new round puts me back at the truck with a fresh team; the bench says
 *  so; the last one standing is announced, with how everybody else went out. */
function roundFrame(): void {
  const res = link.room.results;
  const here = !!link.room.actor(link.me);
  if (res.round !== seenRound) {
    const first = seenRound < 0;
    seenRound = res.round;
    shownWin = wonMidFight = false;
    // A parade still running ends with its round: the field is the new round's.
    if (romUp && !battle) rom?.leave();
    winEl.classList.remove('on');
    if (!first && here) {
      if (isOut || waiting) {
        isOut = waiting = false;
        if (spectating) toggleSpectate();
      }
      follow = link.me;
      wasInFog = false;
      // Everybody starts again: the team the game began with (after any battle still
      // finishing from the round before).
      void rom?.fresh();
      say('A new round! Back at the truck.');
    }
  }
  if (!here && !isOut && !waiting && link.room.bench.some((b) => b.id === link.me)) {
    waiting = true;
    watchOn();
  }
  // Crowned mid-fight (the fog took the last of them while I fought a wild one, a bot, a
  // boss): the ROM leaves the fight at its next choice, "You won the match!", and the
  // crown waits for the field. The panel opened over a fight that went on (audit, 10-30).
  if (res.winner === link.me && battle && !(battle.foe && !battle.foe.bot) && !wonMidFight) { wonMidFight = true; rom?.wonMatch(); }
  if (res.winner && !shownWin && !(res.winner === link.me && battle)) {
    shownWin = true;
    wonMidFight = false;
    record(res.round);
    // Mine: the Hall of Fame first, as the live winner's ROM runs it, then the standings.
    // The parade outlasts AFTER_WIN, so the next round may have begun: these standings, kept.
    if (res.winner === link.me && rom && !battle) {
      const kept = structuredClone(res), bots = botIds(), during = link;
      // Not over the match's own end (PLAY AGAIN), nor into another match.
      void parade().finally(() => { if (matchOn && link === during && !endingShown) standings(false, kept, bots); });
    }
    else standings(false);
  }
  // A match of the page's own, in a lobby (QUICK PLAY with no relay): over when one is
  // left, with nobody to say so but the room itself. Out, I watch the rest, as live (HBR-96).
  if (lobby && !link.online && matchOn && !endingAt && over(link.room)) matchOver();
  // The relay said the match is over: once the frames that ended it have played here (or
  // a moment has passed), the standings and PLAY AGAIN.
  if (endingAt && (over(link.room) || performance.now() - endingAt > 1500)) {
    endingAt = 0;
    record(res.round);
    endingShown = true;
    standings(true);
  }
}

/** The round I played, into my career on this device (career.ts, the live game's own):
 *  played, won, best placing. Once a round; not for a round I only watched. */
let recordedRound = -1;
function record(round: number): void {
  const res = link.room.results;
  // ?solo is practice, not a match: it stays out of the career. Offline QUICK PLAY (in
  // the lobby) is a match, and counts, as live (session.ts).
  if ((!link.online && !lobby) || recordedRound === round || !res.entrants.some(([id]) => id === link.me)) return;
  recordedRound = round;
  const i = res.fallen.findIndex((f) => f.id === link.me);
  // Placed by when I went out: the last out is second; never out, and nobody won, a tie for first.
  const placement = res.winner === link.me ? 1 : i >= 0 ? res.entrants.length - i : res.winner ? 2 : 1;
  const now = rom?.tally() ?? null;
  lastRound = tallySince(tallyFrom, now, myStepsN);
  recordMatch(placement, localStorage, lastRound);
  tallyFrom = now;
  myStepsN = 0;
}

/** The ROM's move table, for MY STATS' favourite move. */
let romTables: MoveTables = { bytes: new Uint8Array(0), sym: () => undefined };

/** What the last round I played added to MY STATS, for its results. */
let lastRound: ReturnType<typeof tallySince> | null = null;

/** MY STATS for the round I am in: the hidden ROM's tally as it began, and my steps. */
let tallyFrom: MatchTally | null = null;
let myStepsN = 0;
let mySpotWas = '';
function stepsFrame(): void {
  const s = link.mine()?.m.spot;
  const k = s ? `${s.map}:${s.x}:${s.y}` : '';
  if (k && mySpotWas && k !== mySpotWas) myStepsN++;
  mySpotWas = k;
}

/** A screen of the ROM's own the page shows (the Hall of Fame, a TM's party screen): it
 *  has the pad until it is over. */
let romUp = false;
/** The match's end standings are up (PLAY AGAIN): nothing puts the round's back over them. */
let endingShown = false;
/** The Hall of Fame: the ROM has the screen until it is over. */
async function parade(): Promise<void> {
  if (!rom) return;
  romUp = true;
  try { await rom.fame(() => battleEl.classList.add('on')); } catch (e) { console.warn('spike fame failed', e); }
  romUp = false;
  battleEl.classList.remove('on');
}

/** The last one standing (or MATCH OVER, with nobody), and how everybody else went out,
 *  the last out first. `over`: the match has ended, and the button is PLAY AGAIN. */
const botIds = () => new Set(link.room.actors.filter((a) => a.bot).map((a) => a.id));
/** The match's end on the live game's results screen (ui/results.ts): my place of how
 *  many, how long I lasted, everybody's place, and what this round added to MY STATS. */
function results(res: Results, waited = 0): void {
  // The champion's team comes from their phone a moment after their last battle (a
  // bot's never does): a second or two for it, as the live game's PARTY.
  const coming = res.winner === link.me ? teamAsking : !!res.winner && !link.teams.has(res.winner) && !botIds().has(res.winner);
  if (coming && waited < 10) {
    setTimeout(() => results(res, waited + 1), 200);
    return;
  }
  const n = res.entrants.length;
  const place = new Map<number, number>();
  if (res.winner) place.set(res.winner, 1);
  // Still standing with nobody crowned (a draw): first, together.
  for (const [id] of res.entrants) if (!res.winner && !res.fallen.some((f) => f.id === id)) place.set(id, 1);
  res.fallen.forEach((f, i) => place.set(f.id, n - i));
  const nameOf = (id: number) => res.entrants.find(([e]) => e === id)?.[1] ?? 'TRAINER';
  const mine = res.fallen.find((f) => f.id === link.me);
  const end = mine?.at ?? res.wonAt ?? link.room.tick;
  const survived = Math.max(0, Math.round((end - link.room.epoch) / 60));
  const placed = [...place].map(([seat, placement]) => ({ seat, placement })).sort((p, q) => p.placement - q.placement);
  const t = lastRound;
  const beaten = (id: number) => res.fallen.filter((f) => f.by && f.by === nameOf(id)).length;
  lobby!.results({
    view: resultsView({ placement: place.get(link.me), survived, winner: res.winner || undefined, ended: true }, n, link.me, nameOf),
    fame: fameOf(res.winner || undefined, link.me, res.winner ? link.teams.get(res.winner) : undefined, nameOf, speciesName, (id) => moveInfo(romTables, id)?.name),
    standings: standingsOf(placed, link.me, nameOf),
    record: [
      { label: 'BEATEN', value: String(beaten(link.me)) },
      ...(t ? tallyLines({ won: t.won, caught: t.caught, steps: t.steps, items: t.items, mon: favourite(t.mons), move: favourite(t.moves) }, { species: speciesName, move: (id) => moveInfo(romTables, id)?.name }) : []),
    ],
    // The CHAMPION page, a bot's too, as live (HBR-96).
    champion: res.winner && res.winner !== link.me ? { name: nameOf(res.winner), lines: [{ label: 'BEATEN', value: String(beaten(res.winner)) }] } : undefined,
  }, () => { worldSock?.leave(); room = null; unlink(); lobby!.menu(); });
}

function standings(done: boolean, res = link.room.results, bots = botIds()): void {
  // A room's match is over: the live game's results, over the world.
  if (done && lobby && res.entrants.some(([id]) => id === link.me)) { results(res); return; }
  const name = res.entrants.find(([id]) => id === res.winner)?.[1] ?? 'TRAINER';
  document.getElementById('win-title')!.textContent = !res.winner ? 'MATCH OVER' : res.winner === link.me ? 'YOU WIN!' : `${name} WINS`;
  const list = document.getElementById('win-list')!;
  list.replaceChildren();
  const row = (id: number, text: string) => {
    const li = document.createElement('li');
    li.textContent = text;
    if (id === link.me) li.className = 'me';
    list.append(li);
  };
  if (res.winner) row(res.winner, `${name}, last one standing`);
  else {
    // Trainers by name; the bots still wandering, as a count.
    let standing = 0;
    for (const [id, who] of res.entrants) {
      if (res.fallen.some((f) => f.id === id)) continue;
      if (bots.has(id)) standing++;
      else row(id, `${who}, still standing`);
    }
    // The bots go last: the trainers are who the standings are for.
    for (const f of [...res.fallen].reverse()) {
      if (!f.bot) row(f.id, `${f.name}, ${f.left ? 'left' : f.wild ? 'beaten by a wild POKéMON' : f.by ? `beaten by ${f.by}` : 'out in the fog'}`);
    }
    if (standing) row(0, `${standing} bot trainers still standing`);
    document.getElementById('win-ok')!.textContent = done && lobby ? 'PLAY AGAIN' : 'OK';
    winEl.classList.add('on');
    return;
  }
  // Trainers by name, last out first; the bots they and the fog beat, as a count.
  for (const f of [...res.fallen].reverse()) {
    if (!f.bot) row(f.id, `${f.name}, ${f.left ? 'left' : f.wild ? 'beaten by a wild POKéMON' : f.by ? `beaten by ${f.by}` : 'out in the fog'}`);
  }
  const out = res.fallen.filter((f) => f.bot).length;
  if (out) row(0, `${out} bot trainers beaten`);
  document.getElementById('win-ok')!.textContent = done && lobby ? 'PLAY AGAIN' : 'OK';
  winEl.classList.add('on');
}

// ---- a match, from the room's START to its end (lobby.ts) -----------------------------

let lobby: Lobby | null = null;
/** The room as the relay last said it is. */
let room: RoomInfo | null = null;
/** A match of mine is on (I am in it, or watching it). */
let matchOn = false;

// A reload within a minute comes back as the same trainer with the same team (Cam,
// 2026-10-20): the relay holds the trainer for AWAY_MS, the page keeps what lets it back
// in (the room, its id, its key) and the ROM's own (party, bag, Pokédex), every few
// seconds. A reload mid-battle is a forfeit: the relay does not hold a battling trainer.
const AGAIN = 'spikeB.again';
const AGAIN_ROM = 'spikeB.againRom';
const AGAIN_MS = 60_000;
interface Token { code: string; id: number; key: string; at: number }
function token(): Token | null {
  try {
    const t = JSON.parse(localStorage.getItem(AGAIN) ?? 'null') as Token | null;
    return t && Date.now() - t.at < AGAIN_MS ? t : null;
  } catch { return null; }
}
/** A match a reload left more than AGAIN_MS ago, still recent enough to be on: its room. */
function lateCode(): string | null {
  try {
    const t = JSON.parse(localStorage.getItem(AGAIN) ?? 'null') as Token | null;
    return t && Date.now() - t.at < 30 * 60_000 ? t.code : null;
  } catch { return null; }
}
function forget(): void {
  try { localStorage.removeItem(AGAIN); localStorage.removeItem(AGAIN_ROM); } catch { /* private window */ }
}
/** The team a reload is bringing back, until the ROM has booted to take it. */
let comingBack: string | null = null;
let savedAt = 0;
/** The Safari opening (room.ts SAFARI) ends as the match's does (br_match.c's
 *  BrMatch_SafariOver): at the clock, or sooner for whoever threw their last ROYALe BALL.
 *  Caught nothing: out at the buzzer. Otherwise the fly map, "Drop where?", and the room
 *  drops me where I chose. */
let dropRound = -1;
function safariFrame(ring: Ring): void {
  const me = link.room.actor(link.me);
  if (!me || isOut || !rom || dropRound === ring.round || !me.m.spot.map.startsWith(SAFARI)) return;
  if (ring.safari && rom.safariBalls() > 0) return;
  // The battle, the menu or the question on screen first: the map comes up after it.
  if (battle || swapping) return;
  asking?.done('');
  dropRound = ring.round;
  void flyDrop();
}

async function flyDrop(): Promise<void> {
  const r = rom, me = link.room.actor(link.me);
  if (!r || !me || !ringMap) return;
  let section = 0;
  // The field is held from here: no walk into grass or a trainer while the map comes up.
  swapping = true;
  held.clear();
  try {
    if (!(await r.spill()).mons.length) { swapping = false; goOut('You caught nothing in the SAFARI ZONE.'); return; }
    section = await r.drop(ringMap.look(me.m.spot), () => { if (swapping) battleEl.classList.add('on'); });
  } finally {
    swapping = false;
    battleEl.classList.remove('on');
    held.clear();
    pressed.clear();
    calmUntil = frame + 30;
  }
  // The host deals a cell inside the section (one of its maps here); no section, anywhere.
  const out = (m: string) => link.room.places.has(m) && !m.startsWith(SAFARI);
  const inIt = section ? ringMap.mapsIn(section).filter(out) : [];
  const maps = inIt.length ? inIt : [...link.room.places.keys()].filter(out);
  if (maps.length) link.pick(maps[Math.floor(Math.random() * maps.length)]);
}

/** The gym leaders that fell, as the ticker says it (bosses.ts's line). */
let toldGyms = 0;
function gymFrame(): void {
  const g = link.room.gyms;
  if (toldGyms > g.length) toldGyms = 0;
  for (const [n, who] of g.slice(toldGyms)) {
    const line = who !== link.room.actor(link.me)?.name ? felled(0, who, LEADERS[n].name) : null;
    if (line) tick(line.text);
  }
  toldGyms = g.length;
}

/** Every few seconds of a match: still here, and the team as it is. */
function remember(): void {
  if (!link?.online || !link.key || !room || !matchOn || isOut || !link.room.actor(link.me)) return;
  const now = Date.now();
  if (now - savedAt < 5000) return;
  savedAt = now;
  try { localStorage.setItem(AGAIN, JSON.stringify({ code: room.code, id: link.me, key: link.key, at: now })); } catch { return; }
  if (rom && !battle && !asking && !swapping && !comingBack) {
    void rom.save().then((t) => { try { localStorage.setItem(AGAIN_ROM, t); } catch { /* full */ } });
  }
}
/** The relay said it is over; the standings wait for its last frames here. */
let endingAt = 0;
let looping = false;

/** A match starts for me (or I come into one under way): its link, and the page as a
 *  match begins it -- a fresh team, nobody out, the camera on my trainer. */
/** The socket dropped and is being tried again; `resuming`: back with the match's own
 *  trainer, so the next `hello` is the same match carrying on, not a new one. */
let reconnecting = false;
let resuming = false;
function resumeMatch(l: WorldLink): void {
  const was = link;
  link = l;
  resuming = reconnecting = false;
  ringMap = art && RingMap.SYMBOLS.every((n) => Number.isFinite(art!.sym(n))) ? new RingMap(l.room, art) : null;
  // A battle fought through the drop ends on the new link (not as a stale one).
  if (battle && battle.link === was) battle.link = l;
  l.onBt = was.onBt;
  if (follow === was.me) follow = l.me;
  tick('Back in the match.');
  if (lobby?.sheetUp) lobby.stage.redraw();
}

function startMatch(l: WorldLink): void {
  // The relay took the same trainer back (its id): the match carries on. Anything else
  // (the hold gone, in again as a watcher) is a match come into afresh.
  if (resuming && matchOn && l.me === link.me) { resumeMatch(l); return; }
  resuming = reconnecting = false;
  link = l;
  // The room's battle pace (the host's TEXT and ANIM); ?solo keeps the parked FAST, none.
  if (room) rom?.pace(room.set.textSpeed, room.set.animations);
  // A patch whose symbols predate the MAP's (gRegionMapEntries, gPlttBufferFaded) has none.
  ringMap = art && RingMap.SYMBOLS.every((n) => Number.isFinite(art!.sym(n))) ? new RingMap(l.room, art) : null;
  matchOn = true;
  endingAt = 0;
  endingShown = false;
  if (romUp && !battle) rom?.leave();
  lobby?.hide();
  isOut = waiting = shownWin = false;
  // Every match's rounds count from 0: what was told or recorded of the last one is not.
  seenRound = lastPhase = recordedRound = dropRound = hudRound = dugRound = toldOpening = -1;
  teamSent = '';
  tallyFrom = rom?.tally() ?? null;
  myStepsN = 0;
  mySpotWas = '';
  ticks.length = 0;
  toldEvents = 0;
  toldGyms = l.room.gyms.length;
  wasInFog = false;
  toGive.length = 0;
  winEl.classList.remove('on');
  if (spectating) toggleSpectate();
  follow = link.me;
  savedAt = 0;
  const back = token();
  comingBack = null;
  if (back && l.online && back.id === l.me) {
    try { comingBack = localStorage.getItem(AGAIN_ROM); } catch { comingBack = null; }
  } else forget();
  if (rom) { rom.reseed(l.room.seed); void (comingBack ? takeBack(rom) : rom.fresh()); }
  if (!looping) {
    looping = true;
    resize();
    requestAnimationFrame((t) => { last = t; loop(t); });
  }
}

/** The team the reload left with, into the booted ROM. */
async function takeBack(r: RomBattles): Promise<void> {
  const t = comingBack;
  comingBack = null;
  if (!t || !(await r.load(t))) await r.fresh();
  else say('Welcome back!');
}

/** The relay's socket, from the menu on (null in ?solo). */
let worldSock: WorldSocket | null = null;

/** LEAVE: the relay takes me out (the standings say "left"), and the menu is back. */
function leaveMatch(): void {
  if (!lobby) return;
  worldSock?.leave();
  // Not matchOver: no standings for a match I walked out of.
  forget();
  matchOn = false;
  room = null;
  isOut = waiting = false;
  if (spectating) toggleSpectate();
  winEl.classList.remove('on');
  lobby.menu('You left the match.');
}

/** The live match's sheet (ui/screens.ts sheetScreen) over the game: the room's line,
 *  the strip, the legendary's chip, everybody in it as their sprite (a tap opens their
 *  card: SPECTATE for somebody out), who I watch once out, LEAVE, the settings. */
let sheetCard: number | null = null;
let sheetLeave = false;
const skinOf = new Map<number, number>();
/** A phone's D-pad and A/B, moved, faded or hidden from the sheet (the live game's). */
const padPrefs = new PadPrefsControl({
  root: document.documentElement,
  body: document.body,
  dpad: document.getElementById('dpad-surface')!,
  ab: document.querySelector<HTMLElement>('#pad .ab')!,
  bar: document.getElementById('pad-edit')!,
  scale: () => 2,
});
const touchPad = matchMedia('(pointer: coarse)').matches;
const sheetBtn = document.getElementById('sheet')!;
sheetBtn.addEventListener('click', () => openSheet());
function openSheet(): void {
  if (!lobby || !matchOn || lobby.shown) return;
  held.clear();
  sheetCard = null;
  sheetLeave = false;
  lobby.sheetOver(sheetModel, () => { held.clear(); pressed.clear(); calmUntil = frame + 30; });
  // The sheet's line and seats move with the match: redrawn while it is up.
  const tick = setInterval(() => { if (lobby?.sheetUp) lobby.stage.redraw(); else clearInterval(tick); }, 500);
}
function sheetModel(): Omit<SheetModel, 'onClose' | 'onFeedback'> {
  const res = link.room.results;
  for (const a of link.room.actors) skinOf.set(a.id, a.skin);
  const nameOf = (id: number) => res.entrants.find(([e]) => e === id)?.[1] ?? link.room.actor(id)?.name ?? 'TRAINER';
  const ids = res.entrants.length ? res.entrants.map(([id]) => id) : link.room.actors.map((a) => a.id);
  const fell = new Set(res.fallen.map((f) => f.id));
  const out = isOut || waiting;
  const seats: RoomSeat[] = ids.map((id) => ({ seat: id, name: nameOf(id), skin: skinOf.get(id) ?? 0, isMe: id === link.me, spectating: false, alive: !fell.has(id) && !!link.room.actor(id) }));
  const ring = link.room.ring();
  const secs = Math.ceil(ring.left / 60);
  const left = seats.filter((p) => p.alive).length;
  const strip = `${ring.safari ? 'SAFARI' : (ringMap?.place(ring) || 'HOENN').toUpperCase()}${left ? ` · ${left} left` : ''} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const card = sheetCard === null ? null : (() => {
    const seat = seats.find((p) => p.seat === sheetCard);
    if (!seat) return null;
    const m = room?.members.find((x) => x.id === seat.seat);
    const placed = ids.length - res.fallen.findIndex((f) => f.id === seat.seat);
    return {
      seat: seat.seat,
      skin: seat.skin,
      lines: [
        { label: 'NAME', value: seat.name },
        ...(m?.rec ? cardFields({ name: m.name, skin: m.skin, wins: m.rec.wins, played: m.rec.played, best: m.rec.best }) : []),
        { label: 'NOW', value: seat.alive ? 'IN' : fell.has(seat.seat) ? `OUT (${ordinal(placed)})` : 'OUT' },
      ],
      canKick: false,
      canWatch: out && seat.alive && !seat.isMe,
    };
  })();
  return {
    look: 'overlay',
    status: reconnecting ? 'Reconnecting…' : room ? `Room ${room.code}` : 'SOLO VS BOTS',
    strip,
    chips: [legendChip()].filter((c): c is string => c !== null),
    match: res.round,
    note: '',
    seats,
    card,
    watch: out ? { name: follow && follow !== link.me ? nameOf(follow) : null } : null,
    canLeave: true,
    leaveAsk: sheetLeave,
    muted,
    remapping: remap.on,
    remapLine: remap.line,
    help: ['Arrows move  Z: A  X: B  M: MENU', 'R: this sheet  V: spectate  pads too'],
    version: versionLine,
    onSeat: (seat) => { sheetCard = seat; lobby?.stage.redraw(); },
    onKick: () => undefined,
    onCloseCard: () => { sheetCard = null; lobby?.stage.redraw(); },
    onWatch: (dir) => { watch.step(dir); lobby?.stage.redraw(); },
    onWatchSeat: (seat) => { follow = seat; if (zoom < 1) zoom = fitZoom(); sheetCard = null; lobby?.closeSheet(); },
    onStopWatch: () => { follow = 0; lobby?.stage.redraw(); },
    onLeave: () => { sheetLeave = true; lobby?.stage.redraw(); },
    onStay: () => { sheetLeave = false; lobby?.stage.redraw(); },
    onLeaveSure: () => { sheetLeave = false; leaveMatch(); },
    onMute: () => { soundBtn.click(); lobby?.stage.redraw(); },
    onRemap: () => { remapPad(); lobby?.stage.redraw(); },
    onResetPad: () => { resetPad(); lobby?.stage.redraw(); },
    onForget: () => { forgetRom(); },
    pad: touchPad ? {
      hidden: padPrefs.hidden,
      onMove: () => { lobby?.closeSheet(); padPrefs.edit(); },
      onToggle: () => { padPrefs.toggleHidden(); lobby?.stage.redraw(); },
    } : undefined,
  };
}
/** A phone's HUD and dock (the live game's ui/phonehud.ts) in place of the corner and the
 *  buttons: the sign of the place I stand in, the fog window (Safari or Fog, the clock,
 *  how many are left, which way is safe), and PARTY, MAP, START and the room under it. */
/** br_hud.h BR_HUD_FOG_FRAMES: how long the fog window flashes FOG! on going outside. */
const BR_HUD_FOG_FRAMES = 60;
let hudFogged = false;
let fogFlashTo = 0;
function wirePhoneHud(): void {
  const top = document.getElementById('phud')!;
  const dock = document.getElementById('pdock')!;
  const hud = new PhoneHud({
    top,
    dock,
    onParty: () => void runMenu('1'),
    onMap: () => void runMenu('13'),
    onStart: () => void openMenu(),
    onUse: () => { selectUntil = frame + 40; },
  });
  document.getElementById('hud-menu')!.addEventListener('click', () => openSheet());
  const scale = () => {
    const s = Math.min(2, Math.max(1, innerWidth / 250));
    document.documentElement.style.setProperty('--s', String(s));
    hud.setScale(s);
    msgBox.setScale(s);
  };
  addEventListener('resize', scale);
  scale();
  document.body.classList.add('phone-hud');
  setInterval(() => {
    // On the map. A trainer out has no dock (the watch strip is theirs), but keeps the
    // fog window for the one they watch, as live does: the clock and how many are left
    // (Cam, 2026-10-30). The sign's corner is the watch strip's, so it goes.
    const mine = link?.room.actor(link.me);
    const me = mine ?? (spectating && follow ? link?.room.actor(follow) : undefined);
    top.hidden = !me;
    dock.hidden = !mine;
    if (!me) { hud.hide(); return; }
    const ring = link.room.ring();
    const res = link.room.results;
    const fogged = link.room.inFog(me.m.spot);
    if (fogged && !hudFogged) fogFlashTo = frame + BR_HUD_FOG_FRAMES;
    hudFogged = fogged;
    const way = mine ? ringMap?.way(me.m.spot, ring) ?? '' : '';
    const section = link.room.maps.get(me.m.spot.map)?.section ?? '';
    const sign = signFor(section);
    hud.update({
      onField: !battle && !swapping && !romUp && !asking && (!spectating || !mine),
      place: mine ? sign.name : '',
      theme: sign.theme,
      clock: Math.ceil(ring.left / 60),
      left: res.entrants.length ? res.entrants.length - res.fallen.length : link.room.actors.length,
      eyes: watch.eyes,
      // FOG! for a second on stepping into it, then the clock again (br_hud.c FogPhase).
      flash: fogPhase(fogged ? Math.max(0, fogFlashTo - frame) : 0),
      ring: ring.safari ? null : ring.last ? 'Fog everywhere' : ringMap?.place(ring) ?? '',
      fogEverywhere: !!ring.last,
      safe: way ? `Safe ${way}` : null,
      ctx: { label: me.m.bike ? 'WALK' : 'BIKE', item: ITEM_MACH_BIKE, enabled: me.m.bike || !!link.room.stepFor(me).cycling?.(me.m.spot) },
      party: rom?.partyCount() ?? 0,
      moves: [],
    });
  }, 100);
}

/** A phone's battle menu (the live game's ui/battlemenu.ts): FIGHT, BAG, POKeMON, RUN
 *  and the moves as windows under the hidden ROM's picture, tapped rather than walked to
 *  with the D-pad; the live TouchLayer walks the ROM's cursor to what was tapped. */
/** The trainers' cards over the picture, GBA pixels: a card and a gap either side. */
const CARDS_ROOM = CARD_H + 8;
/** What the battle menu wants under the picture at its tallest (four moves, BACK, the hint). */
const MENU_ROOM = 2 * CELL_H + BACK_H + 48;
function wireBattleMenu(files: Awaited<ReturnType<typeof loadRom>>): void {
  const { emu } = files;
  const symbols = new (class extends Map<string, number> {
    get(n: string): number | undefined { const a = files.sym(n); return Number.isNaN(a) ? undefined : a; }
  })();
  const sym = (n: string) => symbols.get(n);
  const tables = { bytes: files.rom, sym };
  const touch = new TouchLayer({ emu, canvas: gbaCanvas, surface: gbaCanvas, symbols, rom: files.rom });
  touch.attach();
  const root = document.getElementById('battle-menu')!;
  const menu = new BattleMenu({
    root,
    rom: tables,
    choose: (which, slot, move) => touch.chooseBattle(which, slot, move),
    back: () => touch.tapKey('b'),
    onShown: (on) => document.body.classList.toggle('battle-menu', on),
    readBag: () => readBattleBag(emu, sym, tables),
    useItem: sym('gBrBag') !== undefined && sym('gBagPosition') !== undefined
      ? (pocket, item) => touch.chooseBattle(MENU_ACTION, 1, undefined, () => {
        emu.write(sym('gBagPosition')! + BAG_POSITION_POCKET, pocket, 8);
        emu.write(sym('gBrBag')!, item, 16);
      })
      : undefined,
  });
  const resize = () => {
    const box = gbaCanvas.getBoundingClientRect();
    if (!box.width) return;
    const s = box.width / 240;
    battleEl.style.setProperty('--s', String(s));
    menu.setScale(s);
    menu.setRoom((innerHeight - box.bottom - 8) / s);
  };
  addEventListener('resize', resize);
  // Both trainers' cards in a trainer battle, above the picture on a phone held upright
  // (the live game's ui/sides.ts: the picture, the name, the party's balls). The picture
  // moves down for them only when the glass has the room for them and the menu too.
  const flagsAt = sym('gBattleTypeFlags');
  const trainerFight = () => flagsAt !== undefined && (emu.read(flagsAt, 32) & (BATTLE_TYPE_TRAINER | BATTLE_TYPE_RECORDED)) === BATTLE_TYPE_TRAINER;
  const cards = () => {
    const s = gbaCanvas.getBoundingClientRect().width / 240;
    const fits = s > 0 && innerHeight / s >= CARDS_ROOM + 160 + MENU_ROOM;
    battleEl.classList.toggle('cards', fits && innerHeight > innerWidth && trainerFight());
  };
  const sidesEl = document.getElementById('sides')!;
  new SidesView(sidesEl, emu, sym, () => {
    const box = gbaCanvas.getBoundingClientRect();
    const s = box.width / 240;
    return s > 0 && battleEl.classList.contains('on')
      ? { scale: s, cols: innerWidth / s, rows: innerHeight / s, lcdCol: box.left / s, lcdRow: box.top / s }
      : { scale: 0, cols: 0, rows: 0, lcdCol: 0, lcdRow: 0 };
  }).attach();
  let noPad = false;
  let wasUp = false;
  const hudBase = sym('gBrHud');
  emu.onFrame(() => {
    const up = battleEl.classList.contains('on');
    if (up && !wasUp) { resize(); cards(); resize(); }
    else if (!up && wasUp) battleEl.classList.remove('cards');
    wasUp = up;
    // The battle's own FIGHT/BAG box comes off under the windows (br_battle.c
    // BrBattle_MenuBoxOff), as on a phone live; written each frame, as every battle
    // starts from the parked boot.
    if (hudBase !== undefined) emu.write(hudBase + HUD.OFF_NO_BATTLE_BOX, up ? 1 : 0, 8);
    menu.update(up ? readBattleView(emu, sym, tables, menu.wantsBag) : null);
    const off = up && battleWantsNoPad(emu, sym, tables);
    if (off !== noPad) document.body.classList.toggle('battle-no-pad', (noPad = off));
  });
}

/** FORGET ROM, asked first as the live sheet asks it: the ROM this browser keeps goes,
 *  and the page starts over (the game page asks for it again). */
/** Which ROM is in the tab (the sheet's last line, as live). */
let versionLine = 'spike B';
let romEmu: { forgetRom(): Promise<void>; stop(): void } | null = null;
function forgetRom(): void {
  const st = lobby!.stage;
  st.push(noticeScreen(() => ({
    title: 'FORGET ROM',
    lines: [{ text: 'Forget the ROM stored in this browser? You will pick it again to play.' }],
    buttons: [
      { label: 'FORGET', id: 'forget-yes', onPress: () => { void (async () => { await romEmu?.forgetRom(); romEmu?.stop(); location.reload(); })(); } },
      { label: 'BACK', id: 'forget-no', onPress: () => st.pop() },
    ],
    onBack: () => st.pop(),
  })));
}

/** The legendary's chip (match/legends.ts's words): where it stands, or whose team has
 *  it by the teams the phones told. */
function legendChip(): string | null {
  for (const e of [...link.room.events].reverse()) {
    if (!e.species) continue;
    if (link.room.spills.has(e.key)) return e.place ? `Legendary at ${e.place.toUpperCase()}` : 'Legendary on the map';
    for (const [id, mons] of link.teams) if (mons.some((m) => m.species === e.species)) return `${link.room.actor(id)?.name ?? 'Somebody'} has the legendary`;
  }
  return null;
}

function matchOver(): void {
  forget();
  matchOn = false;
  endingAt = performance.now();
}
document.getElementById('menu')!.addEventListener('click', () => { void openMenu(); });
document.getElementById('find')!.addEventListener('click', () => itemfinder());

// Sound (the live match's MUTE, its own key): the ROM's. In a battle, a menu or the
// parade it is that screen's; between them its field runs on hidden under ours and plays
// the song for where the trainer the camera follows stands (music.ts, br_music.h).
const MUTE_KEY = 'hbr:muted';
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* private window: on */ }
const soundBtn = document.getElementById('sound')!;
let heard = -1;
function soundFrame(): void {
  const v = muted ? 0 : 100;
  if (rom && v !== heard) { rom.emu.setVolume(v); heard = v; }
  rom?.music(cue.next(muted || !matchOn ? null : whereFollowed()));
}
const cue = new MusicCue();
/** Where the followed trainer stands for the song: through a door, the other side. */
function whereFollowed(): Where | null {
  const a = follow ? link.room.actor(follow) : undefined;
  if (!a) return null;
  const door = a.m.action?.kind === 'warp' && a.m.action.land ? a.m.action.land : null;
  const spot = door ?? a.m.spot;
  const m = placed.get(spot.map)?.m;
  if (!m) return null;
  return { group: m.group, num: m.num, x: spot.x, surf: !door && classAt(spot) === CLASS_WATER, bike: a.m.bike, door: !!door };
}
function paintSound(): void { soundBtn.textContent = `Sound: ${muted ? 'off' : 'on'}`; }
soundBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* not kept */ }
  paintSound();
});
paintSound();

// ---- Hoenn's hidden items and the ITEMFINDER (br_levels.c, Cam 2026-10-18) -----------

/** Every map's hidden items (tools/br/spike-hidden.py): still buried in a match, and each
 *  trainer can dig each one up once, as each ROM's own flag lets them. */
const HIDDEN = new Map((hiddenJson as [string, number, number, number][]).map(([m, x, y, item]) => [`${m}:${x}:${y}`, { map: m, x, y, item }]));
/** What I dug up this round. */
const dug = new Set<string>();
let dugRound = -1;
function digReady(): boolean {
  const me = link.mine();
  if (link.room.results.round !== dugRound) { dug.clear(); dugRound = link.room.results.round; }
  return !!me && !!rom && !isOut && !spectating && !battle && !swapping && !romUp && !asking && !intro() && !me.battling && !me.m.action;
}
/** A pressed at a buried item's cell: it is mine. */
function dig(): void {
  const me = link.mine();
  if (!me || !digReady() || frame < calmUntil) return;
  const d = ({ 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] } as Record<number, number[]>)[me.m.facing];
  const k = `${me.m.spot.map}:${me.m.spot.x + d[0]}:${me.m.spot.y + d[1]}`;
  const h = HIDDEN.get(k);
  if (!h || dug.has(k)) return;
  dug.add(k);
  toGive.push({ key: 0, item: h.item, hidden: k });
  giveNext();
}
/** The ITEMFINDER: the nearest buried item on this map within its reach (x 7, y 5, the
 *  screen Emerald's searches), as which way and how far; or no response. */
function itemfinder(): void {
  const me = link.mine();
  if (!me || !digReady()) return;
  let best: { x: number; y: number } | null = null;
  for (const h of HIDDEN.values()) {
    if (h.map !== me.m.spot.map || dug.has(`${h.map}:${h.x}:${h.y}`)) continue;
    const dx = h.x - me.m.spot.x, dy = h.y - me.m.spot.y;
    if (Math.abs(dx) > 7 || Math.abs(dy) > 5) continue;
    if (!best || Math.abs(dx) + Math.abs(dy) < Math.abs(best.x) + Math.abs(best.y)) best = { x: dx, y: dy };
  }
  if (!best) { say("Nope! There's no response."); return; }
  const n = Math.abs(best.x) + Math.abs(best.y);
  if (n <= 1) { say('The ITEMFINDER is shaking! It is right here: face it and press A.'); return; }
  const way = (best.y < 0 ? '↑' : best.y > 0 ? '↓' : '') + (best.x < 0 ? '←' : best.x > 0 ? '→' : '');
  say(`The ITEMFINDER responds! Something is buried ${way}, ${n} steps away.`);
}

// ---- the HUD (the live match's corner and ticker: br_hud.c, ticker.ts) -----------------

const cornerEl = document.getElementById('corner')!;
/** Lines waiting their turn, and when the one showing goes. */
const ticks: { text: string; alert: boolean }[] = [];
let tickUntil = 0;
/** Everybody's news, one line at a time (ticker.ts): outs, the ring, a gym, the win. */
function tick(text: string, alert = false): void {
  if (ticks.length < 6) ticks.push({ text, alert });
}
/** Outs that land together go out as one line (POK-324). */
let toldOuts = 0;
let outsSince = 0;
let hudRound = -1;
let toldOpening = -1;
let toldWin = false;
let cornerText = '';
function hudFrame(): void {
  const res = link.room.results;
  if (res.round !== hudRound) { hudRound = res.round; toldOuts = res.fallen.length; toldWin = !!res.winner; outsSince = 0; }
  const left = res.entrants.length - res.fallen.length;
  if (res.fallen.length > toldOuts) {
    const now = performance.now();
    if (!outsSince) outsSince = now;
    // The endgame's count is everything: each out at once.
    if (now - outsSince >= OUT_BATCH_MS || left <= 3 || res.winner) {
      const batch = res.fallen.slice(toldOuts);
      const lone = batch.length === 1 && batch[0].by ? batch[0].by : undefined;
      const line = outs(0, batch.map((f) => f.name), left, lone);
      if (line) tick(line.text);
      toldOuts = res.fallen.length;
      outsSince = 0;
    }
  }
  if (res.winner && !toldWin) {
    toldWin = true;
    const line = won(0, res.entrants.find(([id]) => id === res.winner)?.[1] ?? 'TRAINER');
    if (line) tick(line.text);
  }
  // The Safari's line as the round opens in it (ticker.ts's opening).
  const ringNow = link.room.ring();
  if (ringNow.safari && toldOpening !== ringNow.round) {
    toldOpening = ringNow.round;
    const line = opening(0, Math.ceil(ringNow.left / 60));
    if (line) tick(line.text);
  }
  // One line at a time, in the box my own messages use, and not over one of them.
  const now = performance.now();
  // A battle's picture has the top of the screen: the news waits for the field, as the
  // live match's ticker does (br_hud.c drops its windows off the overworld).
  if (battleEl.classList.contains('on')) {
    if (tickUntil) { tickUntil = 0; msgBox.hide(); }
  } else if (!sayUntil && now >= tickUntil) {
    const next = ticks.shift();
    if (next) {
      msgBox.show(next.text, next.alert);
      tickUntil = now + 3500;
    } else if (tickUntil) {
      tickUntil = 0;
      msgBox.hide();
    }
  }
  // The corner: how many are left, and the clock (or FOG! while it bites me).
  const ring = link.room.ring();
  const s = Math.ceil(ring.left / 60);
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const count = ring.safari ? 'SAFARI' : res.entrants.length ? `${left} LEFT` : `${link.room.actors.length} IN`;
  const fog = !isOut && inFogNow() && frame % 60 < 30;
  const text = `${count}\n${fog ? 'FOG!' : clock}`;
  if (text !== cornerText) {
    cornerText = text;
    cornerEl.textContent = text;
    cornerEl.classList.toggle('fog', fog);
  }
}

/** Once a frame: the ring's news, and the fog's bite while I stand in it. */
function fogFrame(): void {
  const ring = link.room.ring();
  if (ring.phase !== lastPhase) {
    // The ring phase is the level rung (br_levels.c): the host numbers phases from 1.
    const rung = rungForPhase(ring.phase + 1);
    // The ROM's lines for it (br_ring.c, br_levels.c): where it closes, then the level
    // every POKeMON is at now when the rung moved; the last phase, that it is everywhere.
    if (lastPhase >= 0 && ring.phase > 0) {
      if (ring.last) tick('The fog covers all of HOENN!', true);
      else {
        tick(`The fog closes in on ${(ringMap?.place(ring) || 'HOENN').toUpperCase()}`, true);
        if (rung > rungForPhase(lastPhase + 1)) tick(`All POKéMON are now Lv. ${rung}!`, true);
      }
    }
    // An event dropped with the ring (DESIGN §Events): the ticker says what and where.
    const evs = link.room.events;
    if (toldEvents > evs.length) toldEvents = 0;
    for (const e of evs.slice(toldEvents)) {
      const line = event(0, e.species ? ringMap?.placeOf(e.map) : e.place ?? ringMap?.placeOf(e.map), !!e.species);
      if (line) tick(line.text, line.kind === 'alert');
    }
    toldEvents = evs.length;
    lastPhase = ring.phase;
  }
  rom?.setPhase(ring.phase + 1);
  rom?.setSafari(!!ring.safari);
  safariFrame(ring);
  if (isOut || !rom) return;
  // The BAG screen is a menu: the fog bites on the field and in battle (BrRing_Tick).
  if (swapping) return;
  if (battle) {
    // A ring that closes on a trainer mid-battle reaches the battle at its next turn.
    if (inFogNow()) rom.fogNow();
    return;
  }
  const fog = inFogNow();
  if (fog && !wasInFog) { const way = safeWay(); say(`You are in the fog!${way ? ` Safe ${way}` : ''}`); fogTimer = FOG_TICK; }
  wasInFog = fog;
  if (!fog || --fogTimer > 0) return;
  fogTimer = FOG_TICK;
  void rom.bleed().then((alive) => { if (!alive) goOut('Your team fainted in the fog.'); });
}

/** The fog over everything outside the ring, the inside left clear: the ROM's own
 *  (WEATHER_FOG_HORIZONTAL, the live match's field) -- its 64x64 picture tiled with the
 *  world, drifting left a pixel every four frames (FogHorizontal_Main), blended as the
 *  GBA does at the coefficients it settles at, fog*12/16 + ground*8/16 (field.ts drawFog).
 *  A patch whose symbols do not name the picture yet gets a flat veil. */
let fogTile: HTMLCanvasElement | null | undefined;
const FOG_SIZE = 64;
function drawFog(x0: number, y0: number, x1: number, y1: number, home: Placed): void {
  const ring = link.room.ring();
  if (ring.r === Infinity) return;
  ctx.save();
  ctx.beginPath();
  // Inside, the fog is the fog at the door: all of it or none.
  if (!home.m.outdoor) {
    if (!link.room.inFog({ map: home.m.id, x: 0, y: 0 }, ring)) { ctx.restore(); return; }
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  } else {
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    if (ring.r >= 0) ctx.arc(ring.cx * TILE, ring.cy * TILE, Math.max(ring.r, 0.5) * TILE, 0, Math.PI * 2, true);
  }
  ctx.clip('evenodd');
  if (fogTile === undefined && art) fogTile = art.fog();
  if (!fogTile) {
    ctx.fillStyle = 'rgba(176, 160, 196, 0.5)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    return;
  }
  ctx.globalAlpha = 1 - FOG_EVB / 16;
  ctx.fillStyle = '#000';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = FOG_EVA / 16;
  const drift = Math.floor(frame / 4) % FOG_SIZE;
  const fx0 = Math.floor((x0 + drift) / FOG_SIZE) * FOG_SIZE - drift;
  const fy0 = Math.floor(y0 / FOG_SIZE) * FOG_SIZE;
  for (let y = fy0; y < y1; y += FOG_SIZE) for (let x = fx0; x < x1; x += FOG_SIZE) ctx.drawImage(fogTile, x, y);
  ctx.restore();
}

function fogLine(): string {
  const ring = link.room.ring();
  const s = Math.ceil(ring.left / 60);
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const way = safeWay();
  const where = inFogNow() ? ` · YOU ARE IN THE FOG${way ? ` · Safe ${way}` : ''}` : '';
  if (ring.safari) return `SAFARI ZONE · the drop in ${clock}`;
  if (ring.r === Infinity) return `fog in ${clock}${where}`;
  if (ring.last) return `FOG EVERYWHERE${where}`;
  return `fog phase ${ring.phase}, closes again in ${clock}${where}`;
}

// While the ROM has the screen, the pad is the ROM's.
const GBA_KEY: Record<string, GbaKey> = { up: 'up', down: 'down', left: 'left', right: 'right', a: 'a', b: 'b', start: 'start', select: 'select' };
// Enter is A on the field and START on the ROM's own screens (the swap's MOVE).
const romKey = (key: string): string | undefined => key === 'Enter' && (swapping || romUp) ? 'start' : KEYMAP[key];
addEventListener('keydown', (e) => {
  const k = romKey(e.key);
  if (k && asking) { if (!e.repeat) askKey(k); }
  else if ((battle || swapping || romUp) && rom && k) rom.press(GBA_KEY[k]);
});
addEventListener('keyup', (e) => { const k = romKey(e.key); if (rom && k) rom.release(GBA_KEY[k]); });
// ---- a controller (the live game's wireGamepad, the parts the world uses) -------------
// The live game's map for this device (hbr.padmap, its remap wizard's) and stick
// (hbr.padstick), else the standard layout: face bottom/left A, right/top B, START, the
// D-pad, the stick and a DirectInput hat. Polled on a timer, as the Gamepad API has no
// button events: a press is a change since the last poll, sent where a key would go.
const PAD_DEFAULT: Record<number, string> = { 0: 'a', 1: 'b', 2: 'b', 3: 'a', 8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const PAD_HAT: string[][] = [['up'], ['up', 'right'], ['right'], ['down', 'right'], ['down'], ['down', 'left'], ['left'], ['up', 'left']];
function padMap(): Record<number, string> {
  try {
    const saved = JSON.parse(localStorage.getItem('hbr.padmap') ?? 'null') as Record<string, string> | null;
    const out: Record<number, string> = {};
    for (const [i, k] of Object.entries(saved ?? {})) if (GBA_KEY[k]) out[Number(i)] = k;
    return Object.keys(out).length ? { ...out, 12: 'up', 13: 'down', 14: 'left', 15: 'right' } : PAD_DEFAULT;
  } catch { return PAD_DEFAULT; }
}
function padDown(k: string): void {
  if (intro()) return;
  if (lobby?.shown) { lobby.stage.key(GBA_KEY[k]); return; }
  if (!held.has(k)) pressed.add(k);
  held.add(k);
  if (asking) askKey(k);
  else if ((battle || swapping || romUp) && rom) rom.press(GBA_KEY[k]);
  else if (k === 'start') void openMenu();
}
function padUp(k: string): void {
  held.delete(k);
  rom?.release(GBA_KEY[k]);
}
// The touch pad: the live game's D-pad, A, B and START, the same as a controller's.
/** A short tap of haptic feedback as a pad button goes down (the live game's buzz, POK-245).
 *  A phone without it, every desktop, and a page not touched yet get nothing. */
function buzz(ms = 8): void {
  try { navigator.vibrate?.(ms); } catch { /* refused: not worth a word */ }
}
wireDpad(document.getElementById('dpad-surface')!, (k) => { buzz(); padDown(k); }, padUp);
for (const el of document.querySelectorAll<HTMLElement>('#pad .k')) {
  const k = el.dataset.k!;
  const up = () => { el.classList.remove('down'); padUp(k); };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('down'); buzz(); padDown(k); });
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
let padKeys = padMap();
let padStick = loadStickMap();
/** The remap wizard (the live game's wireRemap): the next button pressed, or where the
 *  stick moved (null at rest, 'skip' for a button), goes here instead of the game. */
let padCapture: ((index: number) => void) | null = null;
let axisCapture: ((input: AxisSense | null | 'skip') => void) | null = null;
const REMAP_ORDER = ['a', 'b', 'start', 'select', 'l', 'r'];
const remap = { on: false, line: '', cancel: null as (() => void) | null };
function remapSay(text: string): void { remap.line = text; lobby?.stage.redraw(); }
function remapStop(note: string): void {
  padCapture = axisCapture = null;
  remap.cancel = null;
  remap.on = false;
  remapSay(note);
}
/** REMAP PAD: A, B, START, SELECT, L and R by turns, then the stick UP and RIGHT; saved
 *  where the live game keeps them (hbr.padmap, hbr.padstick). Pressed again: cancel. */
function remapPad(): void {
  if (remap.cancel) { remap.cancel(); return; }
  const taken: Record<number, string> = {};
  let i = 0;
  const finish = (stick: StickMap | null) => {
    try {
      localStorage.setItem('hbr.padmap', JSON.stringify(taken));
      if (stick) localStorage.setItem(STICK_KEY, JSON.stringify(stick));
      else localStorage.removeItem(STICK_KEY);
    } catch { /* this session only */ }
    padKeys = { ...taken, 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
    padStick = stick;
    remapStop(stick ? 'Pad remapped, stick learned.' : 'Pad remapped.');
  };
  const askStick = () => {
    let learn = startStickLearn();
    remapSay('Push the LEFT STICK UP, then let go. Any button skips.');
    axisCapture = (input) => {
      const was = learn.phase;
      learn = stickLearnStep(learn, input);
      if (learn.phase === 'done') { axisCapture = null; finish(learn.result ?? null); }
      else if (learn.phase !== was) remapSay('Now push the LEFT STICK RIGHT.');
    };
  };
  const ask = () => {
    if (i >= REMAP_ORDER.length) { askStick(); return; }
    remapSay(`Press the button for ${REMAP_ORDER[i].toUpperCase()}. Esc cancels.`);
    padCapture = (index) => { taken[index] = REMAP_ORDER[i]; i++; ask(); };
  };
  remap.on = true;
  remap.cancel = () => remapStop('Remap cancelled.');
  ask();
}
function resetPad(): void {
  try { localStorage.removeItem('hbr.padmap'); localStorage.removeItem(STICK_KEY); } catch { /* nothing kept */ }
  padKeys = PAD_DEFAULT;
  padStick = null;
  remapStop('Pad mapping reset.');
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && remap.cancel) remap.cancel(); });
if (typeof navigator.getGamepads === 'function') {
  const rest = new Map<number, readonly number[]>();
  let padHeld = new Set<string>();
  let buttonsHeld = new Set<number>();
  setInterval(() => {
    const now = new Set<string>();
    const pressedNow = new Set<number>();
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      if (!rest.has(pad.index)) rest.set(pad.index, [...pad.axes]);
      const base = rest.get(pad.index)!;
      pad.buttons.forEach((b, i) => { if (b.pressed) pressedNow.add(i); });
      if (axisCapture) {
        const fresh = [...pressedNow].some((i) => !buttonsHeld.has(i));
        axisCapture(fresh ? 'skip' : learnAxis(pad.axes, base));
        continue;
      }
      if (padCapture) {
        const fresh = [...pressedNow].find((i) => !buttonsHeld.has(i));
        if (fresh !== undefined) padCapture(fresh);
        continue;
      }
      for (const i of pressedNow) if (padKeys[i]) now.add(padKeys[i]);
      for (const k of padStick ? stickKeys(pad.axes, base, padStick) : guessedStickKeys(pad.axes, base).keys) if (GBA_KEY[k]) now.add(k);
      const hat = pad.axes.length >= 10 ? pad.axes[9] : 9;
      if (hat >= -1.1 && hat <= 1.1) for (const k of PAD_HAT[Math.round((hat + 1) * 3.5) % 8]) now.add(k);
    }
    buttonsHeld = pressedNow;
    for (const k of now) if (!padHeld.has(k)) padDown(k);
    for (const k of padHeld) if (!now.has(k)) padUp(k);
    padHeld = now;
  }, 16);
}

// ---- camera + drawing -----------------------------------------------------------------

const canvas = document.getElementById('world') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let spectating = false;
/** The trainer the camera follows, by id; 0 for a camera dragged free. */
let follow = 0;
let cam = { x: 0, y: 0 }; // world pixel at the screen centre
let zoom = 3; // device pixels per GBA pixel
// The device's pixels. The canvas itself is smaller: drawn at the GBA's own pixels (one
// canvas pixel per device pixel / floor(zoom)) and scaled up by CSS, nearest-neighbour.
// A phone's 2.6M-pixel screen is then ~150k pixels of drawing, the same picture.
let devW = 1, devH = 1;
const modeBtn = document.getElementById('mode')!;

function fitZoom(): number {
  // The game's own view: the GBA's 15 x 10 tiles fit the window, the way the game
  // scales its picture (portrait phones get 15 across, not 15 tall: Cam found that
  // "more zoomed in than normal").
  return Math.max(1, Math.floor(Math.min(devW / 15, devH / 10) / TILE));
}

function resize(): void {
  const dpr = devicePixelRatio || 1;
  devW = Math.round(innerWidth * dpr);
  devH = Math.round(innerHeight * dpr);
  if (!spectating) zoom = fitZoom();
}
addEventListener('resize', resize);

function toggleSpectate(): void {
  if ((isOut || waiting) && spectating) return; // out: watching is all there is
  spectating = !spectating;
  modeBtn.classList.toggle('on', spectating);
  modeBtn.textContent = spectating ? 'Back to my trainer (V)' : 'Spectate (V)';
  if (!spectating) { follow = link.me; zoom = fitZoom(); }
  held.clear();
}
modeBtn.addEventListener('click', toggleSpectate);
const watch = new Watch({
  trainers: () => (link ? actors() : []),
  me: () => link?.me ?? 0,
  spectating: () => spectating,
  follow: () => follow,
  setFollow: (id) => { follow = id; if (id && zoom < 1) zoom = fitZoom(); },
  zoom: () => zoom,
  link: () => link ?? null,
  rom: () => rom,
  idle: () => (isOut || waiting) && !battle && !swapping && !asking,
});

// Drag and pinch / wheel, spectating only. A tap on a trainer follows them.
const pointers = new Map<number, { x: number; y: number }>();
let pinch0: { d: number; zoom: number } | null = null;
let moved = 0;
let tapAt: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!spectating) { tapAt = { x: e.clientX, y: e.clientY, t: performance.now() }; return; }
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = 0;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p || !spectating) return;
  const dpr = devicePixelRatio || 1;
  if (pointers.size === 1) {
    cam.x -= ((e.clientX - p.x) * dpr) / zoom;
    cam.y -= ((e.clientY - p.y) * dpr) / zoom;
    moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
    follow = 0;
  }
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2 && pinch0) {
    const [a, b] = [...pointers.values()];
    zoom = Math.min(8, Math.max(0.05, (pinch0.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch0.d));
  }
});
const endPointer = (e: PointerEvent) => {
  // On my own trainer: a tap (short, and where it went down) is a place to walk to.
  if (!spectating && tapAt && e.type === 'pointerup' && performance.now() - tapAt.t < 400 && Math.hypot(e.clientX - tapAt.x, e.clientY - tapAt.y) < 12) tapTo(e.clientX, e.clientY);
  tapAt = null;
  if (spectating && pointers.size === 1 && moved < 6) followAt(e.clientX, e.clientY);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch0 = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  if (!spectating) return;
  e.preventDefault();
  zoom = Math.min(8, Math.max(0.05, zoom * Math.exp(-e.deltaY * 0.0015)));
}, { passive: false });

function followAt(clientX: number, clientY: number): void {
  const dpr = devicePixelRatio || 1;
  const wx = cam.x + (clientX * dpr - devW / 2) / zoom;
  const wy = cam.y + (clientY * dpr - devH / 2) / zoom;
  let best: Actor | null = null;
  let bestD = 24 / Math.min(1, zoom);
  for (const a of actors()) {
    const p = pixelOf(a);
    const d = Math.hypot(p.x + 8 - wx, p.y - wy);
    if (d < bestD) { best = a; bestD = d; }
  }
  if (best) { follow = best.id; if (zoom < 1) zoom = fitZoom(); }
}

/** An actor's tile top-left in world pixels, mid-step included. */
function pixelOf(a: Actor): { x: number; y: number; lift: number } {
  const g = global(a.m.spot)!;
  return { x: g.gx * TILE + a.m.px, y: g.gy * TILE + a.m.py, lift: -a.m.lift };
}

/** The walk anim's frame. A step plays half the anim, one foot (SetStepAnimHandleAlternation
 *  starts it at command 0 or 2 by turns): the stride frame then standing, 8+8 of a walk's 16
 *  frames, and sAnim_RunSouth's 5+3 of a run's 8. Playing the whole anim each step was
 *  twice Emerald's cadence. */
function frameOf(a: Actor): number {
  const act = a.m.action;
  const run = !a.m.bike && a.m.run && act?.kind === 'step' && SHEETS[String(SKIN_GFX[a.skin])].frames >= 18;
  if (act?.kind === 'step') {
    const late = act.t / act.len >= (run ? 5 / 8 : 1 / 2) ? 1 : 0;
    return (run ? RUN : GO)[a.m.facing][(a.m.strides & 1) * 2 + late];
  }
  // A turn is a walk in place, one foot like a step: sAnim_GoFastSouth's 4+4. A bump into
  // a wall plays the whole of sAnim_GoSouth over its 32 frames.
  if (act?.kind === 'turn') return GO[a.m.facing][(a.m.strides & 1) * 2 + (act.t / act.len >= 1 / 2 ? 1 : 0)];
  if (act && act.kind !== 'hop' && act.kind !== 'warp') return GO[a.m.facing][Math.min(3, Math.floor((act.t / act.len) * 4))];
  return FACE[a.m.facing];
}


function mipFor(p: Placed, z: number): HTMLCanvasElement {
  if (!p.mips) {
    p.mips = [];
    let src: HTMLCanvasElement | null = null;
    for (const f of [4, 8, 16]) {
      const c = document.createElement('canvas');
      c.width = Math.ceil((p.m.w * TILE) / f);
      c.height = Math.ceil((p.m.h * TILE) / f);
      const x = c.getContext('2d')!;
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      if (src) x.drawImage(src, 0, 0, c.width, c.height);
      else { x.drawImage(p.ground!, 0, 0, c.width, c.height); x.drawImage(p.cover!, 0, 0, c.width, c.height); }
      p.mips.push(c);
      src = c;
    }
  }
  // the biggest copy that is not shrunk again on screen (shrinking is what aliases)
  return p.mips.find((_, i) => z * (4 << i) >= 0.9) ?? p.mips[2];
}

function tint(c: HTMLCanvasElement): string {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) sum[j] += d[i + j];
  const n = d.length / 4;
  return `rgb(${sum.map((v) => Math.round(v / n)).join(',')})`;
}

const sprites = new Map<number, HTMLCanvasElement>();
function sheet(gfx: number): HTMLCanvasElement | null {
  let s = sprites.get(gfx);
  if (!s && art) { s = art.sprite(gfx, SHEETS[String(gfx)].frames); sprites.set(gfx, s); }
  return s ?? null;
}

let patchArt: { grass: HTMLCanvasElement; water: HTMLCanvasElement } | null = null;
// sAnim_TallGrass's frames, ten apiece, then br_patch.c's breath before the next rustle.
const RUSTLE = [1, 2, 3, 4, 0];
const BREATH = 25;
// br_patch.c's sDrift: a pixel or two either way and back, a step every eight frames.
const DRIFT = [0, 1, 2, 1, 0, -1, -2, -1];

/** The map's marked spots nobody has taken, as the ROM draws them (br_patch.c Draw):
 *  the grass's rustle, darkened; on water a ripple drifting; anywhere else a shadow. */
function drawPatches(p: Placed): void {
  if (!patchArt && art) patchArt = art.patchSheets();
  if (!patchArt) return;
  for (const q of link.room.patchesOn(p.m.id)) {
    if (link.room.isTaken(q.key)) continue;
    const x = (p.gx + q.x) * TILE, y = (p.gy + q.y) * TILE;
    // Each spot's sprite starts when it comes into view, so they rustle out of step.
    const t = (frame + q.key * 13) % (RUSTLE.length * 10 + BREATH);
    const f = t < RUSTLE.length * 10 ? RUSTLE[Math.floor(t / 10)] : 0;
    const drift = DRIFT[((frame + q.key * 7) >> 3) & 7];
    if (isWater(p.m, q.x, q.y)) ctx.drawImage(patchArt.water, f * TILE, 0, TILE, TILE, x + drift, y, TILE, TILE);
    else if (isTallGrass(p.m, q.x, q.y)) ctx.drawImage(patchArt.grass, f * TILE, 0, TILE, TILE, x, y, TILE, TILE);
    else {
      ctx.fillStyle = '#181818';
      ctx.beginPath();
      ctx.ellipse(x + 8 + drift, y + 12, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

let ballArt: HTMLCanvasElement | null = null;
let bagArt: HTMLCanvasElement | null = null;
let nurseArt: HTMLCanvasElement | null = null;
const blobArt = new Map<number, HTMLCanvasElement | null>();
/** SURF's blob under a surfer, facing as they do (frame 2 flipped for east). */
function drawBlob(surferGfx: number, facing: number, dx: number, dy: number): void {
  if (!blobArt.has(surferGfx) && art) blobArt.set(surferGfx, art.surfBlob(surferGfx));
  const img = blobArt.get(surferGfx);
  if (!img) return;
  const f = FACE[facing];
  if (facing === DIR_EAST) {
    ctx.save();
    ctx.translate(dx + 32, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, f * 32, 0, 32, 32, 0, 0, 32, 32);
    ctx.restore();
  } else ctx.drawImage(img, f * 32, 0, 32, 32, dx, dy, 32, 32);
}
const propArt = new Map<number, HTMLCanvasElement>();
/** The trees CUT fells and the boulders STRENGTH moves, where nobody stands on them: a
 *  team that could CUT or push walks the cell (bots/world.ts canStand), and in Emerald
 *  the tree is down or the boulder moved by then. */
function drawProps(visible: Placed[], all: Actor[]): void {
  if (!art) return;
  for (const p of visible) {
    if (!p.props) {
      p.props = [];
      // A CUT cell is a tree or a Rock Smash rock (export-world.py marks both): the map's
      // own object there says which (the Safari's are rocks, not trees).
      const objs = art.objects(p.m.group, p.m.num);
      for (let i = 0; i < p.classes.length; i++) {
        const c = p.classes[i], x = i % p.m.w, y = Math.floor(i / p.m.w);
        const own = objs.find((o) => o[0] === x && o[1] === y)?.[2];
        if (c === CLASS_CUT) p.props.push([x, y, own === OBJ_EVENT_GFX_BREAKABLE_ROCK ? own : OBJ_EVENT_GFX_CUTTABLE_TREE]);
        else if (c === CLASS_BOULDER) p.props.push([x, y, OBJ_EVENT_GFX_PUSHABLE_BOULDER]);
      }
    }
    for (const [x, y, gfx] of p.props) {
      if (all.some((a) => a.m.spot.map === p.m.id && ((a.m.spot.x === x && a.m.spot.y === y) || (a.m.prev.map === p.m.id && a.m.prev.x === x && a.m.prev.y === y && a.m.action)))) continue;
      let img = propArt.get(gfx);
      if (!img) { img = art.sprite(gfx, 1); propArt.set(gfx, img); }
      ctx.drawImage(img, (p.gx + x) * TILE, (p.gy + y) * TILE + TILE - img.height);
    }
  }
}
/** Each CENTER's nurse behind her counter (two cells up from where you talk to her),
 *  facing out: the one person a match leaves in a CENTER (br_strip.c). */
function drawNurses(visible: Placed[]): void {
  if (!nurseArt && art) nurseArt = art.sprite(OBJ_EVENT_GFX_NURSE, 1);
  if (!nurseArt) return;
  for (const p of visible) {
    const c = p.m.centre;
    if (!c) continue;
    ctx.drawImage(nurseArt, (p.gx + c.counterX) * TILE + (TILE - nurseArt.width) / 2, (p.gy + c.counterY - 2) * TILE + TILE - nurseArt.height);
  }
}
/** The MARTs' clerks (marts.ts), each the way it faces: the first three frames are
 *  down, up and left; right is left turned over. */
const clerkArt = new Map<number, HTMLCanvasElement>();
/** OBJ_EVENT_GFX_BEAUTY at Lilycove's harbour, OBJ_EVENT_GFX_SAILOR on each dock. */
const FERRY_PEOPLE: [string, number, number, number][] = [
  [ATTENDANT.map, ATTENDANT.x, ATTENDANT.y, 45],
  ...[...new Map(Object.values(DOCKS).map((d) => [d.map, d])).values()].map((d): [string, number, number, number] => [d.map, d.sailor[0], d.sailor[1], 49]),
];
function drawClerks(visible: Placed[]): void {
  if (!art) return;
  // Events' traders, facing down (br_event.c's GENTLEMAN).
  for (const e of link.room.events) {
    const p = e.trader && placed.get(e.map);
    if (!p || !visible.includes(p)) continue;
    let img = clerkArt.get(OBJ_EVENT_GFX_GENTLEMAN);
    if (!img) clerkArt.set(OBJ_EVENT_GFX_GENTLEMAN, (img = art.sprite(OBJ_EVENT_GFX_GENTLEMAN, 3)));
    const w = img.width / 3;
    ctx.drawImage(img, 0, 0, w, img.height, (p.gx + e.trader!.x) * TILE + (TILE - w) / 2, (p.gy + e.trader!.y) * TILE + TILE - img.height, w, img.height);
  }
  // The ferry's attendant in Lilycove's harbour and each island's sailor (br_story.c).
  for (const [map, x, y, gfx] of FERRY_PEOPLE) {
    const p = placed.get(map);
    if (!p || !visible.includes(p)) continue;
    let img = clerkArt.get(gfx);
    if (!img) clerkArt.set(gfx, (img = art.sprite(gfx, 3)));
    const w = img.width / 3;
    ctx.drawImage(img, 0, 0, w, img.height, (p.gx + x) * TILE + (TILE - w) / 2, (p.gy + y) * TILE + TILE - img.height, w, img.height);
  }
  // People at home and floor traders (br_balls.c), facing down: a gift-giver's people.
  for (const h of link.room.homes) {
    const p = !h.gone && placed.get(h.map);
    const img = p && visible.includes(p) ? giftArt(h.n) : null;
    if (p && img) ctx.drawImage(img, (p.gx + h.x) * TILE + (TILE - img.width) / 2, (p.gy + h.y) * TILE + TILE - img.height);
  }
  for (const p of visible) {
    // The gym leaders nobody has beaten yet, facing down (a beaten one has left the gym).
    for (const l of LEADERS) {
      if (l.map !== p.m.id || link.room.bossDown(l.n)) continue;
      l.cells.forEach(([cx, cy], i) => {
        const gfx = l.gfx[i];
        let img = clerkArt.get(gfx);
        if (!img) clerkArt.set(gfx, (img = art!.sprite(gfx, 3)));
        const w = img.width / 3;
        ctx.drawImage(img, 0, 0, w, img.height, (p.gx + cx) * TILE + (TILE - w) / 2, (p.gy + cy) * TILE + TILE - img.height, w, img.height);
      });
    }
    for (const c of CLERKS) {
      if (c.map !== p.m.id) continue;
      const gfx = c.store ? OBJ_EVENT_GFX_WOMAN_3 : OBJ_EVENT_GFX_MART_EMPLOYEE;
      let img = clerkArt.get(gfx);
      if (!img) clerkArt.set(gfx, (img = art.sprite(gfx, 3)));
      const w = img.width / 3, f = c.facing === 1 ? 0 : c.facing === 2 ? 1 : 2;
      const x = (p.gx + c.x) * TILE + (TILE - w) / 2, y = (p.gy + c.y) * TILE + TILE - img.height;
      ctx.save();
      if (c.facing === 4) { ctx.translate(x + w, y); ctx.scale(-1, 1); } else ctx.translate(x, y);
      ctx.drawImage(img, f * w, 0, w, img.height, 0, 0, w, img.height);
      ctx.restore();
    }
  }
}

/** The item balls and bags nobody has taken, as the ROM draws them (br_loot.c: a
 *  fallen trainer's bag is BIRCH's BAG). */
function drawGround(x0: number, y0: number, x1: number, y1: number): void {
  if (!ballArt && art) ballArt = art.sprite(OBJ_EVENT_GFX_ITEM_BALL, 1);
  if (!bagArt && art) bagArt = art.sprite(OBJ_EVENT_GFX_BIRCHS_BAG, 1);
  const put = (img: HTMLCanvasElement | null, map: string, gx: number, gy: number) => {
    const p = placed.get(map);
    if (!img || !p) return;
    const x = (p.gx + gx) * TILE, y = (p.gy + gy) * TILE;
    if (x < x0 - TILE || x > x1 || y < y0 - TILE || y > y1) return;
    ctx.drawImage(img, x + (TILE - img.width) / 2, y + TILE - img.height);
  };
  for (const g of link.room.ground().values()) if (!link.room.picked.has(g.key)) put(g.gift ? giftArt(g.key) : tinted(g.item), g.map, g.x, g.y);
  for (const b of link.room.spills.values()) {
    if (link.room.picked.has(b.key)) continue;
    // An event's legendary stands as itself (br_legend.c's sLegends); a piece with one mon
    // or one item in it is a ball (br_loot.c), anything more a bag.
    const legend = b.legend && art ? legendArt(b.bag.mons![0].species) : b.person ? personArt(b.person.gfx) : null;
    const one = (b.bag.mons?.length ?? 0) + b.bag.items.length === 1 && !b.bag.money;
    put(legend ?? (one ? ballArt : bagArt), b.map, b.x, b.y);
  }
}

/** A ball in its colour (br_balls.h, Cam 2026-10-13: "red = items, blue = TMs, gold =
 *  rare"): the ROM's red ball with its reds moved. */
const tints = new Map<number, HTMLCanvasElement>();
function tinted(item: number): HTMLCanvasElement | null {
  const tier = GOLD.includes(item) ? 2 : isTm(item) ? 1 : 0;
  if (!tier || !ballArt) return ballArt;
  let img = tints.get(tier);
  if (!img) {
    img = document.createElement('canvas');
    img.width = ballArt.width;
    img.height = ballArt.height;
    const c = img.getContext('2d')!;
    c.drawImage(ballArt, 0, 0);
    const px = c.getImageData(0, 0, img.width, img.height);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (r < g + 40 || r < b + 40) continue; // only the ball's reds
      if (tier === 1) { d[i] = b; d[i + 1] = Math.min(255, g + r / 4); d[i + 2] = r; }
      else { d[i] = Math.min(255, r + 24); d[i + 1] = Math.round(r * 0.78); d[i + 2] = Math.round(b * 0.4); }
    }
    c.putImageData(px, 0, 0);
    tints.set(tier, img);
  }
  return img;
}

/** Who stands for a gift, by its key (br_loot.c's sGiftGfx): OLD_MAN, OLD_WOMAN,
 *  EXPERT_M, POKEFAN_F, facing down. */
const GIFT_GFX = [29, 30, 21, 18];
const giftArts = new Map<number, HTMLCanvasElement>();
function giftArt(key: number): HTMLCanvasElement | null {
  const gfx = GIFT_GFX[key % GIFT_GFX.length];
  if (!art) return null;
  let img = giftArts.get(gfx);
  if (!img) giftArts.set(gfx, (img = art.sprite(gfx, 1)));
  return img;
}

const personArts = new Map<number, HTMLCanvasElement>();
function personArt(gfx: number): HTMLCanvasElement | null {
  if (!art) return null;
  let img = personArts.get(gfx);
  if (!img) personArts.set(gfx, (img = art.sprite(gfx, 1)));
  return img;
}

const LEGEND_GFX: Record<number, number> = { 401: 200, 402: 201, 403: 202, 404: 197, 405: 198, 406: 41, 407: 187, 408: 188 };
const legendArts = new Map<number, HTMLCanvasElement>();
function legendArt(species: number): HTMLCanvasElement | null {
  const gfx = LEGEND_GFX[species];
  if (!gfx || !art) return null;
  let img = legendArts.get(gfx);
  if (!img) legendArts.set(gfx, (img = art.sprite(gfx, 1)));
  return img;
}

/** The "!" over a trainer who looked (trainer_see.c's FLDEFF_EXCLAMATION_MARK_ICON, as
 *  br_walkup.c starts it): a white bubble over their head, popping up, until the walk. */
function drawBang(x: number, y: number, t: number): void {
  const bx = Math.round(x + 3), by = Math.round(y - 24 - (t < 6 ? 6 - t : 0));
  ctx.fillStyle = '#303030';
  ctx.fillRect(bx + 1, by, 8, 14);
  ctx.fillRect(bx, by + 1, 10, 12);
  ctx.fillStyle = '#f8f8f8';
  ctx.fillRect(bx + 1, by + 1, 8, 12);
  ctx.fillStyle = '#303030';
  ctx.fillRect(bx + 4, by + 3, 2, 5);
  ctx.fillRect(bx + 4, by + 9, 2, 2);
}

/** The map at world pixel (x, y), or the nearest one to it: whose border fills the space
 *  past every map's edge. Picked by where the camera looks, the same whether it follows a
 *  trainer or is dragged, so the filler never changes with how you got there (Cam). */
function mapUnder(x: number, y: number): Placed | null {
  let best: Placed | null = null;
  let bestD = Infinity;
  for (const p of placed.values()) {
    const x0 = p.gx * TILE, y0 = p.gy * TILE;
    const dx = Math.max(x0 - x, 0, x - (x0 + p.m.w * TILE));
    const dy = Math.max(y0 - y, 0, y - (y0 + p.m.h * TILE));
    const d = dx * dx + dy * dy;
    if (d < bestD) { best = p; bestD = d; }
    if (d === 0) break;
  }
  return best;
}

function draw(): void {
  const all = actors();
  const followed = follow ? all.find((a) => a.id === follow) : undefined;
  if (followed) {
    const p = pixelOf(followed);
    cam.x = p.x + 8;
    cam.y = p.y + 8;
  }
  // Under one GBA pixel per CSS pixel (a spectator zoomed out), CSS pixels are plenty.
  const dpr = devicePixelRatio || 1;
  const k = zoom < dpr ? dpr : Math.floor(zoom);
  const W = Math.ceil(devW / k), H = Math.ceil(devH / k);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const z = zoom / k;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d1a14';
  ctx.fillRect(0, 0, W, H);
  // Past every map's edge the GBA repeats the map's 2x2 border block (Route 101's
  // trees): tile the block of the map under the camera, aligned to its even coordinates.
  const home = mapUnder(cam.x, cam.y) ?? placed.get('MAP_LITTLEROOT_TOWN')!;
  if (paint(home) && home.border && z < 0.5) {
    // Far out the 32 px block is noise: one flat colour, its average.
    home.borderTint ??= tint(home.border);
    ctx.fillStyle = home.borderTint;
    ctx.fillRect(0, 0, W, H);
  } else if (home.border) {
    const pat = ctx.createPattern(home.border, 'repeat')!;
    const bx = home.gx * TILE, by = home.gy * TILE;
    pat.setTransform(new DOMMatrix([z, 0, 0, z, Math.round(W / 2 - cam.x * z) + bx * z, Math.round(H / 2 - cam.y * z) + by * z]));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
  }
  // Whole-pixel camera at zoom >= 1, so tiles never shimmer.
  const ox = Math.round(W / 2 - cam.x * z);
  const oy = Math.round(H / 2 - cam.y * z);
  ctx.setTransform(z, 0, 0, z, ox, oy);
  // Far out, each map is drawn from a quarter-size copy averaged once (mip), because
  // nearest-neighbour shrinking turns trees into static and smoothing every frame is slow.
  const far = z < 0.5;
  const vx0 = -ox / z, vy0 = -oy / z, vx1 = vx0 + W / z, vy1 = vy0 + H / z;
  const visible: Placed[] = [];
  let painted = 0;
  for (const p of placed.values()) {
    const x = p.gx * TILE, y = p.gy * TILE;
    if (x > vx1 || y > vy1 || x + p.m.w * TILE < vx0 || y + p.m.h * TILE < vy0) continue;
    visible.push(p);
    if ((p.ground || painted++ < 2) && paint(p)) {
      if (far) ctx.drawImage(mipFor(p, z), x, y, p.m.w * TILE, p.m.h * TILE);
      else { ctx.drawImage(p.ground!, x, y); drawAnims(ctx, p, vx0, vy0, vx1, vy1); }
    }
  }
  if (!far) for (const p of visible) drawPatches(p);
  if (!far) drawGround(vx0, vy0, vx1, vy1);
  if (!far) drawProps(visible, all);
  const people = all
    .map((a) => ({ a, p: pixelOf(a) }))
    .filter(({ p }) => p.x > vx0 - 32 && p.x < vx1 + 32 && p.y > vy0 - 48 && p.y < vy1 + 32)
    .sort((u, v) => u.p.y - v.p.y);
  for (const { a, p } of people) {
    // On the water: sitting on the blob, bobbing (SURF's pose, FLDEFF_SURF_BLOB's bob).
    const surf = classAt(a.m.spot) === CLASS_WATER;
    // On the MACH BIKE: Brendan's and May's own; any other look rides on foot (br_skin.c).
    const gfx = surf ? (a.skin === 1 ? OBJ_EVENT_GFX_MAY_SURFING : OBJ_EVENT_GFX_BRENDAN_SURFING) : a.m.bike && a.skin < 2 ? BIKE_GFX[a.skin] : SKIN_GFX[a.skin];
    const info = SHEETS[String(gfx)];
    const s = sheet(gfx);
    if (!s) continue;
    const fr = surf ? FACE[a.m.facing] : frameOf(a);
    const dx = p.x + TILE / 2 - info.w / 2;
    const dy = p.y + TILE - info.h - p.lift + (surf ? ((frame >> 4) & 1) - 2 : 0);
    if (surf) drawBlob(gfx, a.m.facing, dx, dy + 4);
    if (a.m.facing === DIR_EAST) {
      ctx.save();
      ctx.translate(dx + info.w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(s, fr * info.w, 0, info.w, info.h, 0, 0, info.w, info.h);
      ctx.restore();
    } else ctx.drawImage(s, fr * info.w, 0, info.w, info.h, dx, dy, info.w, info.h);
    // Tall grass hides your feet: the ground's own grass tile over the sprite's bottom half.
    if (!a.m.action && classAt(a.m.spot) === 7) {
      const pl = placed.get(a.m.spot.map)!;
      if (pl.ground) ctx.drawImage(pl.ground, a.m.spot.x * TILE, a.m.spot.y * TILE + 8, TILE, 8, p.x, p.y + 8, TILE, 8);
    }
    if (spectating && a.id === follow) {
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 1 / Math.min(1, z);
      ctx.strokeRect(dx - 1, dy - 1, info.w + 2, info.h + 2);
    }
  }
  for (const p of visible) {
    if (p.cover && !far) ctx.drawImage(p.cover, p.gx * TILE, p.gy * TILE);
  }
  drawNurses(visible);
  drawClerks(visible);
  for (const { a, p } of people) if (a.meet?.walk && link.room.tick - a.meet.since < WALKUP_BANG) drawBang(p.x, p.y - p.lift, link.room.tick - a.meet.since);
  drawFog(vx0, vy0, vx1, vy1, home);
  // A door: the screen fades out and back in over the followed trainer's warp.
  const going = followed?.m.action?.kind === 'warp' ? followed.m.action : null;
  if (going) {
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - Math.abs((going.t / going.len) * 2 - 1)})`;
    ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
  }
  // Zoomed far out, the sprites are specks: mark every trainer with a dot.
  if (z < 0.6) {
    // in canvas pixels, whole ones, so the squares stay sharp
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // mine last, on top
    for (const a of [...all.filter((o) => o.id !== link.me), ...all.filter((o) => o.id === link.me)]) {
      const p = pixelOf(a);
      const mine = a.id === link.me;
      ctx.fillStyle = mine ? '#ff3b3b' : a.battling ? '#ffd34d' : a.bot ? '#ffffff' : '#5ec8ff';
      const r = mine ? 5 : a.bot ? 3 : 4;
      ctx.fillRect(Math.round(ox + (p.x + 8) * z) - r, Math.round(oy + (p.y + 8) * z) - r, r * 2, r * 2);
    }
  }
}

// ---- loop: a fixed 60 Hz sim, drawn on rAF --------------------------------------------

const statsEl = document.getElementById('stats')!;
/** The numbers box is a dev's (?stats); a player sees it only while the ROM loads. */
const SHOW_STATS = new URLSearchParams(location.search).has('stats');
statsEl.classList.add('debug');
const gaps: number[] = [];
let last = performance.now();
let acc = 0;
let simMs = 0;
let drawMs = 0;

function loop(now: number): void {
  const dt = now - last;
  last = now;
  gaps.push(dt);
  if (gaps.length > 120) gaps.shift();
  acc += Math.min(dt, 100);
  const t0 = performance.now();
  let steps = 0;
  while (acc >= 1000 / 60 && steps < 4) {
    acc -= 1000 / 60;
    steps += 1;
    frame += 1;
    for (const e of link.frame(myBits())) startFor(e);
    roundFrame();
    fieldFrame();
    teamFrame();
    seeFrame();
    soundFrame();
    stepsFrame();
    doorsFrame();
    fogFrame();
    foeFrame();
    remember();
    gymFrame();
    hudFrame();
    if (pressed.has('a')) dig();
    for (const k of pressed) watch.key(k);
    pressed.clear();
  }
  const t1 = performance.now();
  draw();
  watch.frame();
  if (sayUntil && performance.now() > sayUntil) { sayUntil = tickUntil = 0; msgBox.hide(); }
  const t2 = performance.now();
  simMs = simMs * 0.9 + (t1 - t0) * 0.1;
  drawMs = drawMs * 0.9 + (t2 - t1) * 0.1;
  if (frame % 15 === 0) {
    statsEl.classList.toggle('debug', SHOW_STATS || !rom);
    const sorted = [...gaps].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const fps = 1000 / (gaps.reduce((s, g) => s + g, 0) / gaps.length);
    const here = link.mine()?.m.spot ?? { map: 'MAP_LITTLEROOT_TOWN', x: 0, y: 0 };
    statsEl.textContent =
      `${fps.toFixed(0)} fps · p95 gap ${p95.toFixed(1)} ms\n` +
      `sim ${simMs.toFixed(2)} ms · draw ${drawMs.toFixed(2)} ms · art from your ROM ${artMs.toFixed(0)} ms\n` +
      `${link.room.actors.length} trainers · ${here.map.replace('MAP_', '')} ${here.x},${here.y}\n${link.status()}` +
      `\nROM ${rom ? (battle ? 'fighting' : 'between battles') : 'booting'}` +
      (lastStart ? ` · battle up in ${lastStart.frames} frames (${lastStart.ms.toFixed(0)} ms)` : '') +
      `\n${fogLine()}` +
      (lastResult ? `\n${lastResult}` : '') +
      (spectating ? `\nzoom ${zoom.toFixed(2)} · drag, pinch, tap a trainer` : '');
  }
  requestAnimationFrame(loop);
}

// ---- boot -----------------------------------------------------------------------------

/** QUICK PLAY's matches with no relay, which nothing else sees (match/stats.ts, POK-243),
 *  told to the relay's own socket the next time it is there: once, never answered. */
function sendStat(relay: string): void {
  const msg = statMessage(`world-${WORLD_HASH_SHORT}`);
  if (!msg) return;
  try {
    const ws = new WebSocket(relay);
    ws.onopen = () => { ws.send(JSON.stringify(msg)); statFlushed(); setTimeout(() => ws.close(), 500); };
    ws.onerror = () => ws.close();
  } catch { /* kept for next time */ }
}

/** Takes the room's link out of the address bar (left it, gone, or never there). */
function unlink(): void {
  if (parseRoomHash(location.hash)) history.replaceState(null, '', `${location.pathname}${location.search}${withoutRoom(location.hash) ? `#${withoutRoom(location.hash)}` : ''}`);
}

const DEFAULT_RELAY_URL = 'wss://hoenn-relay-production.up.railway.app';

/** A lazy chunk that will not load (a release took this page's hashed files off the
 *  site): the page offers a reload, never takes one itself mid-match (app.ts chunkFailed). */
addEventListener('vite:preloadError', () => {
  if (document.getElementById('chunk-reload')) return;
  const b = document.createElement('button');
  b.id = 'chunk-reload';
  b.type = 'button';
  b.textContent = "Part of the game didn't load. Tap to reload.";
  b.addEventListener('click', () => location.reload());
  document.body.append(b);
});

async function boot(): Promise<void> {
  registerServiceWorker();
  void askToKeepStorage();
  const hoenn = new WorldIndex(((await import('./data/world.json')).default as { maps: WorldMap[] }).maps);
  placed = layout(hoenn.maps);
  let files: Awaited<ReturnType<typeof loadRom>>;
  try {
    files = await loadRom(gbaCanvas, (t) => { statsEl.textContent = t; }, (emu) => importRom(emu, ''), devRomParam());
    romEmu = files.emu;
    versionLine = files.version;
  battlesOn(files.romSha);
    if (touchPad) { wireBattleMenu(files); wirePhoneHud(); }
  } catch (e) {
    console.warn('spike ROM not loaded', e);
    return;
  }
  const t0 = performance.now();
  art = new RomArt(files.rom, files.sym);
  romTables = { bytes: files.rom, sym: (n) => { const a = files.sym(n); return Number.isNaN(a) ? undefined : a; } };
  // A bots' fight, published as its side A for whoever watches either bot, as live
  // (app.ts proxyStream); the proxy's BSTART names nobody, so the names go in here.
  judge = makeJudge(files, (msg, sides) => {
    const named = msg.t === 'bstart' ? nameBstart(msg, (id) => link.room.actor(id)?.name ?? '', sides) : msg;
    link.sp(named, sides[0]);
  });
  paint(placed.get('MAP_LITTLEROOT_TOWN')!);
  artMs = performance.now() - t0;
  // One Hoenn for everybody on the page: the relay's (?world=<ws url> for another
  // relay), or, with none to reach (or ?solo), the page's own with the bots.
  const patches = await loadPatches();
  const q = new URLSearchParams(location.search);
  const url = q.get('world') ?? `${(import.meta.env.VITE_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL}/world`;
  // The rest of Hoenn, a map a tick, so zooming out never waits.
  const rest = [...placed.values()];
  const next = () => { const p = rest.find((r) => !r.mips); if (p) { paint(p); mipFor(p, 0); setTimeout(next, 16); } };
  setTimeout(next, 500);
  const booted = (r: RomBattles) => { rom = r; r.emu.onFrame(trackBag); if (link) r.reseed(link.room.seed); if (comingBack) void takeBack(r); giveNext(); };
  // A world of the page's own, as the live game's debug flags deal it (debug.ts): #fast
  // (25 s of Safari, 15 s a fog phase), #safari=, #fog=, #seed=, #nobots. ?ring=<seconds>
  // is the older spelling of #fog=.
  const solo = (): WorldLink => {
    const pace = devPace(location.hash);
    const ring = Number(q.get('ring')) || pace?.fogSecs;
    const seed = Number(new URLSearchParams(location.hash.slice(1)).get('seed')) >>> 0;
    return soloLink(hoenn.maps, patches, hoenn.world, seed || (crypto.getRandomValues(new Uint32Array(1))[0] || 1) >>> 0, {
      ...(ring ? { ringFrames: Math.round(ring * 60) } : {}),
      ...(pace?.safariSecs !== undefined || ring ? { openingFrames: Math.round((pace?.safariSecs ?? ring!) * 60) } : {}),
      ...(new URLSearchParams(location.hash.slice(1)).has('nobots') ? { bots: 0 } : {}),
      name: me().name, skin: me().skin,
    });
  };
  if (q.has('solo') || parseRoomHash(location.hash)?.mode === 'solo') {
    // The debug path (Cam, 2026-10-29): straight into a world of the page's own, the bots
    // and nobody else.
    startMatch(solo());
  } else {
    // The live game's way in: the menu, a room, START (lobby.ts).
    document.getElementById('intro')?.remove();
    const make = (seed: number) => makeRoom(hoenn.maps, patches, seed, hoenn.world);
    const sock = connectWorld(url, make, {
      onRoom: (r) => {
        room = r;
        // A hosted room's link is the address bar: copy it, send it, and a friend is in.
        if (!r.quick && parseRoomHash(location.hash)?.code !== r.code) history.replaceState(null, '', `#${withRoom(location.hash, 'join', r.code)}`);
        rom?.pace(r.set.textSpeed, r.set.animations);
        if (matchOn && !r.playing) matchOver();
        // The standings stay up until PLAY AGAIN; then the room as it is by then.
        else if (!matchOn && !winEl.classList.contains('on')) lobby!.roomIs(r);
      },
      onNoRoom: (code, pass, rom) => { forget(); unlink(); lobby!.menu(rom ? `Room ${code} is on another version of the game. Reload the page to update.` : pass ? `That is not room ${code}'s passcode.` : code ? `There is no room ${code}.` : 'Every place in the world is taken.'); },
      onKicked: () => { room = null; forget(); unlink(); lobby!.menu('The host took you out of the room.'); },
      onOld: () => { room = null; matchOn = false; forget(); lobby!.old(); },
      onRooms: (rooms) => lobby?.listed(rooms),
      onMatch: (l) => startMatch(l),
      onOpen: () => { lobby?.linkIs('up'); sendStat(url.replace(/\/world$/, '')); },
      onClosed: () => {
        reconnecting = false;
        lobby!.linkIs('down');
        // A match of the page's own (QUICK PLAY with no relay) has no socket to lose.
        if (matchOn && link?.online === false) return;
        matchOn = false;
        lobby!.menu('No relay. QUICK PLAY is you and the bots.');
      },
      onDropped: () => {
        if (!reconnecting) { reconnecting = true; tick('Reconnecting…', true); }
        if (lobby?.sheetUp) lobby.stage.redraw();
      },
      onReconnected: () => {
        // Back in as the same trainer (the relay held it, AWAY_MS); in a room between
        // matches, back into the room.
        const who = me();
        if (matchOn && room && link?.online && link.key) {
          resuming = true;
          return { t: 'join', name: who.name, skin: who.skin, code: room.code, again: { code: room.code, id: link.me, key: link.key } };
        }
        reconnecting = false;
        // In the room before a match: the same seat (the key takes it over), not a second.
        return room ? { t: 'join', name: who.name, skin: who.skin, code: room.code, ...(room.key ? { again: { code: room.code, id: room.you, key: room.key } } : {}) } : undefined;
      },
    });
    worldSock = sock;
    sheetBtn.hidden = false;
    const joinAs = (how: { code?: string; host?: boolean; pass?: string }) => { const c = loadCareer(); sock.join(me().name, me().skin, { ...how, rec: { wins: c.wins, played: c.matches, ...(c.best ? { best: c.best } : {}) } }); };
    lobby = new Lobby({
      join: joinAs,
      start: () => sock.start(),
      set: (set) => sock.set(set),
      kick: (id) => sock.kick(id),
      list: () => sock.list(),
      relayUrl: url.replace(/\/world$/, ''),
      // Out of the room for good: its link goes too, or the reload would walk back in.
      leave: () => { unlink(); location.reload(); },
      names: { species: speciesName, move: (id) => moveInfo(romTables, id)?.name },
      solo: () => { room = null; recordSolo(); startMatch(solo()); },
    });
    // Reloaded within a minute of a match: straight back in (or, too late, in to watch).
    const back = token();
    const linked = parseRoomHash(location.hash);
    if (back) { lobby.hide(); sock.join(me().name, me().skin, { code: back.code, again: { code: back.code, id: back.id, key: back.key } }); }
    // A room's link (#join=CODE), or #host / #quick: straight in, as the live game's are.
    else if (linked?.mode === 'join' || linked?.mode === 'host' || linked?.mode === 'quick') {
      lobby.hide();
      joinAs(linked.mode === 'join' ? { code: linked.code } : linked.mode === 'host' ? { host: true } : {});
    } else {
      // Too late to be the same trainer: the menu's WATCH goes back in to look (HBR-20).
      lobby.rewatch = lateCode();
      forget();
      lobby.menu(lobby.rewatch ? 'Too late to rejoin the match. WATCH it from here.' : '');
    }
  }
  bootRom(files, link?.room.seed ?? 0).then(booted, (e) => console.warn('spike ROM not booted', e));
  (window as unknown as { __spike: unknown }).__spike = { get link() { return link; }, get lobby() { return lobby; }, get room() { return room; }, actors, placed, goOut, get zoom() { return zoom; }, set zoom(v: number) { zoom = v; }, cam, toggleSpectate, startFor, handoff, get rom() { return rom; }, get battle() { return battle; }, get lastStart() { return lastStart; }, get lastResult() { return lastResult; }, get isOut() { return isOut; }, get waiting() { return waiting; }, get swapping() { return swapping; }, get asking() { return !!asking; }, get spectating() { return spectating; } };
}

void boot();
