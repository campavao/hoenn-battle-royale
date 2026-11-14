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
import type { PeekBag } from './shared/wire';
import { lineAt, voiceFor } from '../src/bots/lines';
import type { PackedMon } from '../src/net/wire';
import { FIELD_CUT, FIELD_STRENGTH, isTallGrass, isWater, type WorldMap, type Spot } from '../src/bots/world';
import { battleOrder, leadIndex } from './battleorder';
import { battleText } from './battlereader';
import { arrived, routeTo } from './tapwalk';
import { loadPatches } from '../src/bots/patches';
import { rungForPhase } from '../src/bots/party';
import { gradeOf } from '../src/bots/roster';
import { ballsIn, battleItems } from '../src/bots/bag';
import { acroFrame, acroNear, DIR_EAST } from './sim';
import { FACE, footPose } from './poses';
import { ballTakes, catchRateOf, patchBalls, wildMon, zoneBalls, zoneFight } from './shared/wild';
import { logMs } from './shared/battlelog';
import { ATTENDANT, BOATS, CLOSED_DOORS, isLooseSeam, DOCKS, MOORINGS, TIDAL_MAPS, TIDAL_SAILOR, islandMaps, type Cruise, HOME_N, KEY_A, KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_SELECT, KEY_UP, SAFARI, WALKUP_BANG, FIELD_SURF, FIELD_DIVE, diveTo, emptyBag, interiors, makeRoom, botParty, legendMon, LEGEND_CATCH, LEGEND_FOE, wornParty, type Actor, type Bag, type RoomEvent, type Results, type Ring, type Spill } from './shared/room';
type Person = NonNullable<Spill['person']>;
import { SKIN_GFX } from './shared/bots';
import { connectWorld, soloLink, type WorldLink, type WorldSocket } from './net';
import { over } from './shared/over';
import { Lobby, me, seeThrough, type RoomInfo } from './lobby';
import { stageScale } from '../src/ui/stage';
import { loadCareer, ordinal, recordMatch } from '../src/match/career';
import type { MatchTally } from '../src/match/tally';
import { beatenBy, couldFly, tallySince, teamMembers, PARTY_LEN, spentLine, spillShows } from './carry';
import { BagPanel } from './bagpanel';
import { Tag } from './tag';
import { STICK_KEY, guessedStickKeys, learnAxis, loadStickMap, startStickLearn, stickKeys, stickLearnStep, type AxisSense, type StickMap } from '../src/pad';
import { fameOf, resultsView, standingsOf, tallyLines, type FameMon } from '../src/ui/results';
import { favourite } from '../src/match/tally';
import { moveInfo, type Rom as MoveTables } from '../src/battle/movebook';
import { OUT_BATCH_MS, event, felled, opening, outs, won } from '../src/match/ticker';
import { MessageBox } from './msgbox';
import { Fishing, fishPose, rodOf, type Rod } from './fish';
import { Ticks } from './ticks';
import { MUS_HEAL, MUS_OBTAIN_ITEM, MUS_OBTAIN_TMHM, MusicCue, SE_CONTEST_CURTAIN_FALL, SE_CONTEST_CURTAIN_RISE, SE_DOOR, SE_EXIT, SE_FAILURE, SE_BIKE_HOP, SE_FIELD_POISON, SE_LEDGE, SE_M_FLY, SE_SELECT, SE_SHOP, SE_USE_ITEM, SE_WALL_HIT, SE_WIN_OPEN, type Where } from './music';
import { bootRom, loadRom, lastStart, type DuelLink, type Fought, type RomBattles } from './rom';
import { devRomParam, importRom } from './import';
import { LoadingScreen } from './loading';
import { introArt } from './introart';
import { askToKeepStorage, registerServiceWorker } from '../src/pwa';
import { devPace, parseRoomHash, withRoom, withoutRoom } from '../src/hash';
import { recordSolo, statFlushed, statMessage } from '../src/match/stats';
import { WORLD_HASH_SHORT, battlesOn } from './net';
import { ITEM_POKE_DOLL, groundCount, isTm, tradedInto } from './shared/items';
import { GIFTS } from '../src/match/gifts';
import { GOLD } from '../src/match/events';
import { FLYING, STORIES } from '../src/match/story';
import { RomArt, type MapAnim } from './romart';
import { AskBox } from './askbox';
import { ANIM_COUNTER_MAX } from '../src/tile-anims';
import { JankMeter } from './jank';
import { RingMap } from './ringmap';
import { SeamGlide, seamOff } from './seamglide';
import { Watch } from './watch';
import { BattleView } from './battleview';
import { coverScreen, curtainBehind, curtainLines, raiseCurtain, type Cover } from './curtain';
import { frameOf as fxFrame, grassUnderAsh, isFloor, MB_ASHGRASS, SHEETS as FX_SHEETS, stepEffects, type Effect, type FxKind } from './fieldfx';
import { CHUNK, ChunkCache, SEA_METATILE, WorldFill, chunksOver, mainlandPlane, type FillFile } from './worldfill';
import { ROOM_GAP, clampZoom, loadZoom, nextZoom, pickedZoom, roomFloor, saveZoom, wheelSteps, zoomLabel, zoomRange } from './zoom';
import { closingFade, fieldScale, FADE_COLOR_WORD, FADE_MODE_WORD, FADE_SELECTED, FADE_Y_WORD, FOG_EVA, FOG_EVB, fadeOf, keyPicture } from '../src/field';
import { PadPrefsControl } from '../src/ui/padprefs';
import { inputKeyboard, inputPad } from '../src/ui/hints';
import { wireDpad } from './dpad';
import { StartMenu } from './startmenu';
import { MapWindow, mapFit } from './mapwindow';
import { FLY_SPOTS } from './flyspots';
import { ARRIVES, FLIGHT_LEN, POISON_COLOUR, dollShows, flew, flightFade, flightPose, poisonBeat, poisonLook } from './looks';
import type { MapPlace } from './ringmap';
import { BACK_H, BATTLE_TYPE_RECORDED, BattleMenu, CELL_H, HOLD_MS, battleWantsNoPad, ppWithBonus, readBattleView, type PartyMember } from '../src/ui/battlemenu';
import { BATTLE_TYPE_TRAINER, CARD_H, SidesView } from '../src/ui/sides';
import { BAG_POSITION_POCKET, POCKET_BALLS, POCKET_TMHM, isMachine, readBattleBag, readFieldBag, readPocket, takesMachine } from '../src/ui/bag';
import type { Rom } from '../src/battle/movebook';
import { BATTLE_MENU, MENU_ACTION, MENU_PARTY, TouchLayer } from '../src/touch';
import { romAsks, type TeamRow } from './rom';
import { eatLiftClick, glass, pageWin } from '../src/ui/pagewin';
import { SummaryWindow } from '../src/ui/summary';
import { Radial, type DialItem } from '../src/ui/radial';
import { ITEM_HM01, ITEM_TM01, MovesBox, learnList, type LearnRow } from '../src/ui/movesbox';
import { learnsByNow } from '../src/ui/monfacts';
import { DIAL_TIP_MS, dialKnown, dialTipDue, dialTipShown, dialTipWords } from '../src/ui/dialtip';
import { TMHM_MOVES } from '../src/ui/tmhm';
import { HUD } from '../src/net/hud';
import { bagHolds, fieldMoves, fogPhase, ITEM_ACRO_BIKE, ITEM_MACH_BIKE, ITEM_TOWN_MAP, itemCut, KEYITEMS_POCKET, MINI_MAP, PhoneHud, signFor, type FieldMove } from '../src/ui/phonehud';
import { noticeScreen, type RoomSeat, type SheetModel } from '../src/ui/screens';
import { seatScreen } from '../src/ui/profile';
import { makeJudge, type Judge } from './judge';
import { nameBstart } from '../src/match/spectate';
import { LEADERS } from './shared/gyms';
import uiData from '../src/data/ui.json';
import { CLERKS, priceOf, shelf } from './shared/marts';
import { KEY_BIT, type GbaKey } from '../src/emu';
import { KeyLegend } from '../src/ui/keys';
import { KEYMAP, MARK_KEY, legendMap } from './keys';
import { spillName } from './spillname';
import { SPIKE_MS, recorder, saveRecording, watchPage } from './recorder';
import { FirstMenuNet, LostNet, NET_LIMITS } from './stuck';
import { stallLine, watch as watchRom } from '../src/emu/watchdog';
import spritesData from '../src/data/sprites.json';
import { Heights } from './heights';
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
const ACRO_GFX = [63, 91]; // OBJ_EVENT_GFX_BRENDAN_ACRO_BIKE, _MAY_ACRO_BIKE
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
  /** The frame its full-size ground was last drawn on: unpaintFar lets the oldest go. */
  usedAt?: number;
  classes: Uint8Array;
  /** The cut trees and Strength boulders standing on it: [x, y, gfx]. */
  props?: [number, number, number][];
  /** A building or cave of Hoenn's (POK-442): the cell of Hoenn it stands over, where its door
   *  is, and its own cell `entry` that lies on it. drawRoom's window. */
  door?: { x: number; y: number };
  entry?: { x: number; y: number };
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

/** The ferry's islands (room.ts islandMaps): not a place to drop. */
const ISLANDS = new Set<string>();
/** The maps joined up by their seams: Hoenn's plane, which worldfill.ts carries on past the edges.
 *  Everything else (the buildings, the islands, the Zone) stands alone on its own border. */
const MAINLAND = new Set<string>();
function layout(maps: WorldMap[]): Map<string, Placed> {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const placed = new Map<string, Placed>();
  for (const [id, { m, gx, gy }] of mainlandPlane(maps, isLooseSeam)) {
    placed.set(id, { m, gx, gy, classes: decode(m.grid, m.w * m.h) });
    MAINLAND.add(id);
  }
  // The buildings and caves, each on its own, in rows well east of Hoenn: drawn where the
  // camera follows a trainer in, and never in sight of the outdoors.
  let right = 0, top = Infinity;
  for (const p of placed.values()) { right = Math.max(right, p.gx + p.m.w); top = Math.min(top, p.gy); }
  const GAP = ROOM_GAP, ROW = 640;
  let x = right + 200, y = top, rowH = 0;
  for (const [id, { m }] of interiors(maps, placed)) {
    if (x + m.w > right + 200 + ROW) { x = right + 200; y += rowH + GAP; rowH = 0; }
    placed.set(id, { m, gx: x, gy: y, classes: decode(m.grid, m.w * m.h) });
    x += m.w + GAP;
    rowH = Math.max(rowH, m.h);
  }
  // Where each one stands on Hoenn, door by door, a room up a stair over the stair below it.
  for (const id of MAINLAND) inDoors(placed, id);
  // The ferry's islands, each on its own, in the row past the buildings'.
  x = right + 200; y += rowH + GAP; rowH = 0;
  for (const m of islandMaps(maps)) {
    ISLANDS.add(m.id);
    placed.set(m.id, { m, gx: x, gy: y, classes: decode(m.grid, m.w * m.h) });
    x += m.w + GAP;
    rowH = Math.max(rowH, m.h);
  }
  // ...and the SS TIDAL's decks (room.ts TIDAL_MAPS), which only its harbours board.
  for (const m of maps.filter((q) => TIDAL_MAPS.includes(q.id))) {
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
    // ...and what its doors lead into (its REST HOUSE), each on its own past it, as the islands'
    // buildings are. The room lets a trainer in; with nowhere here to stand, every page drawing them
    // threw on every frame and the match stopped for all (Cam, 11-08).
    let zx = right + 200;
    for (const p of placed.values()) if (p.m.id.startsWith(SAFARI)) zx = Math.max(zx, p.gx + p.m.w + GAP);
    const zy = y + rowH + 200;
    const doors = [...placed.keys()].filter((id) => id.startsWith(SAFARI));
    while (doors.length) {
      for (const w of placed.get(doors.shift()!)!.m.warps ?? []) {
        const to = byId.get(w.to);
        if (!to || placed.has(to.id) || CLOSED_DOORS.has(to.id)) continue;
        placed.set(to.id, { m: to, gx: zx, gy: zy, classes: decode(to.grid, to.w * to.h) });
        zx += to.w + GAP;
        doors.push(to.id);
      }
    }
  }
  // Under the sea (room.ts diveTo): the maps below the dive spots, by their own seams, past
  // the Zone.
  for (const top of maps.filter((m) => m.dive)) {
    const first = byId.get(top.dive!);
    if (!first || placed.has(first.id)) continue;
    let gx0 = right + 800;
    for (const p of placed.values()) if (p.m.emerge) gx0 = Math.max(gx0, p.gx + p.m.w + 200);
    placed.set(first.id, { m: first, gx: gx0, gy: y + rowH + 200, classes: decode(first.grid, first.w * first.h) });
    const q = [first.id];
    while (q.length) {
      const p = placed.get(q.shift()!)!;
      for (const s of p.m.seams) {
        const to = byId.get(s.to);
        if (!to?.emerge || placed.has(to.id)) continue;
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

function inDoors(placed: Map<string, Placed>, id: string): void {
  const p = placed.get(id)!;
  for (const w of p.m.warps ?? []) {
    const r = placed.get(w.to);
    if (!r || r.door || MAINLAND.has(w.to)) continue;
    r.door = p.door ? { x: p.door.x + w.x - p.entry!.x, y: p.door.y + w.y - p.entry!.y } : { x: p.gx + w.x, y: p.gy + w.y };
    r.entry = { x: w.toX, y: w.toY };
    inDoors(placed, w.to);
  }
}

let art: RomArt | null = null;
const monIcons = new Map<number, HTMLCanvasElement | null>();
function monIconOf(species: number): HTMLCanvasElement | null {
  if (!monIcons.has(species) && art) monIcons.set(species, art.monIcon(species));
  return monIcons.get(species) ?? null;
}
let bagSpriteArt: HTMLCanvasElement | null = null;
function bagArtOf(): HTMLCanvasElement | null {
  return (bagSpriteArt ??= art?.bagSprite() ?? null);
}
/** A window's size on this screen, CSS pixels to a GBA pixel: a phone's from its width, a
 *  window with a mouse's whole, by its height. */
function windowScale(): number {
  if (touchPad) return Math.min(2, Math.max(1, innerWidth / 250));
  return Math.max(1, Math.min(Math.floor(innerWidth / 250), Math.max(2, Math.min(4, Math.floor(innerHeight / 360)))));
}

// The minimap: the MAP's own picture round where the trainer is, the fog on it, the trainer on
// that (Cam, 11-02: "this should be a minimap ... which is what indicates that you can click
// to open the map too").
const miniCanvas = document.createElement('canvas');
miniCanvas.width = miniCanvas.height = MINI_MAP;
let regionPixels: ImageData | null | undefined;
let miniKey = '';
const FOG_TINT = [152, 96, 200], FOG_MIX = 0.62;
function miniFrame(a: Actor | undefined): string {
  if (!a || !ringMap || !art) return miniKey;
  if (regionPixels === undefined) {
    const cv = art.regionMap();
    regionPixels = cv ? cv.getContext('2d')!.getImageData(0, 0, 240, 160) : null;
  }
  if (!regionPixels) return miniKey;
  const ring = link.room.ring();
  const at = ringMap.pixelOf(a.m.spot);
  const key = `${at.x}|${at.y}|${a.skin}|${ring.last}|${ring.r.toFixed(1)}|${ring.cx.toFixed(0)}|${ring.cy.toFixed(0)}`;
  if (key === miniKey) return key;
  miniKey = key;
  const n = MINI_MAP;
  const sx = Math.max(6, Math.min(234 - n, at.x - n / 2)), sy = Math.max(14, Math.min(138 - n, at.y - n / 2));
  const c = miniCanvas.getContext('2d')!;
  const img = c.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const from = ((sy + y) * 240 + sx + x) * 4, to = (y * n + x) * 4;
      const fog = ringMap.fogAt(sx + x, sy + y, ring);
      for (let j = 0; j < 3; j++) {
        const v = regionPixels.data[from + j];
        img.data[to + j] = fog ? v * (1 - FOG_MIX) + FOG_TINT[j] * FOG_MIX : v;
      }
      img.data[to + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  // The trainer's head, on their cell.
  const gfx = SKIN_GFX[a.skin] ?? SKIN_GFX[0];
  const s = sheet(gfx);
  if (s) {
    c.imageSmoothingEnabled = false;
    const { w, h } = SHEETS[String(gfx)];
    // The head, rows 9-24 of a 32-row frame (hair from row 10, chin at 22, the 11-04 crop stopped at 21 and cut the chin), kept whole inside the picture at its edges.
    const dx = Math.max(0, Math.min(n - w, Math.round(at.x - sx - w / 2))), dy = Math.max(0, Math.min(n - 16, Math.round(at.y - sy - 8)));
    c.drawImage(s, 0, Math.max(0, h - 23), w, 16, dx, dy, w, 16);
  }
  return key;
}

/** METATILE_Cave_SealedChamberEntrance_* (metatile_labels.h), where Open lays them. */
const SEALED_CHAMBER: [number, number, number][] = [[7, 19, 0x22a], [8, 19, 0x22b], [9, 19, 0x22c], [7, 20, 0x232], [8, 20, 0x233], [9, 20, 0x234]];
/** METATILE_Cave_EntranceCover over SealedChamberBraille_Mid: the wall before it opens. */
const HIDDEN_CHAMBER: [number, number, number][] = [[7, 19, 0x229], [8, 19, 0x229], [9, 19, 0x229], [7, 20, 0x235], [8, 20, 0x235], [9, 20, 0x235]];
/** The beams across MAUVILLE's gym that shut Wattson's room, off (METATILE_MauvilleGym_*BeamH{3,4}_On
 *  to _Off, as MauvilleGymDeactivatePuzzle lays them): the grid has them open, so the picture does. */
const MAUVILLE_BEAMS_OFF: Record<number, number> = {
  0x220: 0x230, 0x221: 0x231, 0x228: 0x238, 0x229: 0x239, 0x222: 0x232, 0x223: 0x233, 0x22a: 0x23a, 0x22b: 0x23b,
  0x240: 0x242, 0x241: 0x243, 0x248: 0x21a, 0x249: 0x21a, 0x250: 0x251,
};
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
  const over = wall ? new Map(wall.map(([x, y, block]) => [y * p.m.w + x, block])) : new Map<number, number>();
  // MAUVILLE's gym with its puzzle off, as it is walked (tools/br/open-gym-puzzles.py).
  if (p.m.id === 'MAP_MAUVILLE_CITY_GYM') {
    for (let i = 0; i < p.m.w * p.m.h; i++) {
      const block = art.blockAt(p.m.group, p.m.num, i % p.m.w, Math.floor(i / p.m.w)), off = MAUVILLE_BEAMS_OFF[block & 0x3ff];
      if (off) over.set(i, off);
    }
  }
  for (const i of ashGone.get(p.m.id) ?? []) over.set(i, grassUnderAsh(art.blockAt(p.m.group, p.m.num, i % p.m.w, Math.floor(i / p.m.w))));
  const a = art.map(p.m.group, p.m.num, over);
  p.ground = a.ground;
  p.cover = a.cover;
  p.border = a.border;
  p.anims = a.anims;
  if (p.door) clearVoid(a.ground, a.cover);
  return true;
}

/** What the maps' full-size pictures may hold at once (ground and cover, 4 bytes a pixel each).
 *  All 518 maps painted was 647 MB of canvas, cut in the background a map a tick after boot: a
 *  phone's browser killed the tab for it and it came back on the loading screen (Reddit, 11-12:
 *  "crashing every few minutes"). Far out a map is drawn from its mips, which stay. */
const PAINTED_BUDGET = 96e6;
const paintedBytes = (p: Placed) => p.m.w * p.m.h * TILE * TILE * 8;
/** A map's full-size pictures let go: paint cuts them again when it is near once more. */
function unpaint(p: Placed): void {
  p.ground = p.cover = p.anims = undefined;
}
/** Over the budget, the maps drawn longest ago let go of their full-size pictures, never one
 *  drawn this last second. */
function unpaintFar(): void {
  const held = [...placed.values()].filter((p) => p.ground);
  let bytes = held.reduce((n, p) => n + paintedBytes(p), 0);
  if (bytes <= PAINTED_BUDGET) return;
  held.sort((a, b) => (a.usedAt ?? -1) - (b.usedAt ?? -1));
  for (const p of held) {
    if (bytes <= PAINTED_BUDGET || (p.usedAt ?? -Infinity) > frame - 60) break;
    unpaint(p);
    bytes -= paintedBytes(p);
  }
}

/** The black round a room (its corners, its padding), so the world shows there: every pixel of
 *  near-black joined to the picture's edge goes clear, and a black floor in the room stays. A
 *  room's bottom corners are its top layer's black, over floor. */
function clearVoid(ground: HTMLCanvasElement, cover: HTMLCanvasElement): void {
  const w = ground.width, h = ground.height;
  const gc = ground.getContext('2d')!, cc = cover.getContext('2d')!;
  const gd = gc.getImageData(0, 0, w, h), cd = cc.getImageData(0, 0, w, h);
  const gp = new Uint32Array(gd.data.buffer), cp = new Uint32Array(cd.data.buffer);
  const dark = (v: number) => (v & 0xff) + ((v >> 8) & 0xff) + ((v >> 16) & 0xff) < 48;
  const stack: number[] = [];
  const push = (i: number) => {
    const shown = cp[i] >>> 24 ? cp[i] : gp[i];
    if (shown >>> 24 && dark(shown)) { gp[i] = cp[i] = 0; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop()!, x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < (h - 1) * w) push(i + w);
  }
  gc.putImageData(gd, 0, 0);
  cc.putImageData(cd, 0, 0);
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


// ---- input ----------------------------------------------------------------------------

const held = new Set<string>();
const pressed = new Set<string>();
// The keyboard's GBA on a desktop's field (ui/keys.ts, /classic/'s), lit while a key is
// held; CSS shows it only where there is a mouse, and the page hides it off the field.
const keysEl = document.getElementById('keys')!;
const legendFrames: (() => void)[] = [];
new KeyLegend(keysEl, {
  onFrame: (l) => { legendFrames.push(l); return () => legendFrames.splice(legendFrames.indexOf(l), 1); },
  keys: () => { let m = 0; for (const k of held) if (k in KEY_BIT) m |= 1 << KEY_BIT[k as GbaKey]; return m; },
}, legendMap());
// K marks a moment for the play-test's replay: not a button of the GBA's, so a cap of its own.
const markCap = document.createElement('div');
markCap.className = 'k k-mark';
markCap.innerHTML = `<b>${MARK_KEY.toUpperCase()}</b><i>MARK</i>`;
keysEl.append(markCap);
// C held: the key items' dial, a pad's right trigger on the keyboard.
const dialCap = document.createElement('div');
dialCap.className = 'k k-dial';
dialCap.innerHTML = '<b>C</b><i>ITEMS</i>';
keysEl.append(dialCap);
// A long press is a held button, never a page's selection, callout or drag (HBR-98).
const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
for (const type of ['contextmenu', 'selectstart', 'dragstart']) document.addEventListener(type, (e) => { if (!typing(e.target)) e.preventDefault(); });
/** The start card is up: nothing behind it moves (review of #157). */
const intro = () => document.getElementById('intro') !== null;
// The menu and the room (lobby.ts) have the keys while they are up: Emerald's, as the
// live game's stage takes them, and a keyboard's letters for an entry.
const STAGE_KEY: Record<string, GbaKey> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', z: 'a', x: 'b', Z: 'a', X: 'b', Enter: 'start', Escape: 'b' };
addEventListener('keydown', (e) => {
  inputKeyboard();
  if (e.key === 'Escape' && remap.cancel) { remap.cancel(); e.stopImmediatePropagation(); return; }
  if (!lobby?.shown) return;
  e.stopImmediatePropagation();
  if (!e.ctrlKey && !e.metaKey && !e.altKey && lobby.stage.char(e.key)) { e.preventDefault(); return; }
  const k = STAGE_KEY[e.key];
  if (k) { e.preventDefault(); if (!e.repeat) lobby.stage.key(k); }
}, true);
// The windows over a battle have the keys while they are up, as a pad's L and R: Q and E.
const windowKey = (key: string): string | undefined => (key === 'q' || key === 'Q' ? 'l' : key === 'e' || key === 'E' ? 'r' : KEYMAP[key]);
addEventListener('keydown', (e) => {
  if (lobby?.shown || e.ctrlKey || e.metaKey || !pageWin.up) return;
  const k = e.key === 'Escape' ? 'b' : windowKey(e.key);
  if (!k) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!e.repeat) pageWin.key(k);
}, true);
addEventListener('keydown', (e) => {
  if (lobby?.shown || e.ctrlKey || e.metaKey || !battleMenu?.isShown) return;
  const k = windowKey(e.key);
  if (!k) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!e.repeat) battleMenu.press(k);
}, true);
addEventListener('keyup', (e) => { const k = windowKey(e.key); if (k) battleMenu?.release(k); }, true);
addEventListener('keydown', (e) => {
  if (intro() || pageWin.up) return;
  if (e.key === 'v' || e.key === 'V') { toggleSpectate(); return; }
  if (e.key.toLowerCase() === RADIAL_KEY && !e.repeat && !e.ctrlKey && !e.metaKey) { openDial(); return; }
  if ((e.key === 'm' || e.key === 'M' || e.key === 'Escape') && !e.repeat) { void openMenu(); return; }
  if ((e.key === 'f' || e.key === 'F') && !e.repeat) { itemfinder(); return; }
  if ((e.key === 'r' || e.key === 'R') && !e.repeat) { openSheet(); return; }
  if (e.key.toLowerCase() === MARK_KEY && !e.repeat) { markHere('key'); return; }
  if ((e.key === 'q' || e.key === 'Q') && !e.repeat && !asking) { void runMenu('1'); return; }
  if ((e.key === 'e' || e.key === 'E') && !e.repeat && !asking) { void runMenu('2'); return; }
  if (!e.ctrlKey && !e.metaKey && !e.repeat && (e.key === '+' || e.key === '=')) { zoomBy(1); return; }
  if (!e.ctrlKey && !e.metaKey && !e.repeat && (e.key === '-' || e.key === '_')) { zoomBy(-1); return; }
  const k = KEYMAP[e.key];
  if (!k) return;
  e.preventDefault();
  if (!held.has(k)) pressed.add(k);
  held.add(k);
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.key]; if (k) held.delete(k); if (e.key.toLowerCase() === RADIAL_KEY) radial.release(); });
addEventListener('blur', () => { held.clear(); radial.close(); });
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
  if (spectating || battle || swapping || romUp || asking || casting || intro() || pageWin.up || flights.some((f) => f.id === link.me)) return 0;
  // The battle ROM still booting (a match started seconds after the page opened): a
  // marked spot or a trainer stepped into now could only say "still loading" and spend
  // the spot, so the trainer waits for it, once told why.
  if (!rom) {
    if (held.size && !toldLoading) { toldLoading = true; tick('Getting the game ready…'); }
    return 0;
  }
  // Held now, or pressed since the last frame: a tap whose keyup came before this frame ran
  // (a quick thumb, or both events queued behind a long frame) is still one frame's press,
  // where reading `held` alone lost it (Cam 11-10, "the first click doesn't go through").
  const on = (k: string) => held.has(k) || pressed.has(k);
  const bits = (on('up') ? KEY_UP : 0) | (on('down') ? KEY_DOWN : 0) | (on('left') ? KEY_LEFT : 0) |
    (on('right') ? KEY_RIGHT : 0) | (on('b') ? KEY_B : 0) | (on('a') && frame >= calmUntil ? KEY_A : 0) |
    (on('select') || frame < selectUntil ? KEY_SELECT : 0);
  // A thumb on the pad takes over from a tapped walk.
  if (bits) { tapWalk = null; return bits; }
  return tapBits();
}

// ---- tap to walk (the live game's touch.ts, on the page's own world) ------------------
// A tap on the map is a place to go: the route is a walk over the room's own steps (what a
// thumb on the pad could walk), held a cell at a time. A tap on something that cannot be
// stood on (a trainer, a sign, the nurse) is "walk up to it, face it, press A".

const DIR_BIT: Record<number, number> = { 1: KEY_DOWN, 2: KEY_UP, 3: KEY_LEFT, 4: KEY_RIGHT };
let tapWalk: { dirs: number[]; cells: string[]; at: string; since: number; press: boolean } | null = null;
const spotKey = (p: Spot) => `${p.map}:${p.x}:${p.y}`;

function tapBits(): number {
  const me = link.mine();
  if (!tapWalk || !me) return 0;
  const here = spotKey(me.m.spot);
  if (here !== tapWalk.at) { tapWalk.at = here; tapWalk.since = frame; arrived(tapWalk, here); }
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
  const route = routeTo(link.room, me, goal);
  tapWalk = route ? { dirs: route.dirs, cells: route.cells, at: spotKey(me.m.spot), since: frame, press: route.press } : null;
}

// ---- marked spots: the live game's visible encounters ------------------------------------

// The room deals them from its seed the way every ROM deals them (bots/patches.ts,
// br_patch.c's Pick), and the ROM rolls the national stand-ins off the same seed.

// ---- the battle handoff: the real ROM fights, the page waits ---------------------------

const battleEl = document.getElementById('battle')!;
document.getElementById('intro-go')!.addEventListener('click', () => document.getElementById('intro')!.remove());
const battleNote = document.getElementById('battle-note')!;
const gbaCanvas = document.getElementById('gba') as HTMLCanvasElement;
let rom: RomBattles | null = null;
/** Bot-vs-bot fights the room gives this page, in a hidden second ROM (judge.ts). */
let judge: Judge | null = null;
let artMs = 0;
let battle: { foe: Actor | null; shownAt: number; foeGone?: boolean; heardAt?: number; round: number; link: WorldLink; boss?: number; net: FirstMenuNet; stopped?: boolean; unwatch?: () => void; force?: number } | null = null;
/** The ROM has the screen for a dropped bag's team (rom.team). */
let swapping = false;
let calmUntil = 0;
const handoff: number[] = []; // ms from the trigger to the ROM's first battle frame, and back


/** A battle the ROM fights, the page showing it from its first frame and taking the
 *  screen back when it is over. */
let logFight = 0;
function handOff(foe: Actor | null, run: (r: RomBattles, onStart: () => void) => Promise<Fought>, opts: { log?: boolean; weather?: number; label?: { name: string; skin: number }; wild?: boolean } = {}): void {
  // One battle at a time: one still running from the match before (its ROM is busy with
  // it) turns this one down, or its end would be credited to this foe.
  if (battle) { link.end(); return; }
  held.clear();
  battle = { foe, shownAt: performance.now(), round: link.room.results.round, link, net: new FirstMenuNet() };
  const mine = battle;
  const standing = link.mine()?.m.spot;
  rom?.fieldWeather(opts.weather ?? (standing ? link.room.weatherAt(standing) : 0));
  if (!rom) {
    battleEl.classList.add('on');
    battleNote.textContent = 'The game is still loading. Try again in a moment.';
    setTimeout(() => endBattle(null), 1500);
    return;
  }
  battleNote.textContent = '';
  watchFight(mine, rom);
  // The fight, read off the ROM and told to the relay for whoever watches it (battlereader.ts);
  // a link battle is told by the side that challenged only.
  const me = link.mine();
  if (link.online && me && opts.log !== false) {
    const l = link, f = ++logFight & 0xffff;
    rom.logTo({
      ctx: { me: { seat: l.me, name: me.name, skin: me.skin }, foe: { seat: foe?.id ?? 0, name: foe?.name ?? opts.label?.name ?? '', skin: foe?.skin ?? opts.label?.skin ?? 0, ...(opts.wild ? { wild: true } : {}) }, map: me.m.spot.map },
      emit: (events) => l.bl(f, events),
    });
  }
  const t0 = performance.now();
  const firstFrame = rom.emu.onFrame(() => { handoff.push(performance.now() - t0); firstFrame(); });
  // The page keeps the screen until the ROM's battle is up: before that the hidden ROM
  // is still standing in its own Littleroot, which is what showed through ("teleported
  // back to my house", Cam). A battle that never starts never takes the screen.
  const r = rom;
  // A fight the stuck-fight net let go of already (stopFight) is over: its late end is nobody's.
  void Promise.resolve()
    .then(() => run(r, () => { if (battle === mine) battleEl.classList.add('on'); }))
    .then((f) => { if (battle === mine) endBattle(f); }, (e) => {
      console.warn('spike battle failed', e);
      if (battle !== mine) return;
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

function say(text: string, ms = 2500): void {
  msgBox.show(text);
  sayUntil = performance.now() + ms;
}

// ---- the rod (fish.ts): SELECT facing water, as the room took it --------------------------

/** Maps with a fishing table (export-encounters.py): anywhere else nothing ever bites. */
const FISH_MAPS = new Set((encounterData as { fish?: string[] }).fish ?? []);
/** OBJ_EVENT_GFX_BRENDAN_FISHING, _MAY_FISHING; any other look fishes in its own standing
 *  frame (br_skin.c BrSkin_PlayerAnim). */
const FISH_GFX = [137, 138];
/** OBJ_EVENT_GFX_BRENDAN_UNDERWATER, _MAY_UNDERWATER. */
const DIVE_GFX = [111, 112];
/** My cast under way, the water it is over, and the rod. */
let casting: { f: Fishing; rod: Rod; map: string; x: number; y: number } | null = null;

function cast(map: string, x: number, y: number): void {
  const rod = rodOf(rom?.rod() ?? 0);
  // No ROM yet, or a bag with no rod in it (an older patch): nothing to cast.
  if (rod === -1 || !rom) { link.end(); return; }
  casting = { f: new Fishing(rod, FISH_MAPS.has(map), () => (Math.random() * 0x10000) | 0), rod, map, x, y };
  sayUntil = tickUntil = 0;
}

/** A frame of my cast: the box says the dots, the bite and what came of it; a POKeMON on
 *  the hook is the map's fishing battle, and anything else gives the room the trainer back. */
function fishFrame(): void {
  if (!casting) return;
  const c = casting;
  const a = pressed.has('a'), b = pressed.has('b');
  pressed.delete('a');
  pressed.delete('b');
  const end = c.f.frame(a, a || b);
  if (c.f.boxed) msgBox.show(c.f.text, false, 2);
  if (!end) return;
  casting = null;
  msgBox.hide();
  const p = placed.get(c.map);
  if (end !== 'hooked' || !p || !art) { link.end(); return; }
  const fog = inFogNow();
  const behavior = art.behavior(p.m.group, p.m.num, c.x, c.y);
  handOff(null, (r, onStart) => r.fish(p.m.group, p.m.num, behavior, c.rod, onStart, fog), { wild: true });
}

const itemTag = new Tag(document.getElementById('item-tag') as HTMLCanvasElement);
/** What is on a cell, as its tag says it. */
function nameOn(map: string, x: number, y: number): string {
  if (!art) return '';
  // Somebody with a POKeMON to give or trade says which (Cam, 11-02: "when you walk up to a
  // person and they have an item or a Pokemon, we show the sprite in the tooltip").
  const tr = link.room.traderAt(map, x, y);
  if (tr?.t.species) return speciesName(tr.t.species);
  const g = link.room.groundAt(map, x, y);
  if (g) return art.itemName(g.item) || '';
  const s = link.room.spillAt(map, x, y);
  if (s?.person) {
    const row = s.bag.items[0], mon = s.bag.mons?.[0];
    return row ? art.itemName(row.id) || '' : mon ? speciesName(mon.species) : '';
  }
  if (s) return spillName(s, "'s BAG", (id) => art?.itemName(id) ?? '');
  return '';
}
function iconOn(map: string, x: number, y: number): HTMLCanvasElement | null {
  const tr = link.room.traderAt(map, x, y);
  if (tr?.t.species) return monIconOf(tr.t.species);
  const g = link.room.groundAt(map, x, y);
  if (g) return itemIconOf(g.item);
  const s = link.room.spillAt(map, x, y);
  if (s?.person) return s.bag.items[0] ? itemIconOf(s.bag.items[0].id) : s.bag.mons?.[0] ? monIconOf(s.bag.mons[0].species) : null;
  const mons = s ? s.bag.mons ?? [] : [];
  return mons.length && !s!.bag.items.length && !s!.bag.money ? monIconOf(mons[0].species) : null;
}
/** An item's picture off the sheet the BAG draws from, as a canvas the tag can hold on to. */
const itemSheet = new Image();
itemSheet.src = '/ui/items.png';
const itemIcons = new Map<number, HTMLCanvasElement>();
function itemIconOf(item: number): HTMLCanvasElement | null {
  let c = itemIcons.get(item);
  if (c) return c;
  if (!itemSheet.complete || !itemSheet.naturalWidth) return null;
  const { cell, cols } = uiData.itemIcons as { cell: number; cols: number };
  c = document.createElement('canvas');
  c.width = c.height = cell;
  c.getContext('2d')!.drawImage(itemSheet, (item % cols) * cell, Math.floor(item / cols) * cell, cell, cell, 0, 0, cell, cell);
  itemIcons.set(item, c);
  return c;
}
/** Where the mouse is, for the tag over what it rests on. */
let hover: { x: number; y: number } | null = null;
if (matchMedia('(pointer: fine)').matches) {
  const world = document.getElementById('world')!;
  world.addEventListener('pointermove', (e) => { hover = { x: e.clientX, y: e.clientY }; });
  world.addEventListener('pointerleave', () => { hover = null; });
}
/** The name by the thing (Cam, 11-02): over what I face or stand on, as the live match holds
 *  its line (br_loot.c HoldLineForReach; Cam, 10-31: "doesn't show item description when I'm
 *  facing it"), or what the mouse rests on anywhere in view. */
function tagFrame(): void {
  const blocked = !art || !link || battle || swapping || asking || casting || battleEl.classList.contains('on');
  let hit: { text: string; map: string; x: number; y: number } | null = null;
  watchOffer = 0;
  if (!blocked && spectating && !watch.replaying) {
    const f = fightOffer();
    if (f) {
      watchOffer = f.id;
      const dpr = devicePixelRatio || 1;
      itemTag.show('WATCH', ((f.x - cam.x) * zoom) / dpr + innerWidth / 2, ((f.y - cam.y) * zoom) / dpr + innerHeight / 2);
      return;
    }
  }
  if (!blocked) {
    const dpr = devicePixelRatio || 1;
    if (hover) {
      const wx = cam.x + (hover.x * dpr - devW / 2) / zoom, wy = cam.y + (hover.y * dpr - devH / 2) / zoom;
      const p = mapUnder(wx, wy);
      if (p) {
        const x = Math.floor(wx / TILE) - p.gx, y = Math.floor(wy / TILE) - p.gy;
        const text = nameOn(p.m.id, x, y);
        if (text) hit = { text, map: p.m.id, x, y };
      }
    }
    const a = isOut || spectating ? undefined : link.mine();
    if (!hit && a) {
      const { map, x, y } = a.m.spot;
      const d = ({ 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] } as Record<number, number[]>)[a.m.facing] ?? [0, 0];
      for (const [cx, cy] of [[x + d[0], y + d[1]], [x, y]]) {
        const text = nameOn(map, cx, cy);
        if (text) { hit = { text, map, x: cx, y: cy }; break; }
      }
    }
  }
  const g = hit && global({ map: hit.map, x: hit.x, y: hit.y });
  if (!hit || !g) { itemTag.hide(); return; }
  const dpr = devicePixelRatio || 1;
  itemTag.show(hit.text, ((g.gx * TILE + TILE / 2 - cam.x) * zoom) / dpr + innerWidth / 2, ((g.gy * TILE - cam.y) * zoom) / dpr + innerHeight / 2, iconOn(hit.map, hit.x, hit.y));
}

/** The trainer the WATCH tag is over, for A (0: none up). */
let watchOffer = 0;
/** How near the camera, in world pixels, a fight has to be for the tag without a mouse on it. */
const WATCH_NEAR = 6 * TILE;
/** The fight a trainer watching could go into (Cam, 11-02: "let's just show a tooltip that says
 *  watch that will flag to the player"): the one under the mouse, or else the nearest the camera.
 *  One tag between the two of them, over their heads. */
function fightOffer(): { id: number; x: number; y: number } | null {
  const dpr = devicePixelRatio || 1;
  const mouse = hover ? { x: cam.x + (hover.x * dpr - devW / 2) / zoom, y: cam.y + (hover.y * dpr - devH / 2) / zoom } : null;
  let best: Actor | null = null;
  let bestD = Infinity;
  for (const a of actors()) {
    if (!a.battling) continue;
    const p = pixelOf(a);
    const d = Math.min(mouse ? Math.hypot(p.x + TILE / 2 - mouse.x, p.y - mouse.y) * WATCH_NEAR / (24 / Math.min(1, zoom)) : Infinity, Math.hypot(p.x + TILE / 2 - cam.x, p.y - cam.y));
    if (d < bestD && d <= WATCH_NEAR) { best = a; bestD = d; }
  }
  if (!best) return null;
  const p = pixelOf(best);
  const foe = best.foe ? actors().find((o) => o.id === best!.foe) : undefined;
  const q = foe && Math.hypot(pixelOf(foe).x - p.x, pixelOf(foe).y - p.y) <= 3 * TILE ? pixelOf(foe) : p;
  return { id: best.id, x: (p.x + q.x) / 2 + TILE / 2, y: Math.min(p.y, q.y) - TILE };
}
/** A at the tag: the camera on them, and their fight comes up. */
function takeWatchOffer(): void {
  if (follow === watchOffer) watch.askAgain();
  else { follow = watchOffer; if (zoom < 1) zoom = playZoom(); }
}

/** How long a dug-up item's name holds the box (Cam, 11-01: "the found covers over what
 *  you're picking up"). */
const FOUND_MS = 1000;
/** How long a gift's line is up before its screen. */
const GIFT_LINE_MS = 900;

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
  // Somebody says so first, and it can be read before their screen comes up (Cam, 11-01:
  // "there should be a dialogue box when I talk to somebody").
  const line = `Here, take this ${name(item)}!`;
  if (screen) { if (gift) say(line); romUp = true; }
  const said = screen && gift ? new Promise((done) => setTimeout(done, GIFT_LINE_MS)) : Promise.resolve();
  const r = rom;
  let taught = false;
  // Who gets it is the windows'; BACK keeps it in the bag.
  const who = () => askParty(name(item), isMachine(item) ? (m) => takesMachine(m, item) : undefined);
  // Into the bag first, and from there it is what the BAG's USE or GIVE does: the ROM's own
  // opening of its party for a thing just given did not always come (about half the time on
  // the agbcc build). In the bag before anybody is asked, and saved so, so a reload at the
  // question still has it (remember).
  const bagged = screen ? r.give(item, 1) : null;
  const took = bagged
    ? Promise.all([bagged, said]).then(async ([got]) => {
      if (!got?.items.some((g) => g.id === item)) return got;
      remember(true);
      const slot = await who();
      if (slot === null) return got;
      if (isMachine(item)) {
        // The page's own write, as the team's MOVES teaches (learn): the ROM's screens were the wait.
        const move = TMHM_MOVES[item - ITEM_TM01];
        if (await learn(slot, move, item, () => askForget(slot, move))) taught = true;
        remember(true);
        return got;
      }
      const was = battleMenu?.heldBy(slot) ?? 0;
      if (await r.take(item)) await r.setHeld(slot, item);
      if (was) await r.give(was, 1);
      return { ...got, items: readPocket(r.emu, romTables.sym, 0).some((x) => x.item === item) ? got.items : [] };
    }).finally(() => { romUp = false; battleEl.classList.remove('on'); })
    : r.give(item, groundCount(item));
  took.then((got) => {
    if (got) myTookN++;
    // What the ROM made of it (br_items.c's Apply), not what was on the ground.
    if (!got) {
      say(`No room in the bag for ${name(item)}.`);
      if (hidden) dug.delete(hidden); // still buried
      else link.drop(key); // it stays where it lay
    } else if (screen) {
      rom?.sound(MUS_OBTAIN_TMHM);
      const kept = isMachine(item) ? !taught : got.items.some((g) => g.id === item);
      if (kept) say(`${name(item)} went in the BAG.`);
      else if (!gift) say(`Taught ${name(item)}!`);
    }
    else if (got.items.length) {
      rom?.sound(MUS_OBTAIN_ITEM);
      // A ball's tag named it and the jingle says it was taken: no "Found X" (POK-440, Cam:
      // "we're saying a little too much at the bottom"). Dug up, nothing named it first.
      if (gift) say(line, FOUND_MS);
      else if (hidden) say(`${got.items.map((g) => `${g.n > 1 ? `${g.n} ` : ''}${name(g.id)}`).join(', ')} went in the BAG.`, FOUND_MS);
    }
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
  if (!asking || bagPanel || mapWindow) return;
  // The window's own size, not the field's: a player zoomed out still has to read and tap it.
  const scale = fitZoom() / (devicePixelRatio || 1);
  const labels = asking.rows.map(([label]) => label);
  if (asking.start) {
    // My own SAFARI BALLs: not on a watcher's peek, which is somebody else's START.
    const balls = link.room.ring().safari && rom && !spectating ? rom.safariBalls() : null;
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
  if (mapWindow) { mapWindow.key(k); return; }
  if (bagPanel) { bagPanel.key(k); return; }
  const r = asking.roller;
  if (r) {
    if (k !== 'b' && k !== 'start') rom?.sound(SE_SELECT);
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
  if (k === 'up' || k === 'down' || k === 'a') rom?.sound(SE_SELECT);
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
    document.body.classList.add('ask-up');
    asking = { pick: 0, start, title, rows, ...more, done: (c) => { asking = null; document.body.classList.remove('ask-up'); startMenu.hide(); askBox.hide(); calmUntil = frame + 30; resolve(c); } };
    askPaint();
  });
}

/** The page's MAP (mapwindow.ts): the answer is the place chosen, null for BACK or a fight. */
let mapWindow: MapWindow | null = null;
function openMapWindow(o: { verb: string | null; can(p: MapPlace): boolean; prompt(): string; back: boolean; until?: number }): Promise<MapPlace | null> {
  return new Promise((resolve) => {
    const me = link.room.actor(link.me);
    if (!ringMap || !art || !me) { resolve(null); return; }
    if (regionPixels === undefined) {
      const cv = art.regionMap();
      regionPixels = cv ? cv.getContext('2d')!.getImageData(0, 0, 240, 160) : null;
    }
    if (!regionPixels) { resolve(null); return; }
    const map = ringMap;
    let picked: MapPlace | null = null;
    let timer = 0;
    held.clear();
    document.body.classList.add('panel-up');
    asking = {
      pick: 0, start: false, title: '', rows: [],
      done: () => {
        asking = null;
        clearTimeout(timer);
        mapWindow?.close();
        mapWindow = null;
        document.body.classList.remove('panel-up');
        calmUntil = frame + 30;
        resolve(picked);
      },
    };
    const gfxOf = (skin: number) => SKIN_GFX[skin] ?? SKIN_GFX[0];
    const start = map.cellOf(me.m.spot);
    mapWindow = new MapWindow(document.getElementById('map-window')!, {
      picture: regionPixels,
      fogAt: (x, y, next) => {
        const ring = link.room.ring();
        return map.fogAt(x, y, next && ring.next !== undefined && ring.next !== Infinity ? { ...ring, r: ring.next } : ring);
      },
      fogKey: () => {
        const ring = link.room.ring();
        // The next ring's line only while the fog moves in to it (Cam, 11-10: "only show the fog
        // ring on the map as the fog is actively closing in. It shouldn't show on initial drop").
        const next = ring.next !== undefined && ring.next !== Infinity && fogClosing(ring) ? `${ring.next}|${ring.cx.toFixed(0)}|${ring.cy.toFixed(0)}` : '';
        return { key: `${ring.last}|${ring.r.toFixed(1)}|${ring.cx.toFixed(0)}|${ring.cy.toFixed(0)}`, next };
      },
      placeAt: (cx, cy) => map.placeAt(cx, cy),
      plots: () => map.plots({ spot: me.m.spot, gfx: gfxOf(me.skin) }),
      head: (gfx) => {
        const s = sheet(gfx);
        return s ? { img: s, w: SHEETS[String(gfx)].w, h: SHEETS[String(gfx)].h } : null;
      },
      verb: o.verb,
      can: o.can,
      prompt: o.prompt,
      back: o.back ? () => asking?.done('') : null,
      choose: (p) => { picked = p; rom?.sound(SE_SELECT); asking?.done(''); },
      moved: () => rom?.sound(SE_SELECT),
      fit: () => mapFit(touchPad, glass(), windowScale()),
      start,
    });
    // The drop's clock: the place under the cursor is the choice, as br_pick.c's timeout has it.
    if (o.until !== undefined) timer = window.setTimeout(() => {
      const c = mapWindow?.cursor;
      picked = c ? map.placeAt(c.x, c.y) : null;
      asking?.done('');
    }, o.until - performance.now());
  });
}

/** The MAP off the menu or the minimap: a look, and with somebody who could FLY, a flight to a
 *  town (room.ts `fly`), straight there rather than through the hidden ROM. */
async function lookAtMap(): Promise<void> {
  const r = rom, map = ringMap;
  if (!r || !map) return;
  const team = await r.fameTeam();
  if (rom !== r || asking || battle || swapping || isOut) return;
  // Not out of the Zone before the drop: its gate is shut both ways (room.ts `fly`).
  const fly = couldFly(team) && !link.room.ring().safari;
  const spotOf = (p: MapPlace) => map.mapsIn(p.id).find((m) => FLY_SPOTS[m]);
  const safe = () => { const s = map.place(); return s ? `Safe: ${s}` : ''; };
  const place = await openMapWindow({
    verb: fly ? 'FLY' : null,
    can: (p) => !!spotOf(p),
    prompt: safe,
    back: true,
  });
  const to = place && spotOf(place);
  if (!to) return;
  const [x, y] = FLY_SPOTS[to];
  link.fly(to, x, y);
}

/** A at a dropped bag: what it holds, the way the match asks (br_loot.c's TryTake). What
 *  is left goes back down as the bag, for somebody else (POK-294: nothing leaves). */
let bagPanel: BagPanel | null = null;
/** The windows over the map for a dropped bag (bagpanel.ts): the keys and a pad go to them
 *  through `asking`, which also shuts them when a fight comes. */
function askBag(who: string, bag: Bag, species: number | undefined): Promise<string> {
  return new Promise((resolve) => {
    const a = art;
    held.clear();
    document.body.classList.add('panel-up');
    asking = {
      pick: 0, start: false, title: '', rows: [],
      done: (c) => {
        asking = null;
        bagPanel?.close();
        bagPanel = null;
        document.body.classList.remove('panel-up');
        calmUntil = frame + 30;
        resolve(c);
      },
    };
    bagPanel = new BagPanel(document.getElementById('bag-panel')!, {
      who,
      mons: species !== undefined,
      items: bag.items.map((s) => ({ id: s.id, n: s.n, name: a?.itemName(s.id) || `item ${s.id}` })),
      money: bag.money,
      bag: () => bagArtOf(),
      icon: () => (species !== undefined ? monIconOf(species) : null),
      done: (c) => asking?.done(c),
      scale: windowScale(),
    }, !touchPad);
  });
}

/** The dropped bag I have open, so it stays drawn while I look (carry.ts spillShows). */
let bagOpen = 0;
async function openBag(key: number, bag: Bag, who: string): Promise<void> {
  bagOpen = key;
  // Level 0 is the DAY CARE's chest (room.ts placeChest): the rung the match is at now.
  const rung = rungForPhase(link.room.ring().phase + 1);
  const mons = (bag.mons ?? []).map((m) => (m.level > 0 ? m : { ...m, level: rung }));
  const things = bag.items.length > 0 || bag.money > 0;
  const c = mons.length && !things ? 'mons' : await askBag(who, bag, mons[0]?.species);
  if (c === 'items') { myTookN++; return takeBag(key, bag, who); }
  if (c !== 'mons' || isOut || !rom) { link.drop(key, bag); return; }
  const left = await dropPanel(who, mons);
  if (left.length < mons.length) myTookN++;
  const rest: Bag = { items: bag.items, money: bag.money, mons: left };
  if (!emptyBag(rest)) link.drop(key, rest);
  else bagOpen = 0;
}

/** START: the match's own menu rows on the ROM's screens (start_menu.c's MENU_ACTION_*),
 *  asked here first so the hidden field never shows. MAP (13) is the ROM's, standing where
 *  I stand, with this world's fog laid over it (ringmap.ts). */
async function openMenu(): Promise<void> {
  if (spectating && !battle && !swapping && !asking) return void peek();
  if (!rom || isOut || battle || swapping || asking || spectating) return;
  // The ROM's rows (start_menu.c): POKéMON once I have one, no MAP in the Safari. No trainer
  // card (Cam, 11-02). A phone has the room on its dock, as live.
  rom.sound(SE_WIN_OPEN);
  const rows: [string, string][] = [
    ...(rom.partyCount() > 0 ? [['POKéMON', '1'] as [string, string]] : []),
    ['BAG', '2'],
    ...(ringMap && !link.room.ring().safari ? [['MAP', '13'] as [string, string]] : []),
    ...(lobby && !touchPad ? [['ROOM', 'room'] as [string, string]] : []),
    ['SAVE LOG', 'savelog'],
    ['EXIT', ''],
  ];
  const c = await ask('MENU', rows, true);
  if (c === 'room') { openSheet(); return; }
  if (c === 'savelog') { saveLog(); return; }
  await runMenu(c);
}

// ---- PARTY and BAG on the field, on the battle's own windows ------------------------------
let panelUp = false;
let summaryWin: SummaryWindow | null = null;
let movesBox: MovesBox | null = null;

// ---- the key items' dial (ui/radial.ts): a pad's right trigger, C, the round button held -----
const ITEM_ITEMFINDER = 261;
/** A pad's right trigger in the standard layout, unless a remap has put a button of the game's on it. */
const PAD_RT = 7;
const RADIAL_KEY = 'c';
const radial = new Radial({ scale: windowScale, touch: matchMedia('(pointer: coarse)').matches, sound: () => rom?.sound(SE_SELECT) });
/** The word over the round button that it has a dial behind it (ui/dialtip.ts). */
const dialTip = new Tag(document.getElementById('dial-tip') as HTMLCanvasElement);
let dialTipLeft = dialTipDue();
let dialTipUntil = 0;
function dialTipFrame(on: boolean): void {
  if (!dialTipLeft) return;
  if (!on) { dialTip.hide(); return; }
  const now = performance.now();
  if (!dialTipUntil) { dialTipUntil = now + DIAL_TIP_MS; dialTipShown(); }
  const b = document.getElementById('hud-ctx')?.getBoundingClientRect();
  if (now > dialTipUntil) { dialTipLeft = false; dialTip.hide(); }
  else if (b?.width) dialTip.show(dialTipWords(touchPad ? 'touch' : document.body.classList.contains('pad-input') ? 'pad' : 'keys', RADIAL_KEY), b.x + b.width / 2, b.y);
}
/** Riding, or the bike in the bag: SELECT gets on or off where a bike may go (sim.ts). */
function bikeNow(me: Actor): { item: number; label: 'BIKE' | 'WALK'; enabled: boolean; on: boolean } {
  const has = rom ? bagHolds(rom.emu, romTables.sym, KEYITEMS_POCKET, [ITEM_MACH_BIKE, ITEM_ACRO_BIKE]) : new Set<number>();
  const step = link.room.stepFor(me), spot = me.m.spot;
  // The one that SELECT would get on (sim.ts begin), or is on.
  const acro = me.m.bike ? me.m.acro : !step.cycling?.(spot) && !!step.acroCycling?.(spot) || !!step.acroAt?.(spot) || (me.likeAcro ?? acroNear(step, spot)) || (!!has.size && !has.has(ITEM_MACH_BIKE));
  return {
    item: acro ? ITEM_ACRO_BIKE : ITEM_MACH_BIKE,
    label: me.m.bike ? 'WALK' : 'BIKE',
    // No getting off on a rail.
    enabled: me.m.bike ? (step.acroAt?.(spot) ?? 0) < 2 : !!step.cycling?.(spot) || !!step.acroCycling?.(spot),
    // Lit while riding, on a desktop and a phone (Cam, 11-04: "let's have it highlight to show that it's in use").
    on: !!me.m.bike,
  };
}
/** One bike's cell on the dial: WALK, lit, on the one ridden; the other changes bikes where it may
 *  go (useKeyItem, as the BAG's USE). */
function bikeCell(me: Actor, item: number, side: 'up' | 'upright'): DialItem {
  const acro = item === ITEM_ACRO_BIKE, step = link.room.stepFor(me), spot = me.m.spot;
  const same = !!me.m.bike && !!me.m.acro === acro, rail = (step.acroAt?.(spot) ?? 0) >= 2;
  const here = !!step.cycling?.(spot) || (acro && !!step.acroCycling?.(spot));
  return {
    side,
    item,
    label: same ? 'WALK' : acro ? 'ACRO' : 'MACH',
    enabled: !(me.m.bike && rail) && (same || here),
    why: me.m.bike && rail ? "Can't get off here." : "Can't ride here.",
    go: () => void useKeyItem(item),
  };
}
/** What SELECT would do with the rod here: casts it facing water, on foot or surfing (room.ts). */
const rodReady = (me: Actor) => !me.m.bike && classAt(aheadOf(me)) === CLASS_WATER;
const pressSelect = () => { selectUntil = frame + 40; };
/** The key items that do something on the field, each on its own side of the dial. */
function dialItems(me: Actor): DialItem[] {
  const out: DialItem[] = [];
  // Both bikes in the bag, both on the dial (Cam, 11-10): the MACH BIKE up, the ACRO BIKE in the
  // corner beside it. One, or none yet, up: the one SELECT would ride.
  const has = rom ? bagHolds(rom.emu, romTables.sym, KEYITEMS_POCKET, [ITEM_MACH_BIKE, ITEM_ACRO_BIKE]) : new Set<number>();
  if (has.size === 2) {
    out.push(bikeCell(me, ITEM_MACH_BIKE, 'up'), bikeCell(me, ITEM_ACRO_BIKE, 'upright'));
  } else {
    const bike = bikeNow(me);
    out.push({ side: 'up', ...bike, why: "Can't ride here.", go: pressSelect });
  }
  const rod = rom?.rod() ?? 0;
  if (rodOf(rod) >= 0) out.push({ side: 'right', item: rod, label: 'FISH', enabled: rodReady(me), why: me.m.bike ? 'Off the bike first.' : 'Face the water.', go: pressSelect });
  // The MAP and FLY are one screen (lookAtMap): one side, named for what it will do.
  if (ringMap && !link.room.ring().safari) out.push({ side: 'down', item: ITEM_TOWN_MAP, label: couldFly(readTeam()) ? 'FLY' : 'MAP', enabled: true, go: () => void lookAtMap() });
  if (rom && bagHolds(rom.emu, romTables.sym, KEYITEMS_POCKET, [ITEM_ITEMFINDER]).size) out.push({ side: 'left', item: ITEM_ITEMFINDER, label: 'ITEMFINDER', enabled: true, go: itemfinder });
  return out;
}
function openDial(finger?: { x: number; y: number }): void {
  const me = link?.room.actor(link.me);
  if (!me || !rom || isOut || spectating || battle || swapping || romUp || asking || casting || intro() || lobby?.shown || me.battling) return;
  held.clear();
  pressed.clear();
  rom.sound(SE_WIN_OPEN);
  dialKnown();
  dialTipLeft = false;
  dialTip.hide();
  radial.open(dialItems(me));
  if (finger) radial.fingerFrom(finger.x, finger.y);
}
/** A key item USEd off the BAG that works on this world, not the hidden ROM's field, where it
 *  did nothing to see (Cam, 11-02: "Acro bike use. Is it doing anything?"): out, and do it. */
function useKeyItem(item: number): boolean {
  const me = link?.room.actor(link.me);
  if (!me) return false;
  if (item === ITEM_MACH_BIKE || item === ITEM_ACRO_BIKE) {
    closePanel();
    const acro = item === ITEM_ACRO_BIKE, step = link.room.stepFor(me), spot = me.m.spot, same = me.m.bike && me.m.acro === acro;
    // gText_CantDismountBike: on a rail, whichever bike was asked for.
    if (me.m.bike && (step.acroAt?.(spot) ?? 0) >= 2) { say("You can't dismount your BIKE here."); return true; }
    if (!same && !step.cycling?.(spot) && !(acro && step.acroCycling?.(spot))) { say("There's a time and place for everything! But not now."); return true; }
    link.ride(acro);
    // Riding the other, the room changes bikes itself.
    if (!me.m.bike || same) pressSelect();
    return true;
  }
  if (item === ITEM_ITEMFINDER) {
    closePanel();
    itemfinder();
    return true;
  }
  if (rodOf(item) >= 0) {
    closePanel();
    if (rodReady(me)) pressSelect(); else say('Face the water to fish.');
    return true;
  }
  return false;
}
/** The party as the windows read it. */
let readTeam: () => PartyMember[] = () => [];
let readMon: (mon: Uint8Array) => PartyMember | null = () => null;
/** What this one could learn now: its learnset, then the machines in the bag (ui/movesbox.ts). */
function learnRows(m: { species: number; level: number; moves: readonly { id: number }[] }): LearnRow[] {
  return learnList(romTables, m, rom ? readPocket(rom.emu, romTables.sym, POCKET_TMHM).map((s) => s.item) : []);
}
/** One learned, by the page's own write (br_moves.c and move_relearner.c's rules): four known asks
 *  which goes, on the windows, and a move that only a TM gave goes back in the bag; a TM that
 *  taught it is spent, an HM is not. BACK at the question keeps the four. */
async function teach(slot: number, row: LearnRow, menu: BattleMenu): Promise<void> {
  const up = panelUp;
  const taught = await learn(slot, row.move, row.machine, async () => {
    const pick = await askForget(slot, row.move);
    if (!panelUp || !up) return null;
    // Its windows closed themselves: back behind the box.
    battleEl.classList.add('panel');
    menu.openField('party');
    menu.showMember(slot);
    return pick;
  });
  if (taught) { rom?.sound(SE_USE_ITEM); remember(true); }
}
/** `move` into `slot`'s four, by the page's write: four known, `forget` says which goes (null keeps
 *  them). A TM that taught it is spent, an HM is not, and a forgotten move only a TM gave goes back
 *  in the bag. Whether it learned it. A TM off the ground came this way too, not through the hidden
 *  ROM's START, BAG and party, which held the field still 1.7 s on a desktop (Cam, 11-09: "delays
 *  when picking up an item or teaching it"). */
async function learn(slot: number, move: number, machine: number, forget: () => Promise<number | null>): Promise<boolean> {
  const r = rom;
  const m = readTeam()[slot];
  if (!r || !m || m.moves.some((x) => x.id === move)) return false;
  let at = m.moves.length;
  if (at >= 4) {
    const pick = await forget();
    if (pick === null || rom !== r) return false;
    at = pick;
  }
  const gone = at < m.moves.length ? m.moves[at].id : 0;
  await r.setMove(slot, at, move, moveInfo(romTables, move)?.pp ?? 0);
  if (gone) {
    const tm = TMHM_MOVES.indexOf(gone) + ITEM_TM01;
    const isTm = tm >= ITEM_TM01 && tm < ITEM_HM01;
    if (isTm && !learnsByNow(romTables, m.species, m.level, gone) && !readPocket(r.emu, romTables.sym, POCKET_TMHM).some((s) => s.item === tm)) {
      await r.give(tm, 1);
      say(`${moveInfo(romTables, gone)?.name ?? 'It'} went in the BAG.`);
    }
  }
  if (machine && machine < ITEM_HM01) await r.take(machine);
  return true;
}
function openPanel(home: 'party' | 'bag'): void {
  if (!battleMenu) return;
  swapping = true;
  panelUp = true;
  held.clear();
  battleEl.classList.remove('screen', 'see', 'fight');
  battleEl.classList.add('on', 'panel');
  dispatchEvent(new Event('resize'));
  battleMenu.openField(home);
}
function closePanel(): void {
  if (!panelUp) return;
  panelUp = false;
  battleMenu?.closeField();
  battleEl.classList.remove('on', 'panel');
  swapping = false;
  held.clear();
  pressed.clear();
  calmUntil = frame + 30;
  panelDone?.();
}
/** ui/taken.ts, its own chunk: main is at its budget (vite.config.ts), and only a SUMMARY off the
 *  ground asks. Fetched as the page starts; until it comes, that SUMMARY has no moves to show. */
let takenLib: typeof import('../src/ui/taken') | null = null;
void import('../src/ui/taken').then((m) => { takenLib = m; }, (e) => console.warn('spike taken', e));
/** What taking this one would make of it (ui/taken.ts), for its SUMMARY: `at` is its place on the team
 *  screen, whose key seeds it, or null for a trader's, which the ROM rolls when he hands it over. Under
 *  the rung it comes up to the rung (br_loot.c MakeTaken). */
function joinsAs(species: number, level: number, at: number | null): NonNullable<PartyMember['joins']> {
  const was = Math.max(level, rungForPhase(link.room.ring().phase + 1));
  const lib = takenLib;
  const t = lib?.takenMon(romTables, species, was, at === null || !rom ? null : lib.teamSeed(rom.matchSeed(), at), rom?.localHour(), Math.min(5, link.room.ring().phase));
  if (!lib || !t) return { species, name: speciesName(species), level: was, moves: [] };
  return { species: t.species, name: speciesName(t.species), level: t.level, moves: t.moves.map((id) => { const pp = lib.fullPp(romTables, id); return { id, pp, maxPp: pp }; }) };
}
/** The one who just joined knows what its SUMMARY said (ui/taken.ts says why it might not yet): by the
 *  party against what it was, unless it came out another species, which SUMMARY got wrong anyway. */
async function sayWhatItSaid(before: PartyMember[], joins: NonNullable<PartyMember['joins']>): Promise<void> {
  const after = readTeam();
  const slot = after.findIndex((m, i) => m.species !== before[i]?.species || JSON.stringify(m.moves) !== JSON.stringify(before[i]?.moves));
  const m = after[slot];
  if (!rom || !m || m.species !== joins.species || m.moves.map((v) => v.id).join() === joins.moves.map((v) => v.id).join()) return;
  await rom.dealMoves(slot, joins.moves);
}
/** A dropped team on the windows: taken one at a time, each through the ROM's own screen unseen.
 *  What is still on the ground comes back. */
let panelDone: (() => void) | null = null;
function dropPanel(who: string, mons: TeamRow[]): Promise<TeamRow[]> {
  let left = mons;
  const rows = () => left.map((m, at) => ({ species: m.species, name: speciesName(m.species), level: m.level, hp: 1, maxHp: 1, status: 0, item: 0, itemName: '', ability: '', moves: [], active: false, joins: joinsAs(tradedInto(m.species), m.level, at) }));
  return new Promise((resolve) => {
    if (!battleMenu || !rom) { resolve(left); return; }
    swapping = true;
    panelUp = true;
    held.clear();
    battleEl.classList.remove('screen', 'see', 'fight');
    battleEl.classList.add('on', 'panel');
    dispatchEvent(new Event('resize'));
    panelDone = () => { panelDone = null; resolve(left); };
    const show = () => battleMenu!.openDrop(who, rows(), take, closePanel);
    const take = (at: number, give?: number) => {
      battleMenu!.hideField();
      const before = readTeam(), joins = rows()[at]?.joins;
      void rom!.team(left, who, () => {}, () => {}, { take: at, give }).then(async (rest) => {
        left = rest;
        if (joins) await sayWhatItSaid(before, joins);
        if (!panelUp) return;
        if (left.length) show(); else closePanel();
      });
    };
    show();
  });
}
/** A new move and four known: which goes, on the windows, over the ROM's screen unseen. */
function askForget(slot: number, move: number): Promise<number | null> {
  return new Promise((resolve) => {
    if (!battleMenu) { resolve(null); return; }
    const wasOn = battleEl.classList.contains('on');
    battleEl.classList.remove('screen', 'see', 'fight');
    battleEl.classList.add('on', 'panel');
    const up = panelUp;
    panelUp = true;
    dispatchEvent(new Event('resize'));
    battleMenu.openForget(slot, moveInfo(romTables, move)?.name ?? '', (row) => {
      battleMenu!.closeField();
      panelUp = up;
      battleEl.classList.remove('panel');
      if (!wasOn) battleEl.classList.remove('on');
      resolve(row);
    }, move);
  });
}
romAsks.forget = askForget;
/** A catch with a full party (br_catch.c): who gives way for it, or nobody and it goes, on the
 *  windows, over the ROM's field and its question, which are walked unseen on the answer. Nothing
 *  of them changes until then: the one released lands beside the trainer (endBattle). */
function askRelease(mon: Uint8Array): Promise<number | null> {
  return new Promise((resolve) => {
    const row = readMon(mon);
    if (!battleMenu || !row) { resolve(null); return; }
    panelUp = true;
    held.clear();
    battleEl.classList.remove('screen', 'see', 'fight');
    battleEl.classList.add('on', 'panel');
    const done = (slot: number | null) => {
      battleMenu!.closeField();
      panelUp = false;
      battleEl.classList.remove('on', 'panel');
      held.clear();
      pressed.clear();
      resolve(slot);
    };
    battleMenu.openRelease(row, done, () => done(null));
    dispatchEvent(new Event('resize'));
  });
}
romAsks.release = askRelease;
/** Which of the party, on the windows; null for BACK. */
function askParty(title: string, can?: (m: PartyMember) => boolean): Promise<number | null> {
  return new Promise((resolve) => {
    if (!battleMenu || !rom || !rom.partyCount()) { resolve(null); return; }
    let slot: number | null = null;
    swapping = true;
    panelUp = true;
    held.clear();
    battleEl.classList.remove('screen', 'see', 'fight');
    battleEl.classList.add('on', 'panel');
    dispatchEvent(new Event('resize'));
    panelDone = () => { panelDone = null; resolve(slot); };
    battleMenu.openPick(title, (at) => { slot = at; closePanel(); }, closePanel, can);
  });
}
/** What is the ROM's alone: the windows stand aside, and come back with what it changed. */
async function panelWalk(run: (r: RomBattles) => Promise<unknown>): Promise<void> {
  if (!rom || !battleMenu) return;
  battleMenu.hideField();
  battleEl.classList.remove('panel', 'on');
  try {
    await run(rom);
  } finally {
    battleEl.classList.remove('on', 'screen', 'see', 'fight');
    if (panelUp) {
      battleEl.classList.add('on', 'panel');
      battleMenu.reshowField();
    }
    held.clear();
    pressed.clear();
  }
}
const panelShow = () => { if (panelUp) battleEl.classList.add('on'); };
const panelHide = () => battleEl.classList.remove('on');
/** Whatever screen is open closes: a menu is no hiding place. */
function leaveScreen(): void {
  closePanel();
  rom?.leave();
}

/** START while watching (Kanto's peek): the trainer watched's POKéMON and BAG, read-only
 *  -- their team with levels, HP and moves, their bag and money. A player's is what their
 *  page last told the room (refreshed every few seconds, `team`); a bot's is dealt from
 *  the seed, as its fights are, and its bag is what it picked up on its way. */
async function peek(): Promise<void> {
  const id = follow;
  const a = id ? link.room.actor(id) : undefined;
  rom?.sound(SE_WIN_OPEN);
  const r = link.room;
  const team: FameMon[] = !a ? [] : a.bot
    ? wornParty(botParty(r.seed, a, r.ring().phase + 1), a.wear).map((m) => ({ species: m.species, level: m.level, hp: m.hp, maxHp: m.maxHp, moves: m.moves.map((v: { id: number }) => ({ id: v.id })) }))
    : link.teams.get(a.id) ?? [];
  const bag: PeekBag | undefined = !a ? undefined : a.bot ? { items: (a.loot?.items ?? []).map((s) => ({ id: s.id, n: s.n })), money: a.loot?.money ?? 0 } : link.bags.get(a.id);
  for (;;) {
    // LEAVE: what the strip's button does, for a pad and a keyboard (it has no focus to reach it by).
    const c = await ask(a?.name ?? 'WATCHING', [...(a ? [['POKéMON', 'mons'], ['BAG', 'bag']] as [string, string][] : []), ['SAVE LOG', 'savelog'], ...(isOut || waiting ? [['LEAVE', 'leave']] as [string, string][] : []), ['EXIT', '']], true);
    if (c === 'savelog') { saveLog(); return; }
    if (c === 'leave') { askToLeave(); return; }
    if (!a) return;
    if (c === 'mons') {
      if (!team.length) { await ask(`${a.name} has not told their team yet.`, [['OK', '']]); continue; }
      for (;;) {
        const rows = team.map((m, i): [string, string] => [`${speciesName(m.species)} Lv${m.level}${m.maxHp ? ` ${m.hp ?? m.maxHp}/${m.maxHp}` : ''}`, String(i + 1)]);
        const p = await ask(`${a.name}'s POKéMON`, rows);
        if (!p) break;
        const m = team[Number(p) - 1];
        const moves = (m.moves ?? []).map((v): [string, string] => [moveInfo(romTables, v.id)?.name ?? `MOVE ${v.id}`, '']);
        await ask(`${speciesName(m.species)}'s moves`, moves.length ? moves : [['-', '']]);
      }
    } else if (c === 'bag') {
      if (!bag) { await ask(`${a.name} has not told their bag yet.`, [['OK', '']]); continue; }
      const rows = bag.items.map((s): [string, string] => [`${art?.itemName(s.id) || `item ${s.id}`} x${s.n}`, '']);
      await ask(`${a.name}'s BAG  ¥${bag.money}`, rows.length ? rows : [['(nothing)', '']]);
    } else return;
  }
}

/** A row of the START menu (start_menu.c's MENU_ACTION_*) on the ROM's own screen: what
 *  MENU picked, or the phone dock's PARTY and MAP straight away. */
async function runMenu(c: string): Promise<void> {
  if (!c || !rom || isOut || battle || swapping || asking || spectating) return;
  if (c === '13') { void lookAtMap(); return; }
  if ((c === '1' || c === '2') && battleMenu) {
    if (c === '1' && rom.partyCount() === 0) { say('You have no POKeMON yet.'); return; }
    openPanel(c === '1' ? 'party' : 'bag');
    return;
  }
  swapping = true;
  held.clear();
  try {
    const { said } = await rom.menu(Number(c), () => {
      if (!swapping) return;
      battleEl.classList.add('on');
    }, () => { battleEl.classList.remove('on'); });
    if (said) say(said);
  } finally {
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

/** The ferry (br_story.c): Lilycove's attendant sails to Slateport and to an island a
 *  live story is on, and its sailor sails back; Slateport's sails to Lilycove, and
 *  MR. BRINEY between his three stops (room.ts BOATS), and each CABLE CAR station's
 *  attendant the one way it goes (Route112_CableCarStation_EventScript_Attendant). Bots
 *  never take it. */
async function ferry(to: { id: string; name: string }[], home: boolean, briney: boolean, cable?: 'up' | 'down'): Promise<void> {
  if (cable) {
    if (await ask(`The CABLE CAR is ready to go ${cable}.\nWould you like to be on it?`, [['YES', 'y'], ['NO', '']]) !== 'y') {
      say('Please ride with us another time.');
      return;
    }
    say('Please step this way.');
    link.sail(to[0].id);
    return;
  }
  if (home) {
    if (await ask('Sail back to LILYCOVE CITY?', [['YES', 'y'], ['NO', '']]) === 'y') link.sail('');
    return;
  }
  if (!to.length) { say('The ferry is not sailing anywhere right now.'); return; }
  const c = await ask(briney ? 'MR. BRINEY: Ahoy! Now, my friend, where are we bound?' : 'Where would you like to sail?', [...to.map((t): [string, string] => [t.name, t.id]), ['CANCEL', '']]);
  if (c) link.sail(c);
}

/** The SS TIDAL's crossing (room.ts TIDAL), in SSTidalCorridor/scripts.inc's words: the
 *  box takes two lines, so a two-page line says its last page. */
const TIDAL_SAYS = {
  currents: 'We hope you enjoy your voyage with us.\nFeel free to explore the ship.',
  enjoy: 'We hope you enjoy your voyage on\nour ferry.',
  lilycove: 'We have made land in LILYCOVE CITY.\nThank you for sailing with us.',
  slateport: 'We have made land in SLATEPORT CITY.\nThank you for sailing with us.',
  rest: "You can rest up in your cabin if you'd\nlike. Your cabin's No. 2.",
};
async function cruise(what: 'board' | 'halfway' | 'land' | 'sailor', c: Cruise, bed: boolean): Promise<void> {
  if (bed) {
    // SSTidalRooms_EventScript_Bed: a rest, and the team healed (OutOfCenterPartyHeal).
    say('There\'s a bed…\nLet\'s take a rest.');
    if (rom && !isOut) await rom.heal();
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (what === 'sailor') {
    if (c.leg !== 'land') { say(TIDAL_SAYS.rest); return; }
    say("We've arrived!");
    link.sail(c.to);
    return;
  }
  // Out of Slateport, and Lilycove's second half, are the fast currents' (SetSSTidalFlag's).
  if (what === 'board' || what === 'halfway') say((c.to === 'lilycove') === (what === 'board') ? TIDAL_SAYS.currents : TIDAL_SAYS.enjoy);
  else say(TIDAL_SAYS[c.to]);
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
  else bagOpen = 0;
}

/** What the room started for me: A at a bot, or a marked spot I landed on (the room took
 *  it as the battle started, as BrPatch_Take does), or A at an item ball. */
function startFor(e: RoomEvent): void {
  if (e.type === 'nurse') { void nurse(); return; }
  if (e.type === 'mart') { void mart(e.map); return; }
  if (e.type === 'trade') { void (e.gives ? gift(e.n, e.species) : trade(e.n, e.species)); return; }
  if (e.type === 'door') { void door(e.n, e.how, !!e.opened); return; }
  if (e.type === 'guarded') { say(`${e.name} guards it!`); return; }
  if (e.type === 'spent') { say(spentLine(e, link.me)); return; }
  if (e.type === 'fish') { cast(e.map, e.x, e.y); return; }
  if (e.type === 'ferry') { void ferry(e.to, !!e.home, !!e.briney, e.cable); return; }
  if (e.type === 'cruise') { void cruise(e.say, e.cruise, !!e.bed); return; }
  // The room took me under or back up; the new map draws itself.
  if (e.type === 'dive') return;
  if (e.type === 'gate') {
    // A story's gate (br_story.c): his own fight in the hidden ROM, past the eight gym
    // leaders (BrStory_StartGate); won, what he held is mine, and lost, it is his again.
    if (swapping) leaveScreen();
    asking?.done('');
    const l = link, key = e.key, fog = inFogNow();
    handOff(null, (r, onStart) => r.boss(LEADERS.length + e.gate, onStart, fog).then((f) => {
      if (f.ok && f.outcome === 1) {
        say(`You beat ${e.name}!`);
        toGive.push({ key, bag: e.bag, name: e.name });
        giveNext();
      } else l.drop(key);
      return f;
    }, (err) => { l.drop(key); throw err; }), { label: { name: e.name, skin: 0 } });
    return;
  }
  if (e.type === 'legend') {
    // Its own battle; caught, it is mine, and anything else puts it back where it stood
    // for the next trainer (Cam: losing to one puts you out, and it goes back for retries).
    if (swapping) leaveScreen();
    asking?.done('');
    const l = link, key = e.key, fog = inFogNow();
    handOff(null, (r, onStart) => r.legend(e.species, e.level, onStart, fog).then((f) => {
      if (!(f.ok && f.outcome === CAUGHT)) l.drop(key);
      return f;
    }, (err) => { l.drop(key); throw err; }), { wild: true });
    return;
  }
  if (e.type === 'bots') { void judgeBots(e.a, e.b, e.legend); return; }
  if (e.type === 'boss') {
    // A gym leader (gyms.ts): their own battle in the hidden ROM; won, the gym's TM and purse.
    if (swapping) leaveScreen();
    asking?.done('');
    const leader = LEADERS[e.n], fog = inFogNow();
    handOff(null, (r, onStart) => r.boss(e.n, onStart, fog).then((f) => {
      if (!f.ok && !f.stalled && f.outcome === 0) say(`${leader.name}: Come back with two POKéMON that can battle!`);
      return f;
    }), { label: { name: leader.name, skin: 0 } });
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
    if (swapping) leaveScreen();
    asking?.done('');
    const foe = link.room.actor(e.foe);
    if (!foe) { link.end(); return; }
    // A bot's team as the match deals it (bots/party.ts): from the seed and its seat, the
    // map it stands on, at the rung, one more mon every two phases.
    // Its grade too (roster.ts). No Zone pool: the ROM deals one at the Safari opening,
    // which this world has not got yet.
    // With the wounds its last fights left it (room.ts wear): bots wear down, as live.
    const party = wornParty(botParty(link.room.seed, foe, link.room.ring().phase + 1), foe.wear);
    const fog = inFogNow(), l = link;
    // And its bag (POK-237): what it picked up, the fight's to spend.
    const items = battleItems(foe.loot?.items ?? []);
    handOff(foe, (r, onStart) => r.fight(foe.name, party, foe.skin, onStart, fog, voiceFor(link.room.seed, foe.id), items).then((f) => {
      // Before the fight's end: the room takes it from the trainer the bot last fought,
      // its wounds and what it spent.
      if (f.foe?.length && l === link) l.wear(foe.id, f.foe.map((m) => (m.maxHp > 0 ? m.hp / m.maxHp : 0)), f.spent);
      return f;
    }));
  } else if (e.type === 'duel') {
    // Another trainer: both ROMs fight it out as a link battle, the blocks through the relay.
    // A menu is no hiding place: whatever screen I have open closes, a question goes unanswered.
    if (swapping) leaveScreen();
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
    handOff(foe, (r, onStart) => r.duel(me.name, foe.name, foe.skin, e.first, wire, onStart, fog, voiceOfMember(foe.id)), { log: e.first, weather: e.weather ?? 0 });
  } else {
    const m = placed.get(e.map)!.m;
    const fog = inFogNow();
    handOff(null, (r, onStart) => r.wild(m.group, m.num, art!.behavior(m.group, m.num, e.x, e.y), onStart, fog), { wild: true });
  }
}

/** Two bots met, or one at a legendary, and the room gave me their fight: both teams as the match deals them,
 *  fought out in the hidden ROM, and the winner told to the room. No answer (no ROM, a
 *  fight that would not end, a draw): 0, and both walk on. */
const LEGEND_SEAT = 255;
async function judgeBots(ida: number, idb: number, legend?: { key: number; species: number; patch?: boolean; zone?: boolean }): Promise<void> {
  const l = link, r = l.room;
  const side = (id: number) => {
    const b = r.actor(id);
    // Each with its wounds and its bag, as in a fight with a trainer (brain.ts begin).
    return { seat: id, party: b ? wornParty(botParty(r.seed, b, r.ring().phase + 1), b.wear) : [], items: battleItems(b?.loot?.items ?? []) };
  };
  // A legendary is a side of one, on a seat the ROM's wire can carry; nobody's in a room this size.
  const foeMon = legend?.patch ? wildMon : legendMon;
  const a = side(ida), b = legend ? { seat: LEGEND_SEAT, party: [foeMon(legend.species, r.ring().phase + 1)], items: [] } : side(idb);
  // This meeting, not the pair: they can be let go (the room's own cap) and meet again,
  // and an answer for the old one would end the new one.
  const since = r.actor(ida)?.since;
  const wanted = () => link === l && !!since && l.room.actor(ida)?.since === since && (legend ? l.room.actor(ida)?.foe === LEGEND_FOE : l.room.actor(idb)?.foe === ida);
  // The Zone's battle has no ROM in it (wild.ts): the throws, and as long as they would take.
  if (legend?.zone) {
    const fought = zoneFight({ seat: ida, name: '', skin: 0, party: a.party, balls: zoneBalls(a.party.length, r.actor(ida)?.zoneThrown) }, legend.species, { seed: (r.seed ^ Math.imul(since ?? 0, 0x9e3779b1) ^ ida) >>> 0 });
    await new Promise((done) => setTimeout(done, logMs(fought.log)));
    if (wanted()) l.bots(ida, idb, fought.winner, fought.caught ? fought.shareA : undefined, [fought.usedA, []]);
    return;
  }
  const out = judge ? await judge(a, b, wanted).catch(() => null) : null;
  if (!wanted()) return;
  if (!out) { l.bots(ida, idb, 0); return; }
  // Off a marked spot: a ROM's duel has no throw in it, so the one it would have thrown at the last of
  // the mon, at the ROM's odds, once the bot has beaten it. Beaten and not caught, nobody's: the spot
  // is taken, and the bot has what the fight left it. Lost, it is out.
  if (legend?.patch) {
    const won = out.winner === ida;
    const shares = a.party.map((m, i) => (m.maxHp > 0 ? Math.min(1, (out.a[i]?.hp ?? m.hp) / m.maxHp) : 0));
    const ball = patchBalls(a.party.length, ballsIn(r.actor(ida)?.loot?.items ?? []))[0];
    const caught = won && !!ball && ballTakes(ball.id, { hp: 1, maxhp: b.party[0].maxHp, status: '' }, catchRateOf(legend.species), false, Math.random);
    l.bots(ida, idb, caught ? ida : !won && out.winner === LEGEND_SEAT ? LEGEND_FOE : 0, shares, [caught ? [...out.usedA, ball.id] : out.usedA, out.usedB]);
    return;
  }
  // What the winner has left, mon for mon (brain.ts settleAnswered), as shares.
  // A legendary it brought low enough to catch is the bot's, however the rest of its team did.
  const m0 = b.party[0];
  const winner = legend && m0.maxHp > 0 && (out.b[0]?.hp ?? m0.hp) / m0.maxHp < LEGEND_CATCH ? ida : out.winner;
  const won = winner === ida ? a : b, left = winner === ida ? out.a : out.b;
  const hp = won.party.map((m, i) => (m.maxHp > 0 ? Math.min(1, (left[i]?.hp ?? m.hp) / m.maxHp) : 0));
  l.bots(ida, idb, winner === LEGEND_SEAT ? LEGEND_FOE : winner, hp, [out.usedA, out.usedB]);
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
let partyHold = false;
let partyGone = false;
let partyHeld = 0;
/** Frames the picture waits on the party's unseen walk, at most. */
const PARTY_HOLD = 900;
/** Pictures since a hold ended that were not yet the battle's, and how many may be. */
let heldTail = -1;
const HELD_TAIL = 30;
/** The battle's picture and not a black one: its backdrop is keyed out (keyPicture has run), about
 *  40-60% of the glass in every one measured. */
function drawnPicture(rgba: Uint8ClampedArray): boolean {
  let keyed = 0;
  for (let i = 3; i < rgba.length; i += 4 * 8) if (rgba[i] === 0) keyed++;
  return keyed * 8 * 8 >= 240 * 160;
}
/** The prompt off the held picture from the moment a choice is made: the windows go, and this says
 *  the click landed while the ROM's screens are walked. B_WIN_MSG, tiles 2,15 and 26x4. */
let promptOff = false;
const MSG_X = 16, MSG_Y = 120, MSG_W = 208, MSG_H = 32;
function clearPrompt(): void {
  const c = keyCanvas.getContext('2d');
  if (!c) return;
  const [r, g, b, a] = c.getImageData(MSG_X, MSG_Y, 1, 1).data;
  c.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  c.fillRect(MSG_X, MSG_Y, MSG_W, MSG_H);
}
let battleMenu: BattleMenu | null = null;
let bagFrames = 0;
const BAG_HOLD = 150;
/** ROM frames after the battle's callback is back before its picture is one to show. With the
 *  see-through on it has no fade in (reshow_battle_screen.c), and its first frames are black, then
 *  the bases and the box with no mon and no healthbox on them. Shown at once, that one picture was
 *  Cam's "flashes" (11-04). */
const BACK_SETTLE = 6;
let backAt = -1;
let bagRanAt = 0;
/** The battle's own screen again, and drawn. */
function battleBack(): boolean { return !!rom && backAt >= 0 && rom.emu.ran - backAt >= BACK_SETTLE; }
/** The unseen part of a choice is at speed, or when it last was. */
let hiding = false;
let hidUntil = 0;
/** ...and in the picture: at HURRY_SPEED the core does not draw every frame, so the last one it did
 *  can be older than the RAM says. One in seven of them was still that bare frame. */
function pictureBack(): boolean { return battleBack() && !hiding && !!rom && rom.emu.ran - hidUntil >= BACK_SETTLE; }
const ITEM_FLUFFY_TAIL = ITEM_POKE_DOLL + 1;
/** A USE walked on the ROM's BAG: frames to read what became of it, and the most it may take. */
const BAG_USE_READ = 45, BAG_USE_MAX = 1200;
/** ROM frames the unseen part of a choice may run fast, at most: what is still going then is not one. */
const UNSEEN_MAX = 2400;
/** ...and to leave the battle's screen at all: a press or two, and the start of its fade. */
const UNSEEN_START = 180;
/** What the ROM's BAG says of an item it won't use (item_use.c), in its words. */
function refusedLine(pocket: number, item: number): string {
  if (pocket === POCKET_BALLS) return 'The BOX is full.';
  return item === ITEM_POKE_DOLL || item === ITEM_FLUFFY_TAIL ? "DAD's advice... There's a time and place for everything!" : "It won't have any effect.";
}
function trackBag(): void {
  const sym = romTables.sym;
  const main = sym('gMain'), run = sym('CB2_BagMenuRun'), pick = sym('gBrBag'), battleCb = sym('BattleMainCB2');
  if (!rom || main === undefined || run === undefined || pick === undefined || battleCb === undefined) return;
  const cb2 = rom.emu.read(main + 4, 32);
  const step = Math.max(1, rom.emu.ran - bagRanAt);
  bagRanAt = rom.emu.ran;
  if (((cb2 ^ battleCb) & ~1) !== 0 || romFading()) backAt = -1;
  else if (backAt < 0) backAt = rom.emu.ran;
  const is = (n: string | number | undefined) => { const a = typeof n === 'string' ? sym(n) : n; return a !== undefined && ((cb2 ^ a) & ~1) === 0; };
  const bag = rom.emu.read(pick, 16) !== 0 || is(run);
  if (!bag && !romBag) return;
  if (romBag === 'free') { if (!bag) romBag = null; return; }
  if (bag) romBag = 'bag';
  else if (romBag === 'bag') romBag = is('CB2_SetUpReshowBattleScreenAfterMenu2') || is('ReshowBattleScreenAfterMenu') || is(battleCb) ? 'reshow' : null;
  else if (pictureBack()) romBag = null;
  bagFrames = romBag ? bagFrames + step : 0;
  if (bagFrames > BAG_HOLD) romBag = 'free';
}
function romFading(): boolean {
  const at = romTables.sym('gPaletteFade');
  return !!rom && at !== undefined && fadeOf(rom.emu.read(at + FADE_Y_WORD, 16), rom.emu.read(at + FADE_COLOR_WORD, 16)).active;
}
/** The battle's closing fade is on (field.ts closingFade). Followed in the ROM's colours the fight
 *  went to black shapes over a map still dimmed, and then the map snapped up lit (POK-435; Cam,
 *  10-19: "translucent boxes", "one clean fade"). So the last picture before it stays up and goes
 *  away over the map, as the dim does. */
let closing = false;
function closingFrame(up: boolean): boolean {
  const at = romTables.sym('gPaletteFade');
  const left = up && seeing && battle && at !== undefined
    ? closingFade(closing, fadeOf(rom!.emu.read(at + FADE_Y_WORD, 16), rom!.emu.read(at + FADE_COLOR_WORD, 16)), rom!.emu.read(at + FADE_MODE_WORD, 16), rom!.emu.read(at + FADE_SELECTED, 32))
    : null;
  if (left === null && !closing) return false;
  closing = left !== null;
  // #battle.see's #0007.
  keyCanvas.style.opacity = closing ? String(1 - left!) : '';
  battleEl.style.background = closing ? `rgba(0, 0, 0, ${(7 / 15) * (1 - left!)})` : '';
  return closing;
}
function seeFrame(): void {
  if (panelUp && battleEl.classList.contains('panel')) return;
  const up = !!rom && battleEl.classList.contains('on');
  if (closingFrame(up)) return;
  const keyed = up && rom!.seeThrough(seeThrough()) && rom!.picture(keyImage.data);
  // USE in the page's bag is the ROM's own BAG doing it (br_bag.h): its screen, and the
  // battle's redraw after it, have no key and showed bare -- black, the bag, a blue fade
  // (HBR-110). The battle's last picture stays up over them (trackBag).
  if (up && seeing && (romBag === 'bag' || romBag === 'reshow' || partyHold)) {
    // Sending one out is the ROM's own party screen, walked unseen: back when its battle is.
    const main = romTables.sym('gMain'), fight = romTables.sym('BattleMainCB2');
    if (partyHold && main !== undefined && fight !== undefined) {
      const inFight = ((rom!.emu.read(main + 4, 32) ^ fight) & ~1) === 0;
      if (!inFight) partyGone = true;
      if ((partyGone && inFight && pictureBack()) || ++partyHeld > PARTY_HOLD) partyHold = false;
    }
    heldTail = 0;
    return;
  }
  if (keyed) {
    keyPicture(keyImage.data, romFading());
    if (heldTail >= 0) {
      if (!drawnPicture(keyImage.data) && ++heldTail <= HELD_TAIL) return;
      heldTail = -1;
    }
    keyCanvas.getContext('2d')?.putImageData(keyImage, 0, 0);
    if (promptOff) clearPrompt();
  } else if (rom && !up) rom.seeThrough(false);
  // A core with no WebGL draws nothing on #gba: whatever the ROM shows unkeyed (its Hall of
  // Fame, a party screen) comes from the picture itself, as the keyed battle's does.
  const plain = up && !keyed && !rom!.emu.drawsItself() && rom!.picture(keyImage.data);
  if (plain) {
    // The core leaves its alpha as it likes (lcdPixels): every pixel solid, or the curtain shows through.
    const px = keyImage.data;
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
    keyCanvas.getContext('2d')?.putImageData(keyImage, 0, 0);
  }
  battleEl.classList.toggle('plain', plain);
  if (keyed !== seeing) { seeing = keyed; battleEl.classList.toggle('see', keyed); }
  battleEl.classList.toggle('screen', up && !battle);
  battleEl.classList.toggle('fight', up && !!battle);
}

/** Every few seconds, between battles: my team as it stands, told to the room when it
 *  changes, so the results screen can show the champion's (the live game's PARTY). */
let teamAsking = false;
let teamSent = '';
function teamFrame(): void {
  if (frame % 300 !== 150 || battle || swapping || isOut) return;
  tellTeam();
}

function sendTeam(mons: FameMon[], bag?: PeekBag): void {
  const text = JSON.stringify([mons, bag]);
  if (text === teamSent) return;
  teamSent = text;
  link.team(mons, bag);
}

/** My team to the room now, if it changed since I last told it. */
function tellTeam(): void {
  if (teamAsking || !rom) return;
  teamAsking = true;
  const l = link;
  // The bag goes with it, for whoever watches (their START): what is in it and the money.
  const r = rom;
  void r.fameTeam()
    .then(async (mons) => {
      const s = await r.spill().catch(() => null);
      if (l === link) sendTeam(mons, s ? { items: s.items, money: s.money } : undefined);
    })
    .catch(() => undefined)
    .finally(() => { teamAsking = false; });
}

/** The CENTER's nurse, as the match has her (pkmn_center_nurse.inc): one question, and
 *  closed once the fog is on the town. */
async function nurse(): Promise<void> {
  if (!rom || isOut || battle || swapping || asking) return;
  if (inFogNow()) { say('This CENTER is closed.'); return; }
  const c = await ask('HEAL your party?', [['YES', 'yes'], ['NO', '']]);
  if (c !== 'yes' || isOut || !rom) { say('Good luck.'); return; }
  await rom.heal();
  rom.sound(MUS_HEAL);
  say('Done. Your POKéMON are fully healed.');
}

/** Somebody's offer of a mon: yes or no, and its SUMMARY first if I want to see it. Nobody's
 *  party holds it, so that is what the wire says, its species, at the rung it would come at. */
async function askLooking(title: string, yes: string, species: number, joins: () => NonNullable<PartyMember['joins']>): Promise<string> {
  for (;;) {
    const c = await ask(title, [[yes, 'y'], ['SUMMARY', 'look'], ['NO, THANKS', '']]);
    if (c !== 'look') return c;
    swapping = true;
    await new Promise<void>((done) => {
      summaryWin?.open([{ hp: 1, maxHp: 1, status: 0, item: 0, itemName: '', ability: '', active: false, ...joins() }], 0, () => !isOut && !battle, done);
    });
    swapping = false;
    calmUntil = frame + 30;
  }
}

/** An event's trader (br_event.c): his offer, and if yes, the party menu on the ROM's
 *  screen to pick which one he gets. He keeps it and offers it next. */
async function trade(n: number, species: number): Promise<void> {
  const l = link;
  let given = 0;
  try {
    if (!rom || isOut || battle || swapping) return;
    if (swapping) leaveScreen();
    asking?.done('');
    const name = speciesName(species);
    // Somebody at home's goes through a trade's evolution on the way over (br_loot.c's
    // BrLoot_HomeTrade); an event's trader's does not (br_event.c's Swap).
    const got = n >= HOME_N ? tradedInto(species) : species;
    const c = await askLooking(`I'll trade you my ${name} for one of yours. Which one?`, 'CHOOSE', species, () => joinsAs(got, 0, null));
    if (c !== 'y' || !rom || isOut) return;
    const slot = await askParty(`For ${name}`);
    if (slot === null || !rom || isOut) return;
    swapping = true;
    held.clear();
    try {
      const before = readTeam(), joins = joinsAs(got, 0, null);
      given = await rom.trade(got, () => battleEl.classList.add('on'), slot);
      if (given) await sayWhatItSaid(before, joins);
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
    const c = await askLooking(`Will you look after my ${name} for me?`, 'YES', species, () => joinsAs(tradedInto(species), 0, 0));
    if (c !== 'y' || !rom || isOut) return;
    const left = await dropPanel('GIFT', [{ species, level: rungForPhase(link.room.ring().phase + 1) }]);
    if (!left.some((m) => m.species === species)) taken = species;
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
  if (inFogNow()) { say('This MART is closed.'); return; }
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
    if (took) rom.sound(SE_SHOP);
    say(took ? 'Here you go! Thank you very much.' : 'You have no more room for items.');
  }
}

const CAUGHT = 7;
const OUTCOME = ['', 'won', 'lost', 'drew', 'ran', 'teleported', 'it fled', 'caught it', 'out of balls', 'forfeited'];
let lastResult = '';

function endBattle(r: Fought | null): void {
  battleEl.classList.remove('on');
  battle?.unwatch?.();
  clearTimeout(battle?.force);
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
  // A catch with a full party let one go: it lies beside me, for anybody (POK-294).
  if (r?.released?.length && !stale) (battle?.link ?? link).released(r.released);
  // So too a bot run from with a POKe DOLL (br_engage.c's BrEngage_OnBattleEnd holds any
  // fleer off its pursuer): without it the bot stood beside me and fought again after the
  // two-second grace. Not the RUN that leaves a fight the match was won in.
  const ranFromBot = !!battle?.foe?.bot && !!r?.ok && (r.outcome & 0x7f) === 4 && link.room.results.winner !== link.me;
  (battle?.link ?? link).end((duel && (!r?.ok || [4, 9].includes(r.outcome & 0x7f))) || ranFromBot || !!r?.stalled, !stale && (!!battle?.foe?.bot || boss !== undefined) && !!r?.ok && r.outcome === 1, boss !== undefined ? r?.team : undefined);
  if (!stale && boss !== undefined && r?.ok && r.outcome === 1) say(`You beat ${LEADERS[boss].name}! Took their TM and ¥1000. Their team is up for grabs.`);
  const wild = battle && !battle.foe && boss === undefined;
  const by = battle?.foe?.id;
  battle = null;
  tellTeam();
  held.clear();
  pressed.clear();
  // A held A from the battle's last text must not walk straight into another one.
  calmUntil = frame + 30;
  if (r?.stalled) { lastResult = 'last battle: stopped, it never got to its first menu'; if (!stale) say("The battle couldn't start."); }
  else if (r && !r.ok) lastResult = 'last battle: the ROM did not start it';
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
  // Still here, and no longer fighting me, before this fight reached its first menu: their page
  // stopped it (the net below), and neither of us wins. Gone from the room: they forfeited.
  if (now && !battle!.net.seen) stopFight(battle!, 'foe-ended');
  else rom?.foeOut();
}

// ---- the stuck-fight net (stuck.ts) ----------------------------------------------------
// No trainer is held for good by a fight that never started. The shot clock only runs from the
// first menu on, so these two rules cover what comes before it. A fight stopped has no winner
// (never a coin flip): the ROM is parked as after any fight, team and bag as they were, the
// fight log ends, and both trainers go back to the field. The room's own end takes the
// trainer who stopped it (keeping the two apart a while, as a fight run from does); the other
// side stops its own, by its own minute or when foeFrame sees the foe has stopped.

/** The limits, which a spec shortens (`__spike.stuckLimits`). */
const stuckLimits = { ...NET_LIMITS };
/** A ROM that has not unwound a stopped fight by now is let go of by the page. */
const STUCK_LET_GO_MS = 4000;

/** The net over a fight just handed to the ROM: emulator frames counted, the first menu watched
 *  for on every one of them (a menu can open and close between two looks of a timer). */
function watchFight(b: NonNullable<typeof battle>, r: RomBattles): void {
  let frames = 0;
  const off = r.emu.onFrame(() => { frames++; if (!b.net.seen && r.menuUp()) b.net.seen = true; });
  const timer = window.setInterval(() => {
    if (battle !== b) return;
    if (b.net.tick(performance.now() - b.shownAt, frames, r.menuUp(), stuckLimits) === 'fire') stopFight(b, 'no-menu', frames);
  }, 500);
  b.unwatch = () => { off(); clearInterval(timer); };
}

function stopFight(b: NonNullable<typeof battle>, why: 'no-menu' | 'foe-ended', frames?: number): void {
  if (b.stopped) return;
  b.stopped = true;
  recorder.stuck(why, b.foe?.id ?? 0, (performance.now() - b.shownAt) / 1000, frames);
  console.warn('spike: a fight stopped with no winner', { why, frames });
  // The ROM unwinds it in a few frames and the fight's own end follows. One that cannot (its
  // emulator is not running, or a turn ahead of this fight never ends) must not hold the
  // trainer: the page lets go itself, and the late end of that fight is nobody's.
  rom?.abort();
  b.force = window.setTimeout(() => { if (battle === b) endBattle({ ok: false, outcome: 0, species: 0, level: 0, stalled: true }); }, STUCK_LET_GO_MS);
}

/** The room says I fight, and nothing on this page explains it: no fight up, no question, no
 *  screen, no cast. A resync that jumped past the event that would have opened it does this
 *  (net.ts loads the relay's state; the event was made by stepping). The same minute. */
const lostNet = new LostNet();
function lostCheck(): void {
  const me = link?.room?.actor(link.me);
  const lost = !!me && me.battling && !me.meet && !battle && !swapping && !asking && !casting && !panelUp && !romUp && !giving && !toGive.length && !isOut && !spectating;
  const now = performance.now();
  if (lostNet.tick(now, lost, stuckLimits) !== 'fire') return;
  lostNet.tick(now, false);
  const l = link;
  recorder.stuck('lost', me?.foe ?? 0, stuckLimits.ms / 1000);
  console.warn('spike: the room had me in a fight this page never started');
  say("The battle couldn't start.");
  l.end(true);
}
setInterval(lostCheck, 1000);

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

/** The fog is moving in now (room.ts ring: over the end of a phase, its radius falls a frame at
 *  a time), not holding where it is. */
function fogClosing(ring: Ring): boolean {
  return !ring.safari && !ring.last && link.room.ring(link.room.tick + 1).r < ring.r;
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
  if (next) { follow = next.id; if (zoom < 1) zoom = playZoom(); }
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
    } else if (rom && !battle && championTeam(res.winner).length) {
      // Somebody else's: their Hall of Fame on my own ROM too (POK-417), after the fight a
      // watcher has on screen, then the standings.
      const kept = structuredClone(res), bots = botIds(), during = link, who = res.winner;
      void paradeOf(who).finally(() => { if (matchOn && link === during && !endingShown) standings(false, kept, bots); });
    }
    else standings(false);
  }
  // A match of the page's own, in a lobby (QUICK PLAY with no relay): over when one is
  // left, with nobody to say so but the room itself. Out, I watch the rest, as live (HBR-96).
  if (lobby && !link.online && matchOn && !endingAt && over(link.room)) matchOver();
  // The relay said the match is over: once the frames that ended it have played here (or
  // a moment has passed), the standings and PLAY AGAIN.
  const held = romUp || watch.replaying;
  if (endingAt && (held ? performance.now() - endingAt > SCREEN_WAIT_MS : over(link.room) || performance.now() - endingAt > 1500)) {
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
  // The room's counts too: MY STATS' TRAINERS BEATEN, PLAYERS BEATEN and LOOT TAKEN stood still at what
  // classic had left them (Cam, 11-04: BEATEN 4 that match, TRAINERS BEATEN 0).
  const myName = res.entrants.find(([id]) => id === link.me)?.[1] ?? '';
  lastRound = tallySince(tallyFrom, now, myStepsN, { ...beatenBy(res.fallen, myName), took: myTookN });
  recordMatch(placement, localStorage, lastRound);
  tallyFrom = now;
  myStepsN = myTookN = 0;
}

/** The ROM's move table, for MY STATS' favourite move. */
let romTables: MoveTables = { bytes: new Uint8Array(0), sym: () => undefined };

/** What the last round I played added to MY STATS, for its results. */
let lastRound: ReturnType<typeof tallySince> | null = null;

/** MY STATS for the round I am in: the hidden ROM's tally as it began, and my steps. */
let tallyFrom: MatchTally | null = null;
let myStepsN = 0;
/** The balls and bags I took from, this round: MY STATS' LOOT TAKEN. */
let myTookN = 0;
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
/** How long the match's end waits for a Hall of Fame or a watcher's replay on screen
 *  (classic's WIN_GRACE_MAX_MS and REPLAY_MAX_MS): a ROM that never finishes must not
 *  strand anybody in a match that is over. */
const SCREEN_WAIT_MS = 60_000;

/** The champion's team as a parade's PARTY rows: a bot's as its fights deal it, a
 *  trainer's as their page last told the room (with its personality, for its colours). */
function championTeam(id: number): PackedMon[] {
  const a = link.room.actor(id), r = link.room;
  const name = (a?.name ?? '').slice(0, 7);
  if (a?.bot) return wornParty(botParty(r.seed, a, r.ring().phase + 1), a.wear).map((m) => ({ ...m, ot: name }));
  return (link.teams.get(id) ?? []).map((m) => ({
    species: m.species, level: m.level, hp: m.hp ?? m.maxHp ?? 1, maxHp: m.maxHp ?? m.hp ?? 1, status: 0,
    moves: (m.moves ?? []).map((v) => ({ id: v.id, pp: 0, ppUps: 0 })), heldItem: 0,
    otId: m.otId ?? 0, personality: m.personality ?? 0, exp: 0,
    nickname: m.nickname ?? speciesName(m.species), ot: name, ...(m.shiny ? { shiny: true } : {}),
  }));
}

/** The champion's team for the results' Hall of Fame: a trainer's as their page told it,
 *  a bot's as the match deals it (championTeam), which no page tells. */
function fameTeamOf(id: number): FameMon[] | undefined {
  const told = link.teams.get(id);
  if (told || !link.room.actor(id)?.bot) return told;
  return championTeam(id).map((m) => ({ species: m.species, level: m.level, hp: m.hp, maxHp: m.maxHp, moves: m.moves.map((v) => ({ id: v.id })) }));
}

/** The Hall of Fame on the page: the banner down behind it, over a field that goes on shaking,
 *  and with a mouse at a window's size in the middle (Cam, 11-04: "the smaller screen in the
 *  middle of your screen"). What it hands back takes all that away. */
function fameUp(): () => void {
  battleEl.style.setProperty('--fame', String(stageScale(innerWidth, innerHeight)));
  battleEl.classList.add('on', 'fame');
  const c = art?.contestCurtain();
  const up = c ? curtainBehind(c, document.body) : () => {};
  return () => {
    up();
    battleEl.classList.remove('on', 'fame');
  };
}

/** Somebody else's Hall of Fame on my ROM: after any battle of the trainer I watch,
 *  which has the ROM first. */
async function paradeOf(id: number): Promise<void> {
  if (!rom) return;
  const mons = championTeam(id), a = link.room.actor(id);
  if (!mons.length) return;
  const r = rom;
  // My ROM's turns are one at a time: the replay on screen ends first.
  romUp = true;
  let over = () => { battleEl.classList.remove('on'); };
  try { await r.paradeOf(mons, a?.name ?? '', a?.skin ?? 0, () => { over = fameUp(); }); } catch (e) { console.warn('spike fame failed', e); }
  romUp = false;
  over();
}

/** The Hall of Fame: the ROM has the screen until it is over. */
async function parade(): Promise<void> {
  if (!rom) return;
  romUp = true;
  let over = () => { battleEl.classList.remove('on'); };
  try { await rom.fame(() => { over = fameUp(); }); } catch (e) { console.warn('spike fame failed', e); }
  romUp = false;
  over();
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
    fame: fameOf(res.winner || undefined, link.me, res.winner ? fameTeamOf(res.winner) : undefined, nameOf, speciesName, (id) => moveInfo(romTables, id)?.name),
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
/** A trainer's MY VOICE as their card in the room says it (lines.ts LINES), for my ROM to
 *  say in our fight; none for one who never told it. */
function voiceOfMember(id: number): { intro: string; win: string; lose: string } | undefined {
  const rec = room?.members.find((m) => m.id === id)?.rec;
  if (!rec || rec.intro === undefined) return undefined;
  return { intro: lineAt(rec.intro), win: lineAt(rec.win ?? 0), lose: lineAt(rec.lose ?? 0) };
}
/** A match of mine is on (I am in it, or watching it). */
let matchOn = false;
/** The room a reload mid-match asked to go back into, until the relay answers. */
let reloadedFrom: string | null = null;

// A reload within a minute comes back as the same trainer with the same team (Cam,
// 2026-10-20): the relay holds the trainer for AWAY_MS, the page keeps what lets it back
// in (the room, its id, its key) and the ROM's own (party, bag, Pokédex), every few
// seconds. A reload mid-battle is a forfeit: the relay does not hold a battling trainer.
const AGAIN = 'spikeB.again';
const AGAIN_ROM = 'spikeB.againRom';
const AGAIN_MS = 60_000;
/** `room`: kept in the room between matches (rememberRoom), so no match to come back to. */
interface Token { code: string; id: number; key: string; at: number; room?: boolean }
function token(): Token | null {
  try {
    const t = JSON.parse(localStorage.getItem(AGAIN) ?? 'null') as Token | null;
    return t && Date.now() - t.at < AGAIN_MS ? t : null;
  } catch { return null; }
}
/** A reload's way back into a match (not a room's seat between matches). */
function matchToken(): Token | null {
  const t = token();
  return t && !t.room ? t : null;
}
/** A match a reload left more than AGAIN_MS ago, still recent enough to be on: its room. */
function lateCode(): string | null {
  try {
    const t = JSON.parse(localStorage.getItem(AGAIN) ?? 'null') as Token | null;
    return t && !t.room && Date.now() - t.at < 30 * 60_000 ? t.code : null;
  } catch { return null; }
}
function forget(): void {
  try { localStorage.removeItem(AGAIN); localStorage.removeItem(AGAIN_ROM); } catch { /* private window */ }
}
/** In a room with no match on: the seat for a reload, and no team (the next match deals
 *  its own, so startMatch's `comingBack` finds none). */
function rememberRoom(r: { code: string; you: number; key?: string }): void {
  if (!r.key) return;
  try {
    localStorage.setItem(AGAIN, JSON.stringify({ code: r.code, id: r.you, key: r.key, at: Date.now(), room: true }));
    localStorage.removeItem(AGAIN_ROM);
  } catch { /* private window */ }
}
/** The team a reload is bringing back, until the ROM has booted to take it. */
let comingBack: string | null = null;
let savedAt = 0;
/** The Safari opening (room.ts SAFARI) ends as the match's does (br_match.c's
 *  BrMatch_SafariOver): at the clock, or sooner for whoever threw their last ROYALe BALL.
 *  Caught nothing: out at the buzzer. Otherwise the fly map, "Drop where?", and the room
 *  drops me where I chose. */
let dropRound = -1;
/** The round the buzzer last pulled me out of a screen in: once a round. */
let buzzRound = -1;
const buzzedRound = (round: number): boolean => { if (buzzRound === round) return true; buzzRound = round; return false; };
/** The curtain over a cut, until `ready`; none on a patch too old to draw it. */
function cover(ready: () => boolean): Cover | null {
  const c = art?.contestCurtain();
  return c ? coverScreen(c, document.body, ready, { fall: () => rom?.sound(SE_CONTEST_CURTAIN_FALL), rise: () => rom?.sound(SE_CONTEST_CURTAIN_RISE) }) : null;
}
let buzzerRound = -1;
let buzzerCover: Cover | null = null;
function safariFrame(ring: Ring): void {
  const me = link.room.actor(link.me);
  if (!me || isOut || !rom || !me.m.spot.map.startsWith(SAFARI)) return;
  // Time's up: the curtain first, and the battle, the menu and the map all happen behind it.
  if (!ring.safari && buzzerRound !== ring.round) {
    buzzerRound = ring.round;
    buzzerCover = cover(() => !!mapWindow || isOut || !link.room.actor(link.me)?.m.spot.map.startsWith(SAFARI));
  }
  if (buzzerCover && !buzzerCover.isDown()) return;
  if (dropRound === ring.round) return;
  if (ring.safari && rom.safariBalls() > 0) return;
  // The battle, the menu or the question on screen first: the map comes up after it. At
  // the buzzer they are pulled out of it, as live (BrMatch_BuzzerClosing, the menus' B),
  // or a straggler sat in the Zone until the room's PICK_WAIT dropped them anyhow.
  if (battle || swapping) {
    if (!ring.safari && !buzzedRound(ring.round)) { if (battle) rom.buzzer(); else rom.leave(); }
    return;
  }
  asking?.done('');
  dropRound = ring.round;
  void flyDrop();
}

/** br_pick.c's BR_PICK_FRAMES: how long the drop's map gives you. */
const DROP_MS = 20_000;

async function flyDrop(): Promise<void> {
  const r = rom, me = link.room.actor(link.me);
  if (!r || !me || !ringMap) return;
  let section = 0;
  // The field is held from here: no walk into grass or a trainer while the map comes up.
  swapping = true;
  held.clear();
  try {
    if (!(await r.spill()).mons.length) { swapping = false; goOut('You caught nothing in the SAFARI ZONE.'); return; }
    const until = performance.now() + DROP_MS;
    const chosen = await openMapWindow({
      verb: 'DROP',
      can: () => true,
      prompt: () => `Drop where? ${Math.max(0, Math.ceil((until - performance.now()) / 1000))}`,
      back: false,
      until,
    });
    section = chosen?.id ?? 0;
  } finally {
    swapping = false;
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

/** Every few seconds of a match: still here, and the team as it is. `now`: this moment, a
 *  question up or not, because what was just put in the bag or taught is the team as it is (a TM
 *  off the ground was in no save until its question closed, and a reload at the question lost it:
 *  Reddit, 11-12, "it didnt even teach the move and still deleted the tm"). */
function remember(now = false): void {
  if (!link?.online || !link.key || !room || !matchOn || isOut || !link.room.actor(link.me)) return;
  const at = Date.now();
  if (!now && at - savedAt < 5000) return;
  savedAt = at;
  try { localStorage.setItem(AGAIN, JSON.stringify({ code: room.code, id: link.me, key: link.key, at })); } catch { return; }
  if (rom && !battle && (now || (!asking && !swapping)) && !comingBack) {
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
  sendJank();
  link = l;
  jank = new JankMeter();
  jankSent = false;
  // The room's battle pace (the host's TEXT and ANIM); ?solo keeps the parked FAST, none.
  if (room) rom?.pace(room.set.textSpeed, room.set.animations);
  // A patch whose symbols predate the MAP's (gRegionMapEntries, gPlttBufferFaded) has none.
  ringMap = art && RingMap.SYMBOLS.every((n) => Number.isFinite(art!.sym(n))) ? new RingMap(l.room, art) : null;
  matchOn = true;
  endingAt = 0;
  endingShown = false;
  if (romUp && !battle) rom?.leave();
  lobby?.hide();
  // Into a match, not back into one after a reload.
  const curtain = l.online && matchToken()?.id === l.me ? null : art?.contestCurtain();
  if (curtain) raiseCurtain(curtain, document.body, () => rom?.sound(SE_CONTEST_CURTAIN_RISE), curtainLines(l.room.results.entrants.length || l.room.actors.length, l.room.seed));
  isOut = waiting = shownWin = false;
  // Every match's rounds count from 0: what was told or recorded of the last one is not.
  seenRound = lastPhase = recordedRound = dropRound = hudRound = dugRound = toldOpening = buzzerRound = -1;
  buzzerCover = null;
  teamSent = '';
  tallyFrom = rom?.tally() ?? null;
  myStepsN = myTookN = 0;
  mySpotWas = '';
  ticks.clear();
  toldEvents = 0;
  toldGyms = l.room.gyms.length;
  wasInFog = false;
  toGive.length = 0;
  winEl.classList.remove('on');
  if (spectating) toggleSpectate();
  follow = link.me;
  savedAt = 0;
  const back = matchToken();
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
/** The last knock on a room carried a passcode: a `pass` refusal then means a wrong one. */
let knockedWithPass = false;

/** LEAVE: the relay takes me out (the standings say "left"), and the menu is back. */
function leaveMatch(): void {
  if (!lobby) return;
  sendJank();
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
// Out of the match there is no dock (so no ☰) and a phone has no R: LEAVE sits on the watch
// strip, and opens the sheet at its "Leave the match?" (Cam, 11-02: "except for reloading").
const watchLeave = document.getElementById('watch-leave')!;
function askToLeave(): void { openSheet(); sheetLeave = true; lobby?.stage.redraw(); }
watchLeave.addEventListener('click', askToLeave);
function openSheet(): void {
  if (!lobby || !matchOn || lobby.shown) return;
  held.clear();
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
  const openCard = (at: number) => lobby?.stage.push(seatScreen(() => {
    const seat = seats.find((p) => p.seat === at)!;
    const m = room?.members.find((x) => x.id === at);
    const placed = ids.length - res.fallen.findIndex((f) => f.id === at);
    const close = () => lobby?.stage.pop();
    return {
      look: 'overlay',
      face: { name: seat.name, skin: seat.skin, wins: m?.rec?.wins ?? 0, played: m?.rec?.played ?? 0, best: m?.rec?.best },
      note: seat.alive ? 'IN THE MATCH' : fell.has(at) ? `OUT (${ordinal(placed)})` : 'OUT',
      // The host's KICK holds in the match too, as /classic/'s does (service.ts "kick").
      ...(room && room.owner === room.you && m && at !== room.you ? {
        onKick: () => { lobby?.kick(at); close(); },
        onMakeHost: () => { lobby?.makeHost(at); close(); },
        onToBot: () => { lobby?.toBot(at); close(); },
      } : {}),
      ...(out && seat.alive && !seat.isMe ? { onWatch: () => { follow = at; if (zoom < 1) zoom = playZoom(); lobby?.closeSheet(); } } : {}),
      onBack: close,
    };
  }));
  return {
    look: 'overlay',
    status: reconnecting ? 'Reconnecting…' : room ? `Room ${room.code}` : 'SOLO VS BOTS',
    strip,
    chips: [legendChip()].filter((c): c is string => c !== null),
    match: res.round,
    note: '',
    seats,
    card: null,
    watch: out ? { name: follow && follow !== link.me ? nameOf(follow) : null } : null,
    canLeave: true,
    leaveAsk: sheetLeave,
    muted,
    remapping: remap.on,
    remapLine: remap.line,
    help: touchPad ? ['Pinch the map to zoom.'] : ['Arrows move  Z: A  X: B  M: MENU', 'R: this sheet  V: spectate  K: mark', "SHIFT: a move's details", '+ -  or the wheel: zoom'],
    zoom: zoomLabel(playZoom(), zoomChoices()),
    onZoom: () => { chooseZoom(nextZoom(playZoom(), zoomChoices())); lobby?.stage.redraw(); },
    version: versionLine,
    onSeat: openCard,
    onKick: (seat) => { lobby?.kick(seat); lobby?.stage.redraw(); },
    onCloseCard: () => {},
    onWatch: (dir) => { watch.step(dir); lobby?.stage.redraw(); },
    onWatchSeat: (seat) => { follow = seat; if (zoom < 1) zoom = playZoom(); lobby?.closeSheet(); },
    onStopWatch: () => { follow = 0; lobby?.stage.redraw(); },
    onLeave: () => { sheetLeave = true; lobby?.stage.redraw(); },
    onStay: () => { sheetLeave = false; lobby?.stage.redraw(); },
    onLeaveSure: () => { sheetLeave = false; leaveMatch(); },
    onMute: () => { soundBtn.click(); lobby?.stage.redraw(); },
    onRemap: () => { remapPad(); lobby?.stage.redraw(); },
    onResetPad: () => { resetPad(); lobby?.stage.redraw(); },
    onForget: () => { forgetRom(); },
    onSaveLog: saveLog,
    onCard: () => { lobby?.closeSheet(); void runMenu('4'); },
    // A phone has no K: the sheet's row, and the sheet shuts so the line is seen.
    onMark: touchPad ? () => { markHere('sheet'); lobby?.closeSheet(); } : undefined,
    pad: touchPad ? {
      hidden: padPrefs.hidden,
      onMove: () => { lobby?.closeSheet(); padPrefs.edit(); },
      onToggle: () => { padPrefs.toggleHidden(); lobby?.stage.redraw(); },
    } : undefined,
  };
}
let refreshHud: () => void = () => undefined;
/** A phone's HUD and dock (the live game's ui/phonehud.ts) in place of the corner and the
 *  buttons: the sign of the place I stand in, the fog window (Safari or Fog, the clock,
 *  how many are left, which way is safe), and PARTY, MAP, START and the room under it. */
/** br_hud.h BR_HUD_FOG_FRAMES: how long the fog window flashes FOG! on going outside. */
const BR_HUD_FOG_FRAMES = 60;
/** A desktop's side-by-side windows, GBA pixels across (their rules in index.html). */
const DESK_WIDE_W = 480;
let hudFogged = false;
let fogFlashTo = 0;
/** The round button held: the dial, from where the finger or the mouse is. A press is SELECT. */
function wireDialHold(b: HTMLElement): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const end = () => { if (timer) clearTimeout(timer); timer = null; };
  b.addEventListener('pointerdown', (e) => {
    const at = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      end();
      eatLiftClick();
      openDial(at);
    }, HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, end);
}

/** `desk`: a computer's, as /classic/ shows it in the picture (br_hud.c): the place's
 *  sign and the fog window in Emerald's own frames in place of the plain corner, the
 *  buttons kept, and no dock (the keyboard has PARTY, MAP and START). */
function wirePhoneHud(desk = false): void {
  const top = document.getElementById('phud')!;
  const dock = document.getElementById('pdock')!;
  const hud = new PhoneHud({
    top,
    dock,
    refresh: () => refreshHud(),
    onParty: () => void runMenu('1'),
    onMap: () => void runMenu('13'),
    onStart: () => void openMenu(),
    onUse: () => { selectUntil = frame + 40; },
    mini: {
      draw: (c, x, y, size) => c.drawImageTo(miniCanvas, 0, 0, MINI_MAP, MINI_MAP, x, y, size, size),
      key: () => miniFrame(link?.room.actor(link.me) ?? (spectating && follow ? link?.room.actor(follow) : undefined)),
    },
    bumpers: {
      onBag: () => void runMenu('2'),
      bag: () => bagArtOf(),
      keys: desk ? { party: 'Q', bag: 'E', ctx: 'SHIFT' } : undefined,
    },
  });
  document.getElementById('hud-menu')!.addEventListener('click', () => openSheet());
  wireDialHold(hud.buttons.ctx);
  if (desk) hud.buttons.ctx.title = 'Hold for the key items';
  const scale = () => {
    // A window with a mouse: whole pixels, by its height (Cam, 11-01: the bar "feels very
    // sort of hidden", and a TM's name in it went unread).
    const s = windowScale();
    document.documentElement.style.setProperty('--s', String(s));
    // One of them, its moves beside it, is the widest a battle's windows go.
    document.body.classList.toggle('desk-wide', desk && innerWidth >= DESK_WIDE_W * s);
    hud.setScale(s);
    msgBox.setScale(s);
    itemTag.setScale(s);
    dialTip.setScale(s);
  };
  addEventListener('resize', scale);
  scale();
  document.body.classList.add(desk ? 'desk-hud' : 'phone-hud');
  refreshHud = () => {
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
    dialTipFrame(!!mine && !ring.safari && !battle && !swapping && !romUp && !asking && !spectating && !lobby?.shown);
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
      lead: mine && fogged ? rom?.leadHp() || null : null,
      // Facing water on foot (or surfing), the rod: SELECT casts it there (room.ts).
      ctx: !me.m.bike && classAt(aheadOf(me)) === CLASS_WATER && rodOf(rom?.rod() ?? 0) >= 0
        ? { label: 'FISH', item: rom!.rod(), enabled: true }
        : bikeNow(me),
      party: rom?.partyCount() ?? 0,
      moves: mine && !mine.battling ? fieldChips(mine) : [],
    });
  };
  setInterval(refreshHud, 100);
}

/** gBrHmView's bits (include/br/br_hm.h): HM n+1's move at bit n. */
const HM_CUT = 1 << 0, HM_SURF = 1 << 2, HM_STRENGTH = 1 << 3, HM_DIVE = 1 << 7;

/** The phone HUD's field moves (HBR-78) as the page knows them: the team's CUT, SURF and
 *  STRENGTH (the actor's field bits, rom.field()), each lit when the cell ahead is what
 *  it works on. /classic/ reads gBrHmView, which this page's hidden ROM never fills for
 *  the page's own world. */
/** The cell `a` faces, on its own map. */
function aheadOf(a: Actor): Spot {
  const { map, x, y } = a.m.spot;
  const d = ({ 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] } as Record<number, number[]>)[a.m.facing] ?? [0, 0];
  return { map, x: x + d[0], y: y + d[1] };
}

function fieldChips(a: Actor): FieldMove[] {
  const bits = a.field ?? 0;
  const can = (bits & FIELD_CUT ? HM_CUT : 0) | (bits & FIELD_SURF ? HM_SURF : 0) | (bits & FIELD_STRENGTH ? HM_STRENGTH : 0) | (bits & FIELD_DIVE ? HM_DIVE : 0);
  if (!can) return [];
  const ahead = classAt(aheadOf(a));
  const surfing = classAt(a.m.spot) === CLASS_WATER;
  // DIVE lights over a dive spot (down) and anywhere below it may come up (br_hm.c).
  const dive = diveTo(link.room.maps, link.room.world, a.m.spot, bits) ? HM_DIVE : 0;
  const ready = (ahead === CLASS_CUT ? HM_CUT : 0) | (ahead === CLASS_WATER && !surfing ? HM_SURF : 0) | (ahead === CLASS_BOULDER ? HM_STRENGTH : 0) | dive;
  return fieldMoves(can, ready & can);
}

/** A phone's battle menu (the live game's ui/battlemenu.ts): FIGHT, BAG, POKeMON, RUN
 *  and the moves as windows under the hidden ROM's picture, tapped rather than walked to
 *  with the D-pad; the live TouchLayer walks the ROM's cursor to what was tapped. */
/** The trainers' cards over the picture, GBA pixels: a card and a gap either side. */
const CARDS_ROOM = CARD_H + 8;
/** What the battle menu wants under the picture at its tallest (four moves, BACK, the hint). */
const MENU_ROOM = 2 * CELL_H + BACK_H + 48;
/** Both trainers beside a trainer battle (ui/sides.ts), a phone's or a desktop's. */
function wireSides(emu: Awaited<ReturnType<typeof loadRom>>['emu'], sym: (n: string) => number | undefined): void {
  new SidesView(document.getElementById('sides')!, emu, sym, () => {
    const box = gbaCanvas.getBoundingClientRect();
    const s = box.width / 240;
    return s > 0 && battleEl.classList.contains('on')
      ? { scale: s, cols: innerWidth / s, rows: innerHeight / s, lcdCol: box.left / s, lcdRow: box.top / s }
      : { scale: 0, cols: 0, rows: 0, lcdCol: 0, lcdRow: 0 };
  }).attach();
}

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
  const partyAt = sym('gPlayerParty'), countAt = sym('gPlayerPartyCount');
  const task = sym('Task_HandleChooseMonInput'), tasks = sym('gTasks'), partyMenu = sym('gPartyMenu');
  /** struct Task: 16 of them, 40 bytes, func first and isActive after it. */
  const choosing = () => {
    if (task === undefined || tasks === undefined) return false;
    for (let i = 0; i < 16; i++) {
      if (emu.read(tasks + i * 40 + 4, 8) && ((emu.read(tasks + i * 40, 32) ^ task) & ~1) === 0) return true;
    }
    return false;
  };
  const PARTY_SLOT_ID = 9;
  /** gBrPartyScreen: a pointer in the ROM to the party screen's callback. */
  const partyCbAt = sym('gBrPartyScreen');
  const partyCb = partyCbAt === undefined ? undefined : new DataView(files.rom.buffer, files.rom.byteOffset).getUint32(partyCbAt - 0x08000000, true);
  const partyUp = () => {
    const main = sym('gMain');
    return main === undefined || partyCb === undefined || ((emu.read(main + 4, 32) ^ partyCb) & ~1) === 0;
  };
  /** The party screen's own prompt, which a refusal's line gives way to. */
  const CHOOSE_MON = /^Choose a POK/;
  // All of it counted in the ROM's frames, as the keys it presses are (touch.ts): it runs at
  // HURRY_SPEED, when the page sees about one in eight.
  let walk: { slot: number; step: number; frames: number; beat: number; item: boolean; move?: number; forced?: boolean; why?: string } | null = null;
  /** The ROM's BAG and party under the windows, from the click until the battle is back and drawn:
   *  nobody sees them, so at HURRY_SPEED. Cam, 11-04: "selected an item, selected the Pokemon, and
   *  we fully waited like five seconds". */
  let unseen: { gone: boolean; frames: number } | null = null;
  const hide = () => {
    rom?.unseen(true);
    unseen = { gone: false, frames: 0 };
    hiding = true;
    promptOff = true;
    if (seeing) clearPrompt();
  };
  const walkParty = (slot: number) => {
    hide();
    walk = { slot, step: 0, frames: 0, beat: 0, item: false };
    partyHold = true;
    partyGone = false;
    partyHeld = 0;
    touch.chooseBattle(MENU_ACTION, 2);
  };
  // A medicine on one of them: the ROM's BAG USEs it and its party asks, both unseen. The page
  // has asked already.
  const pickFromBag = (pocket: number, item: number) => touch.chooseBattle(MENU_ACTION, 1, undefined, () => {
    emu.write(sym('gBagPosition')! + BAG_POSITION_POCKET, pocket, 8);
    emu.write(sym('gBrBag')!, item, 16);
  });
  /** A USE with nobody to ask about (an X item, a ball, a doll): the ROM's BAG does it, unseen, and
   *  stood there on its own screen when it refused. Its line goes on the page's box instead and B
   *  leaves it, the turn still ours; used, its line is pressed past. */
  let bagUse: { pocket: number; item: number; was: number; frames: number; next: number; waited: number; said: boolean } | null = null;
  const useFromBag = (pocket: number, item: number) => {
    hide();
    bagUse = { pocket, item, was: readPocket(emu, sym, pocket).find((x) => x.item === item)?.n ?? 0, frames: 0, next: BAG_USE_READ, waited: 0, said: false };
    pickFromBag(pocket, item);
  };
  const bagUseFrame = (step: number) => {
    const u = bagUse;
    if (!u) return;
    const main = sym('gMain'), bag = sym('CB2_BagMenuRun');
    if (main === undefined || bag === undefined || (u.waited += step) > BAG_USE_MAX) { bagUse = null; return; }
    const inBag = ((emu.read(main + 4, 32) ^ bag) & ~1) === 0;
    // Asked for and not up yet; or up, and now gone: the battle has it.
    if (!inBag) { if (u.frames) bagUse = null; return; }
    if (emu.read(sym('gBrBag')!, 16)) return;
    bagFrames = 0;
    if ((u.frames += step) < u.next) return;
    u.next = u.frames + 30;
    const left = readPocket(emu, sym, u.pocket).find((x) => x.item === u.item)?.n ?? 0;
    if (left < u.was) { touch.tapKey('a'); return; }
    if (!u.said) {
      u.said = true;
      say(refusedLine(u.pocket, u.item));
    }
    touch.tapKey('b');
  };
  const useOn = (pocket: number, item: number, slot: number, move?: number) => {
    hide();
    walk = { slot, step: 0, frames: 0, beat: 0, item: true, move };
    partyHold = true;
    partyGone = false;
    partyHeld = 0;
    pickFromBag(pocket, item);
  };
  let ranAt = 0;
  emu.onFrame(() => {
    const step = Math.max(1, emu.ran - ranAt);
    ranAt = emu.ran;
    bagUseFrame(step);
    if (unseen) {
      const main = sym('gMain'), fight = sym('BattleMainCB2');
      const inFight = main !== undefined && fight !== undefined && ((emu.read(main + 4, 32) ^ fight) & ~1) === 0;
      if (!inFight) unseen.gone = true;
      unseen.frames += step;
      // Never left the battle (the clock took the turn as the click landed): that turn is one to see.
      if (!battle || unseen.frames > (unseen.gone ? UNSEEN_MAX : UNSEEN_START) || (!walk && !bagUse && unseen.gone && battleBack())) {
        rom?.unseen(false);
        unseen = null;
        hiding = false;
        hidUntil = emu.ran;
        promptOff = false;
      }
    }
    // One has fainted: the ROM's fade and party stay behind the picture until it is answered.
    const brAt = sym('gBrBattle');
    if (brAt !== undefined && emu.read(brAt + BATTLE_MENU, 8) === MENU_PARTY) {
      partyHold = true; partyGone = true; partyHeld = 0;
    }
    menu.away = !!walk;
    if (!walk) return;
    walk.frames += step;
    walk.beat += step;
    const every = (n: number) => { if (walk!.beat < n) return false; walk!.beat = 0; return true; };
    if (walk.step === 0) {
      // Its screen up and its fade over: its task is there a frame before the fade begins, and takes
      // no keys through it.
      if (choosing() && partyUp() && !romFading()) {
        emu.write(partyMenu! + PARTY_SLOT_ID, walk.slot, 8);
        touch.tapKey('a');
        walk.step = walk.item ? (walk.move === undefined ? 5 : 6) : 1;
        walk.frames = 0;
        walk.beat = 0;
      } else if (walk.frames > 400) { walk = null; partyHold = false; }
    } else if (walk.step === 1 && walk.frames > 40) {
      // Its little menu: SHIFT, SUMMARY, CANCEL.
      touch.tapKey('a');
      walk.step = 3;
      walk.frames = 0;
      walk.beat = 0;
    } else if (walk.step === 3 && every(30)) {
      // SHIFT is taken once its question has printed: pressed again until the party is gone.
      // Back on the party's list means the ROM said no (trapped, say): its line, then out. The
      // line was on the ROM's screen, which nobody sees: the page went back to "What will ALAKAZAM
      // do?" with no word why, whichever mon was picked (Cam, 11-08). TrySwitchInPokemon leaves it
      // in gStringVar4 ("ALAKAZAM can't be switched out!", "...'s SHADOW TAG prevents switching!")
      // while its message is up; back on the list, it is "Choose a POKéMON." again.
      const main = sym('gMain'), fight = sym('BattleMainCB2');
      const inFight = main !== undefined && fight !== undefined && ((emu.read(main + 4, 32) ^ fight) & ~1) === 0;
      const at = sym('gStringVar4');
      const line = at === undefined ? '' : battleText(emu.bytes(at, 120));
      if (!inFight && !choosing() && line && !CHOOSE_MON.test(line)) walk.why ??= line;
      if (inFight) walk = null;
      else if (choosing()) {
        say(walk.why ?? "It can't be switched out!", 4000);
        rom?.sound(SE_FAILURE);
        touch.tapKey('b');
        walk = null;
      }
      else if (walk.frames > 400) { touch.tapKey('b'); walk = null; }
      else touch.tapKey('a');
    } else if (walk.step === 6) {
      // An ETHER's "restore which move?": down to it, and A.
      if (walk.frames > 40 && every(12)) {
        if (walk.move! > 0) { touch.tapKey('down'); walk.move!--; } else { touch.tapKey('a'); walk.step = 5; walk.frames = 0; walk.beat = 0; }
      }
    } else if (walk.step === 5 && every(30)) {
      // Its line on the party's own screen is pressed past, until the battle is back. The bag
      // again means the ROM would not have it (nothing to cure, say): out, the turn still ours.
      const main = sym('gMain'), fight = sym('BattleMainCB2'), bag = sym('CB2_BagMenuRun');
      const cb2 = main === undefined ? 0 : emu.read(main + 4, 32);
      if (fight !== undefined && ((cb2 ^ fight) & ~1) === 0) walk = null;
      else if ((bag !== undefined && ((cb2 ^ bag) & ~1) === 0) || walk.frames > 400) {
        if (((cb2 ^ (bag ?? 0)) & ~1) === 0) say("It won't have any effect.");
        touch.tapKey('b');
        walk = null;
      }
      else touch.tapKey('a');
    }
  });
  const membersOf = (bytes: Uint8Array, count: number) => teamMembers(bytes, count, speciesName).map((m) => ({
    ...m,
    moves: m.moves.map((v, n) => ({ ...v, maxPp: ppWithBonus(moveInfo(tables, v.id)?.pp ?? 0, m.ppBonuses, n) })),
    itemName: art?.itemName(m.item) ?? '',
    ability: art?.abilityName(m.species, m.ability) ?? '',
    abilityNum: m.ability,
    active: false,
  }));
  readMon = (mon) => membersOf(mon, 1)[0] ?? null;
  const menu = new BattleMenu({
    root,
    rom: tables,
    choose: (which, slot, move) => touch.chooseBattle(which, slot, move),
    back: () => touch.tapKey('b'),
    focusFirst: !touchPad,
    refit: touchPad ? () => resize() : undefined,
    firstMoves: {
      readParty: () => {
        if (partyAt === undefined || countAt === undefined) return [];
        const count = emu.read(countAt, 8);
        const rows = membersOf(emu.bytes(partyAt, PARTY_LEN).slice(), count);
        if (panelUp) return rows;
        // A slot here is a slot of the ROM's party screen, which shows the battle's order, the one out
        // first. The party is only in that order while that screen is up (party_menu.c
        // UpdatePartyToBattleOrder); in the battle it is in the field's. Read as if it always were, a
        // switch left the wrong one marked as out, and when the one switched in fainted, the other
        // could not be chosen: the fight stood there for good.
        const main = sym('gMain'), fight = sym('BattleMainCB2');
        const onItsScreen = main !== undefined && fight !== undefined && ((emu.read(main + 4, 32) ^ fight) & ~1) !== 0;
        const order = battleOrder(emu, sym), lead = leadIndex(emu, sym);
        return rows.map((_, slot) => ({ ...rows[onItsScreen ? slot : order[slot]], active: order[slot] === lead }));
      },
      icon: (species) => monIconOf(species),
      bag: () => bagArtOf(),
      keys: touchPad ? undefined : { party: 'Q', bag: 'E' },
      switchTo: (slot) => walkParty(slot),
      showMon: (rows, at) => summaryWin?.open(rows.map((r) => (r.joins ? { ...r, ...r.joins } : r)), at, () => menu.isShown),
      useOn,
      sendOut: (slot) => { hide(); walk = { slot, step: 0, frames: 0, beat: 0, item: false, forced: true }; },
      field: {
        close: closePanel,
        readBag: () => readFieldBag(emu, sym),
        moves: (slot) => {
          const m = readTeam()[slot];
          if (!m || !learnRows(m).length) { say('No new moves at this level.'); return; }
          movesBox?.open(slot, () => panelUp, (at) => { if (panelUp) menu.showMember(at); });
        },
        swap: async (a, b) => { await rom?.reorder(a, b); },
        give: async (slot, item) => { if (await rom?.take(item)) await rom?.setHeld(slot, item); },
        take: async (slot, item) => { await rom?.setHeld(slot, 0); await rom?.give(item, 1); },
        use: (pocket, item, slot, move) => {
          if (useKeyItem(item)) return;
          const count = () => readPocket(emu, sym, pocket).find((x) => x.item === item)?.n ?? 0;
          const was = count();
          void panelWalk((r) => r.menu(2, panelShow, panelHide, { to: 'use', pocket, item, slot, move })).then(() => {
            if (count() >= was && panelUp) say("It won't have any effect.");
          });
        },
      },
    },
    onShown: (on) => document.body.classList.toggle('battle-menu', on),
    readBag: () => readBattleBag(emu, sym, tables),
    useItem: sym('gBrBag') !== undefined && sym('gBagPosition') !== undefined
      ? useFromBag
      : undefined,
    refused: () => { rom?.sound(SE_FAILURE); say("It won't have any effect."); },
  });
  battleMenu = menu;
  movesBox = new MovesBox({
    rom: tables,
    icon: (species) => monIconOf(species),
    team: () => readTeam(),
    list: learnRows,
    teach: (slot, row) => teach(slot, row, menu),
    scale: windowScale,
    touch: touchPad,
  });
  readTeam = () => menu.readTeam();
  summaryWin = new SummaryWindow({ rom: tables, pic: (species) => art?.monPic(species, false) ?? null, speciesName, scale: windowScale, touch: touchPad });
  // A window with a mouse: the windows at their whole-pixel size, under a picture fitted to what
  // they leave. A phone's follow its picture.
  const DESK_MENU_H = 136;
  const resize = () => {
    // The windows alone: no picture for them to follow, on a phone either.
    if (touchPad && (battleEl.classList.contains('panel') || (innerWidth > innerHeight && menu.standsAlone))) {
      menu.setRoom(Infinity);
      const s = menu.fillScale();
      battleEl.style.setProperty('--s', String(s));
      menu.setScale(s);
      return;
    }
    if (!touchPad) {
      const s = Math.max(1, Math.floor(menu.fitScale(windowScale())));
      battleEl.style.setProperty('--s', String(s));
      battleEl.style.setProperty('--pic', String(Math.max(2, Math.floor((innerHeight - (DESK_MENU_H + 8) * s - 8) / 160))));
      menu.setScale(s);
      menu.setRoom(Infinity);
      return;
    }
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
    if (!touchPad) return;
    const s = gbaCanvas.getBoundingClientRect().width / 240;
    const fits = s > 0 && innerHeight / s >= CARDS_ROOM + 160 + MENU_ROOM;
    battleEl.classList.toggle('cards', fits && innerHeight > innerWidth && trainerFight());
  };
  wireSides(emu, sym);
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
    // 2: the windows stand over the message box (a phone on its side), and its clock goes back up.
    if (hudBase !== undefined) emu.write(hudBase + HUD.OFF_NO_BATTLE_BOX, !up ? 0 : menu.isShown && root.classList.contains('bm-lift') ? 2 : 1, 8);
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
  sendJank();
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
  // The followed trainer's steps, as field_player_avatar.c and field_screen_effect.c sound
  // them: a wall's thud at each bump, a ledge's hop, a door (SE_DOOR, from outside) or a
  // mat or stairs (SE_EXIT, DoWarp) at each warp.
  const a = follow ? link.room.actor(follow) : undefined;
  const act = a?.m.action;
  // Its one line, the first time on it: nothing on the bike says what B does now.
  if (!acroSaid && a && a.id === link.me && a.m.bike && a.m.acro) {
    acroSaid = true;
    say('Hold B to hop. B and a sideways press jumps.', 4000);
  }
  if (act && act !== heardAction) {
    if (act.kind === 'bump') rom?.sound(SE_WALL_HIT);
    else if (act.kind === 'hop') rom?.sound(act.arc === undefined ? SE_LEDGE : SE_BIKE_HOP);
    else if (act.kind === 'warp') rom?.sound(placed.get(a!.m.spot.map)?.m.outdoor ? SE_DOOR : SE_EXIT);
  }
  heardAction = act;
}
let heardAction: unknown = null;
let acroSaid = false;
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
const HIDDEN = new Map<string, { map: string; x: number; y: number; item: number }>();
// Its own chunk, with main at its budget (vite.config.ts): here well before anybody stands on a map.
void import('./data/hidden.json').then((d) => { for (const [m, x, y, item] of d.default as [string, number, number, number][]) HIDDEN.set(`${m}:${x}:${y}`, { map: m, x, y, item }); }, (e) => console.warn('spike hidden', e));
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
/** Lines waiting their turn (never one twice running, ticks.ts), and when the one
 *  showing goes. */
const ticks = new Ticks();
let tickUntil = 0;
/** Everybody's news, one line at a time (ticker.ts): outs, the ring, a gym, the win. */
function tick(text: string, alert = false): void {
  ticks.push(text, alert);
}
/** Outs that land together go out as one line (POK-324). */
let toldOuts = 0;
let outsSince = 0;
let hudRound = -1;
let toldOpening = -1;
let toldWin = false;
let cornerText = '';
/** br_hud.h: how long the corner's count and its other line each have it. */
const BR_HUD_ALT_FRAMES = 120;
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
  if (battleEl.classList.contains('on') || watch.viewing) {
    if (tickUntil) { tickUntil = 0; msgBox.hide(); }
  } else if (!sayUntil && !casting && now >= tickUntil) {
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
  const inFog = !isOut && inFogNow(), fog = inFog && frame % 60 < 30;
  // In the fog the count takes turns with the lead's HP, two seconds each (br_hud.c
  // DrawCorner, BR_HUD_ALT_FRAMES): a team bleeding with nothing on screen to say so
  // (POK-358).
  const lead = inFog && frame % (2 * BR_HUD_ALT_FRAMES) >= BR_HUD_ALT_FRAMES ? rom?.leadHp() : '';
  const text = `${lead || count}\n${fog ? 'FOG!' : clock}`;
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
    // No line for the fog or the level any more: the fog is there to see (Cam, 11-03).
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
  // The Safari's battles are the Zone's: whoever threw their last ball and dropped early
  // is in Hoenn while the clock still runs, and a wild one there is an ordinary fight.
  rom?.setSafari(!!ring.safari && !!link.room.actor(link.me)?.m.spot.map.startsWith(SAFARI));
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
  if (fog && !wasInFog) fogTimer = FOG_TICK;
  wasInFog = fog;
  if (!fog || --fogTimer > 0) return;
  fogTimer = FOG_TICK;
  poisonAt = frame;
  rom.sound(SE_FIELD_POISON);
  void rom.bleed().then((alive) => { if (!alive) goOut('Your team fainted in the fog.'); });
}

/** The fog over everything outside the ring, the inside left clear: the ROM's own
 *  (WEATHER_FOG_HORIZONTAL, the live match's field) -- its 64x64 picture tiled with the
 *  world, drifting left a pixel every four frames (FogHorizontal_Main), blended as the
 *  GBA does at the coefficients it settles at, fog*12/16 + ground*8/16 (field.ts drawFog).
 *  A patch whose symbols do not name the picture yet gets a flat veil. */
let fogTile: HTMLCanvasElement | null | undefined;
const FOG_SIZE = 64;
/** Each fog bite on the field is felt as a poison step is (br_ring.c Bleed, POK-358):
 *  fldeff_misc.c Task_FieldPoisonEffect's mosaic, up 2 a frame past 8 and back down, a
 *  block of (n + 1) GBA pixels, on the map's layers -- the ground and the roofs over the
 *  sprites alike (overworld.c sets BG1-3's mosaic) -- and not on the sprites. */
const POISON_MOSAIC = [2, 4, 6, 8, 10, 8, 6, 4, 2];
let poisonAt = -99;
/** This frame's mosaic block, in canvas pixels; 0 for none. */
function poisonBlock(z: number): number {
  const n = POISON_MOSAIC[frame - poisonAt];
  return n ? Math.max(1, Math.round((n + 1) * z)) : 0;
}
const mosaicCanvas = document.createElement('canvas');
/** `c`, a canvas the size of the field's, in blocks of `b` pixels. */
function pixelate(c: HTMLCanvasElement, b: number): void {
  const w = Math.ceil(c.width / b), h = Math.ceil(c.height / b);
  if (mosaicCanvas.width !== w || mosaicCanvas.height !== h) { mosaicCanvas.width = w; mosaicCanvas.height = h; }
  const m = mosaicCanvas.getContext('2d')!;
  m.imageSmoothingEnabled = false;
  m.clearRect(0, 0, w, h);
  m.drawImage(c, 0, 0, w * b, h * b, 0, 0, w, h);
  const x = c.getContext('2d')!;
  x.save();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, c.width, c.height);
  x.drawImage(mosaicCanvas, 0, 0, w, h, 0, 0, w * b, h * b);
  x.restore();
}
/** The roofs' layer while a mosaic is on: drawn apart, blocked, then laid over. */
const coverCanvas = document.createElement('canvas');

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
  if (ring.phase === 0) return `fog in ${clock}${where}`;
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
const PAD_DEFAULT: Record<number, string> = { 0: 'a', 1: 'b', 2: 'b', 3: 'a', 4: 'l', 5: 'r', 8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const PAD_HAT: string[][] = [['up'], ['up', 'right'], ['right'], ['down', 'right'], ['down'], ['down', 'left'], ['left'], ['up', 'left']];
function padMap(): Record<number, string> {
  try {
    const saved = JSON.parse(localStorage.getItem('hbr.padmap') ?? 'null') as Record<string, string> | null;
    const out: Record<number, string> = {};
    for (const [i, k] of Object.entries(saved ?? {})) if (GBA_KEY[k] || k === 'l' || k === 'r') out[Number(i)] = k;
    return Object.keys(out).length ? { ...out, 12: 'up', 13: 'down', 14: 'left', 15: 'right' } : PAD_DEFAULT;
  } catch { return PAD_DEFAULT; }
}
function padDown(k: string): void {
  if (intro()) return;
  if (lobby?.shown) { if (GBA_KEY[k]) lobby.stage.key(GBA_KEY[k]); return; }
  if (pageWin.up) { pageWin.key(k); return; }
  if (battleMenu?.isShown) { battleMenu.press(k); return; }
  if (k === 'l' || k === 'r') {
    if (!asking && !battle && !swapping && !romUp) void runMenu(k === 'l' ? '1' : '2');
    return;
  }
  if (!held.has(k)) pressed.add(k);
  held.add(k);
  if (asking) askKey(k);
  else if ((battle || swapping || romUp) && rom) rom.press(GBA_KEY[k]);
  else if (k === 'start') void openMenu();
}
function padUp(k: string): void {
  battleMenu?.release(k);
  held.delete(k);
  if (GBA_KEY[k]) rom?.release(GBA_KEY[k]);
}
// The touch pad: the live game's D-pad, A, B and START, the same as a controller's.
/** A short tap of haptic feedback as a pad button goes down (the live game's buzz, POK-245):
 *  A, B and START, not the D-pad. On the D-pad every step and every slide of the thumb to a
 *  new way buzzed, all the time you walk (a Reddit player on Android, 11-12: "it vibrates";
 *  an iPhone has no vibrate, so it was never felt here). A phone without it, every desktop,
 *  and a page not touched yet get nothing. */
function buzz(ms = 8): void {
  try { navigator.vibrate?.(ms); } catch { /* refused: not worth a word */ }
}
wireDpad(document.getElementById('dpad-surface')!, padDown, padUp);
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
  let padId = '';
  let triggerHeld = false, triggerPad = '';
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
      // The dial up: the right stick leans too, and its lean is nobody's walk.
      if (radial.isOpen) {
        const dx = (pad.axes[2] ?? 0) - (base[2] ?? 0), dy = (pad.axes[3] ?? 0) - (base[3] ?? 0);
        if (Math.hypot(dx, dy) > 0.5) radial.aim(dx, dy);
      }
      if (pad.buttons[PAD_RT]?.pressed) triggerPad = pad.id;
      for (const k of padStick ? stickKeys(pad.axes, base, padStick) : guessedStickKeys(pad.axes, base).keys) if (GBA_KEY[k]) now.add(k);
      const hat = pad.axes.length >= 10 ? pad.axes[9] : 9;
      if (hat >= -1.1 && hat <= 1.1) for (const k of PAD_HAT[Math.round((hat + 1) * 3.5) % 8]) now.add(k);
      if (now.size) padId = pad.id;
    }
    buttonsHeld = pressedNow;
    // The right trigger: held for the dial, and it goes on the way up.
    const rt = pressedNow.has(PAD_RT) && !padKeys[PAD_RT];
    if (rt !== triggerHeld) {
      triggerHeld = rt;
      if (rt) { inputPad(triggerPad, padKeys); openDial(); } else radial.release();
    }
    // A fresh press (not a drifting stick) is what makes the key hints a pad's.
    if ([...now].some((k) => !padHeld.has(k))) inputPad(padId, padKeys);
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
  // A window with a mouse: a phone's pixel size, as /classic/ has it (field.ts fieldScale),
  // and more map rather than a bigger one (Cam, 11-01: "we're really zoomed in").
  if (matchMedia('(pointer: fine)').matches) {
    const dpr = devicePixelRatio || 1;
    return Math.max(1, Math.floor(fieldScale(innerWidth, innerHeight, dpr, Math.min(screen.width, screen.height)) * dpr));
  }
  // The game's own view: the GBA's 15 x 10 tiles fit the window, the way the game
  // scales its picture (portrait phones get 15 across, not 15 tall: Cam found that
  // "more zoomed in than normal").
  return Math.max(1, Math.floor(Math.min(devW / 15, devH / 10) / TILE));
}

/** What the player chose (zoom.ts), inside this window's range. */
let zoomSaved: number | null = null;
try { zoomSaved = loadZoom(localStorage); } catch { /* a blocked store: the default */ }
const zoomChoices = () => zoomRange(devW, devH, fitZoom());
function playZoom(): number { return pickedZoom(zoomSaved, fitZoom(), zoomChoices()); }
/** Takes a new choice, keeps it, and shows it on the field. */
function chooseZoom(z: number): void {
  if (z === zoomSaved && zoom === z) return;
  zoomSaved = z;
  try { saveZoom(localStorage, z); } catch { /* not kept */ }
  zoom = z;
  toast(`ZOOM ${zoomLabel(z, zoomChoices())}`);
}
/** Whole steps closer (+) or farther (-), stopping at the ends. */
const zoomBy = (steps: number) => chooseZoom(clampZoom(playZoom() + steps, zoomChoices()));
/** A spectator's free zoom: out no farther than where a trainer in a room sees only that room. */
const spectateZoom = (z: number) => Math.min(8, Math.max(roomFloor(devW, devH), z));

function resize(): void {
  const dpr = devicePixelRatio || 1;
  devW = Math.round(innerWidth * dpr);
  devH = Math.round(innerHeight * dpr);
  zoom = spectating ? spectateZoom(zoom) : playZoom();
}
addEventListener('resize', resize);

function toggleSpectate(): void {
  if ((isOut || waiting) && spectating) return; // out: watching is all there is
  spectating = !spectating;
  modeBtn.classList.toggle('on', spectating);
  modeBtn.textContent = spectating ? 'Back to my trainer (V)' : 'Spectate (V)';
  if (!spectating) { follow = link.me; zoom = playZoom(); }
  held.clear();
}
modeBtn.addEventListener('click', toggleSpectate);

// ---- the play-test's marks and its file (recorder.ts) ---------------------------------

const markToast = document.getElementById('mark-toast')!;
let markToastOff = 0;
function toast(text: string): void {
  markToast.textContent = text;
  markToast.hidden = false;
  clearTimeout(markToastOff);
  markToastOff = window.setTimeout(() => { markToast.hidden = true; }, 2000);
}

/** This moment, and where the camera looks, for tools/br/replay.ts. */
function markHere(via: 'key' | 'sheet'): void {
  const p = link ? mapUnder(cam.x, cam.y) : null;
  const where = p ? { map: p.m.id, x: Math.floor(cam.x / TILE - p.gx), y: Math.floor(cam.y / TILE - p.gy) } : { map: '', x: 0, y: 0 };
  const n = recorder.mark(via, where);
  buzz(30);
  toast(`MARK ${n}  ${where.map.replace('MAP_', '')} ${where.x},${where.y}`);
}

function saveLog(): void {
  void saveRecording().then((name) => toast(`SAVED ${name}`), (e) => { console.error('[recorder] could not save', e); toast('Could not save the log'); });
}
document.getElementById('save-log')!.addEventListener('click', saveLog);

const watch = new Watch({
  trainers: () => (link ? actors() : []),
  me: () => link?.me ?? 0,
  spectating: () => spectating,
  follow: () => follow,
  setFollow: (id) => { follow = id; if (id && zoom < 1) zoom = playZoom(); },
  zoom: () => zoom,
  link: () => link ?? null,
  rom: () => rom,
  idle: () => (isOut || waiting) && !battle && !swapping && !asking,
  describe: (key) => {
    const r = link.room;
    for (const g of r.ground().values()) if (g.key === key) return art?.itemName(g.item) || null;
    const s = r.spills.get(key);
    if (!s || s.legend || s.person?.gate !== undefined) return null;
    if (s.person) return s.bag.items[0] ? art?.itemName(s.bag.items[0].id) || null : null;
    return spillName(s, "'s bag", (id) => art?.itemName(id) ?? '');
  },
  tell: (text) => tick(text),
  cover,
  lastRing: () => !!link?.room.ring().last,
  view: (side) => {
    if (!art) return null;
    const v: BattleView = new BattleView(document.getElementById('battleview-host')!, { art, behind: () => fieldBehind(v.canvas) }, { follow: side, levels: false });
    return v;
  },
});

/** The field under a watched fight, as the battle's own canvas sits over it: the camera is on the
 *  trainer watched, so this is where they stand, dimmed as #battle.see dims a trainer's own. */
const behindCanvas = document.createElement('canvas');
behindCanvas.width = 240;
behindCanvas.height = 160;
function fieldBehind(over: HTMLCanvasElement): HTMLCanvasElement {
  const g = behindCanvas.getContext('2d')!;
  const r = over.getBoundingClientRect(), w = canvas.getBoundingClientRect();
  const kx = canvas.width / (w.width || 1), ky = canvas.height / (w.height || 1);
  g.imageSmoothingEnabled = false;
  g.drawImage(canvas, (r.left - w.left) * kx, (r.top - w.top) * ky, r.width * kx, r.height * ky, 0, 0, 240, 160);
  g.fillStyle = '#0007';
  g.fillRect(0, 0, 240, 160);
  return behindCanvas;
}

// Drag and pinch / wheel, spectating only. A tap on a trainer follows them.
const pointers = new Map<number, { x: number; y: number }>();
let pinch0: { d: number; zoom: number } | null = null;
let moved = 0;
let tapAt: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (spectating) canvas.setPointerCapture(e.pointerId);
  else tapAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = 0;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    tapAt = null; // two fingers are a pinch, not a place to walk to
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (!spectating) {
    // On my own trainer a pinch is the same choice as the wheel's: whole steps, kept.
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinch0) {
      const [a, b] = [...pointers.values()];
      chooseZoom(clampZoom(Math.round((pinch0.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch0.d), zoomChoices()));
    }
    return;
  }
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
    zoom = spectateZoom((pinch0.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch0.d);
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
let wheelSum = 0;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!spectating) {
    // A trackpad's pinch comes as a wheel with Ctrl held, in much smaller deltas.
    const { steps, rest } = wheelSteps(wheelSum, e.ctrlKey ? e.deltaY * 8 : e.deltaY);
    wheelSum = rest;
    if (steps) zoomBy(steps);
    return;
  }
  zoom = spectateZoom(zoom * Math.exp(-e.deltaY * 0.0015));
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
  if (best) { follow = best.id; if (zoom < 1) zoom = playZoom(); }
}

/** An actor's tile top-left in world pixels, mid-step included. */
function pixelOf(a: Actor): { x: number; y: number; lift: number } {
  const g = global(a.m.spot)!;
  const off = seamGlide.offset(a.id, frame);
  return { x: (g.gx + off.x) * TILE + a.m.px, y: (g.gy + off.y) * TILE + a.m.py, lift: -a.m.lift };
}

/** A step over a seam that doesn't meet in the plane is a glide, not a jump (seamglide.ts). */
const seamGlide = new SeamGlide();
function seamFrame(all: readonly Actor[]): void {
  for (const a of all) {
    seamGlide.look(a.id, a.m.spot.map, frame, (from, to) => {
      const p = placed.get(from), q = placed.get(to);
      return p && q ? seamOff(p, q) : null;
    });
  }
}

/** The frame a trainer's sheet is drawn at: the ACRO BIKE's own, or on foot (poses.ts). One
 *  stopped for a battle stands as the walk does, whatever it was doing as it stopped. */
function frameOf(a: Actor): number {
  const wheelie = a.m.bike && a.m.acro && a.skin < 2 ? acroFrame(a.m) : null;
  if (wheelie !== null) return wheelie;
  return footPose(a.m, !a.battling && SHEETS[String(SKIN_GFX[a.skin])].frames >= 18);
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

let heights: Heights | null = null;
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
    // Ash is grass under its dust (Cam, 11-01: "reuse the same sprites from the grass").
    else if (art!.behavior(p.m.group, p.m.num, q.x, q.y) === MB_ASHGRASS) ctx.drawImage(patchArt.grass, f * TILE, 0, TILE, TILE, x, y, TILE, TILE);
    else {
      ctx.fillStyle = '#181818';
      ctx.beginPath();
      ctx.ellipse(x + 8 + drift, y + 12, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---- what a step leaves on the ground (fieldfx.ts) --------------------------------------

/** FLDEFFOBJ_* of each effect's sheet. */
const FX_OBJ: Record<FxKind, number> = { grass: 4, ash: 6, dust: 9, foot: 11, splash: 13, long: 15, deep: 23, tire: 27 };
const fxArt = new Map<FxKind, HTMLCanvasElement>();
function fxSheet(k: FxKind): HTMLCanvasElement | null {
  if (!art) return null;
  let s = fxArt.get(k);
  if (!s) fxArt.set(k, (s = art.fieldEffect(FX_OBJ[k], FX_SHEETS[k].frames, FX_SHEETS[k].h)));
  return s;
}
/** The cells whose ash has been walked off, by map: y * w + x. A new round's has come back. */
const ashGone = new Map<string, Set<number>>();
let ashRound = -1;
let effects: Effect[] = [];
/** Where each actor was last frame, to see a step start: id -> the cell, and the way they were going. */
const stepSeen = new Map<number, { spot: Spot; dir: number }>();

function clearAsh(p: Placed, x: number, y: number): void {
  let cells = ashGone.get(p.m.id);
  if (!cells) ashGone.set(p.m.id, (cells = new Set()));
  cells.add(y * p.m.w + x);
  // Its mips go either way: let go, its pictures are cut again with the ash gone (paint).
  p.mips = undefined;
  if (!p.ground || !art) return;
  const g = p.ground.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(art.blockArt(p.m.group, p.m.num, grassUnderAsh(art.blockAt(p.m.group, p.m.num, x, y))), x * TILE, y * TILE);
}

// ---- how smooth it looked (jank.ts) -------------------------------------------------------
let jank = new JankMeter();
let jankSent = false;
let jankAt = 0;
let romSeven = '?';

/** The match's line to the relay's log: as it ends, as I leave it, as the page goes. */
function sendJank(): void {
  if (jankSent || !matchOn || !link?.jank) return;
  jankSent = true;
  link.jank(jank.counts(), romSeven);
}
addEventListener('pagehide', sendJank);

/** A frame drawn: who is where in the Room (not my predicted trainer, a new copy each frame), its
 *  clock, and what the link has noticed. */
function jankFrame(): void {
  const h = link.health?.();
  jank.look(link.room.actors.flatMap((a) => {
    const p = placed.get(a.m.spot.map);
    return p ? [{ id: a.id, x: p.gx + a.m.spot.x, y: p.gy + a.m.spot.y, warp: a.m.action?.kind === 'warp', m: a.m }] : [];
  }), follow, h?.resyncs ?? 0);
  const now = performance.now();
  jank.clock(link.room.tick, now, document.hidden);
  if (h) jank.checked(h.checks, h.drifts);
  if (follow && follow !== link.me && !document.hidden) jank.watching(Math.min(now - jankAt, 1000));
  jankAt = now;
}

/** Everybody's new steps, and the ash whose time has come. */
function stepFrame(all: Actor[]): void {
  if (!art) return;
  const round = link.room.results.round;
  if (round !== ashRound) {
    ashRound = round;
    for (const id of ashGone.keys()) { const p = placed.get(id); if (p) p.ground = p.cover = p.mips = undefined; }
    ashGone.clear();
    effects = [];
    stepSeen.clear();
  }
  for (const a of all) {
    const was = stepSeen.get(a.id);
    const spot = a.m.spot;
    if (was && (was.spot.map !== spot.map || was.spot.x !== spot.x || was.spot.y !== spot.y)) {
      const from = placed.get(was.spot.map), to = placed.get(spot.map);
      const fromX = from ? (from.gx + was.spot.x) * TILE : 0, fromY = from ? (from.gy + was.spot.y) * TILE : 0;
      const toX = to ? (to.gx + spot.x) * TILE : 0, toY = to ? (to.gy + spot.y) * TILE : 0;
      // A step or a hop, not a warp or a resync's jump.
      if (from && to && a.m.action?.kind !== 'warp' && Math.abs(toX - fromX) + Math.abs(toY - fromY) <= 2 * TILE) {
        effects.push(...stepEffects({
          from: art.behavior(from.m.group, from.m.num, was.spot.x, was.spot.y),
          to: art.behavior(to.m.group, to.m.num, spot.x, spot.y),
          fromX, fromY, toX, toY,
          dir: a.m.moveDir,
          cameFrom: was.dir,
          bike: a.m.bike,
          hop: a.m.action?.kind === 'hop',
          ashGone: !!ashGone.get(to.m.id)?.has(spot.y * to.m.w + spot.x),
        }, frame));
      }
    }
    stepSeen.set(a.id, { spot, dir: a.m.moveDir });
  }
  effects = effects.filter((e) => {
    if (e.kind === 'ash' && frame >= e.start && !e.look) {
      // The tile changes as the puff appears (UpdateAshFieldEffect_Show). `look` marks it done.
      e.look = { frame: 0, hFlip: false, vFlip: false };
      const p = mapUnder(e.x, e.y);
      if (p) clearAsh(p, Math.floor(e.x / TILE) - p.gx, Math.floor(e.y / TILE) - p.gy);
    }
    return fxFrame(e, frame) !== 'done';
  });
}

/** The effects that `pick` says, in view. */
function drawEffects(pick: (e: Effect) => boolean, x0: number, y0: number, x1: number, y1: number): void {
  for (const e of effects) {
    if (e.x > x1 || e.y > y1 || e.x + TILE < x0 || e.y + TILE < y0 || !pick(e)) continue;
    const f = fxFrame(e, frame);
    if (typeof f !== 'number') continue;
    const sheet = fxSheet(e.kind);
    if (!sheet) continue;
    const h = FX_SHEETS[e.kind].h;
    // A 16 x 8 sprite sits at the feet (FldEff_Splash's y2, FldEff_Dust's 12).
    const y = e.y + TILE - h;
    const hFlip = !!(isFloor(e.kind) && e.look?.hFlip), vFlip = !!(isFloor(e.kind) && e.look?.vFlip);
    if (hFlip || vFlip) {
      ctx.save();
      ctx.translate(e.x + (hFlip ? TILE : 0), y + (vFlip ? h : 0));
      ctx.scale(hFlip ? -1 : 1, vFlip ? -1 : 1);
      ctx.drawImage(sheet, f * TILE, 0, TILE, h, 0, 0, TILE, h);
      ctx.restore();
    } else ctx.drawImage(sheet, f * TILE, 0, TILE, h, e.x, y, TILE, h);
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
const OBJ_EVENT_GFX_MR_BRINEYS_BOAT = 88;
/** OBJ_EVENT_GFX_BEAUTY at both harbours, OBJ_EVENT_GFX_SAILOR on each island's dock,
 *  MR. BRINEY (OBJ_EVENT_GFX_EXPERT_M) at each stop. */
const FERRY_PEOPLE: [string, number, number, number][] = [
  [ATTENDANT.map, ATTENDANT.x, ATTENDANT.y, 45],
  ...BOATS.map((b): [string, number, number, number] => [b.map, b.x, b.y, b.gfx]),
  ...[...new Map(Object.values(DOCKS).map((d) => [d.map, d])).values()].map((d): [string, number, number, number] => [d.map, d.sailor[0], d.sailor[1], 49]),
  [TIDAL_SAILOR.map, TIDAL_SAILOR.x, TIDAL_SAILOR.y, 49],
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
  // MR. BRINEY's boat at each stop, on the water (OBJ_EVENT_GFX_MR_BRINEYS_BOAT).
  for (const m of MOORINGS) {
    const p = placed.get(m.map);
    if (!p || !visible.includes(p)) continue;
    let img = clerkArt.get(OBJ_EVENT_GFX_MR_BRINEYS_BOAT);
    if (!img) clerkArt.set(OBJ_EVENT_GFX_MR_BRINEYS_BOAT, (img = art.sprite(OBJ_EVENT_GFX_MR_BRINEYS_BOAT, 1)));
    ctx.drawImage(img, (p.gx + m.x) * TILE + (TILE - img.width) / 2, (p.gy + m.y) * TILE + TILE - img.height);
  }
  // People at home and floor traders (br_balls.c), facing down: a gift-giver's people.
  for (const h of link.room.homes) {
    const p = placed.get(h.map);
    const img = p && visible.includes(p) ? giftArt(h.n) : null;
    if (p && img) ctx.drawImage(img, (p.gx + h.x) * TILE + (TILE - img.width) / 2, (p.gy + h.y) * TILE + TILE - img.height);
  }
  for (const p of visible) {
    // The gym leaders, beaten or not, facing down.
    for (const l of LEADERS) {
      if (l.map !== p.m.id) continue;
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
  // A gift-giver stands there still when it is gone (Room.spentAt).
  for (const g of link.room.ground().values()) if (g.gift || !link.room.picked.has(g.key)) put(g.gift ? giftArt(g.key) : tinted(g.item), g.map, g.x, g.y);
  for (const b of link.room.spills.values()) {
    if (!spillShows(b, link.room.picked.get(b.key), link.me, b.key === bagOpen)) continue;
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
  const { bx, by } = drawBubble(x, y, t);
  ctx.fillRect(bx + 4, by + 3, 2, 5);
  ctx.fillRect(bx + 4, by + 9, 2, 2);
}

/** The bubble the "!" and "VS" sit in, popping up over its first 6 frames; leaves the ink
 *  colour set for the glyph. */
function drawBubble(x: number, y: number, t: number): { bx: number; by: number } {
  const bx = Math.round(x + 3), by = Math.round(y - 24 - (t < 6 ? 6 - t : 0));
  ctx.fillStyle = '#303030';
  ctx.fillRect(bx + 1, by, 8, 14);
  ctx.fillRect(bx, by + 1, 10, 12);
  ctx.fillStyle = '#f8f8f8';
  ctx.fillRect(bx + 1, by + 1, 8, 12);
  ctx.fillStyle = '#303030';
  return { bx, by };
}

/** "VS" as Emerald's BR icon draws it (graphics/field_effects/pics/emotion_vs.png, its
 *  middle eight columns): # is ink. */
const VS_GLYPH = ['#..#..##', '#..#.#..', '#..#.#..', '#..#..#.', '.##....#', '.##..##.'];

/** Over a trainer in a battle, for as long as it lasts, as /classic/ holds its VS mark
 *  (br_ghosts.c SeatMark, POK-372): somebody walking up can see they cannot take them on. */
function drawVs(x: number, y: number): void {
  const { bx, by } = drawBubble(x, y, 6);
  VS_GLYPH.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(bx + 1 + c, by + 4 + r, 1, 1);
  });
}

// ---- the poison look, the doll, the bird (looks.ts) ---------------------------------------

/** A sheet all of one colour, its shape kept: what a sprite is blended toward. */
const purples = new Map<number, HTMLCanvasElement>();
function purpleSheet(gfx: number, s: HTMLCanvasElement): HTMLCanvasElement {
  let p = purples.get(gfx);
  if (!p) {
    p = document.createElement('canvas');
    p.width = s.width;
    p.height = s.height;
    const c = p.getContext('2d')!;
    c.drawImage(s, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = POISON_COLOUR;
    c.fillRect(0, 0, s.width, s.height);
    purples.set(gfx, p);
  }
  return p;
}

let dollArt: HTMLCanvasElement | null = null;
/** The doll in a bubble over a trainer's head, where the "!" and "VS" sit. */
function drawDoll(x: number, y: number): void {
  dollArt ??= itemCut(ITEM_POKE_DOLL);
  if (!dollArt) return;
  const w = dollArt.width, h = dollArt.height;
  const bx = Math.round(x + 8 - w / 2 - 2), by = Math.round(y - 16 - h - 7);
  ctx.fillStyle = '#303030';
  ctx.fillRect(bx + 1, by - 1, w + 2, h + 6);
  ctx.fillRect(bx - 1, by + 1, w + 6, h + 2);
  ctx.fillRect(bx + w / 2 + 1, by + h + 5, 2, 2);
  ctx.fillStyle = '#f8f8f8';
  ctx.fillRect(bx, by, w + 4, h + 4);
  ctx.drawImage(dollArt, bx + 2, by + 2);
}

/** A flight in the air: who, the world pixels of the two cells, and the frame it began. */
interface Flight { id: number; skin: number; from: { x: number; y: number }; to: { x: number; y: number }; start: number; round: number }
let flights: Flight[] = [];
const birds = new Map<number, HTMLCanvasElement>();

/** Anybody who has just jumped to a town's spot flew there, on whichever page sees it. The room
 *  has them there at once: here they go on being seen where they were, till the bird has them. */
function flightFrame(all: Actor[]): void {
  const round = link.room.results.round;
  flights = flights.filter((f) => f.round === round && frame - f.start < FLIGHT_LEN);
  for (const a of all) {
    const was = stepSeen.get(a.id);
    if (!was || !flew(was.spot, a.m.spot, !!a.m.action, FLY_SPOTS)) continue;
    const from = global(was.spot), to = global(a.m.spot);
    if (!from || !to) continue;
    const f: Flight = { id: a.id, skin: a.skin, from: { x: from.gx * TILE, y: from.gy * TILE }, to: { x: to.gx * TILE, y: to.gy * TILE }, start: frame, round };
    flights.push(f);
    stepSeen.set(a.id, { spot: a.m.spot, dir: a.m.moveDir });
    if (a.id === link.me || a.id === follow || Math.hypot(f.from.x - cam.x, f.from.y - cam.y) < 240 || Math.hypot(f.to.x - cam.x, f.to.y - cam.y) < 240) rom?.sound(SE_M_FLY);
  }
}

function drawFlights(): void {
  for (const f of flights) {
    const pose = flightPose(frame - f.start);
    const at = pose.at === 'from' ? f.from : f.to;
    // The middle of the trainer's sprite, standing there: 32 tall, its feet on the cell.
    const mx = at.x + TILE / 2, my = at.y;
    const look = f.skin === 1 ? 1 : 0;
    if (pose.bird && art) {
      let bird = birds.get(look);
      if (!bird) birds.set(look, (bird = art.flyBird(SKIN_GFX[look])));
      ctx.drawImage(bird, Math.round(mx + pose.bird.x - 16), Math.round(my + pose.bird.y - 16));
    }
    if (pose.gone) continue;
    // Getting on and off is the surfing sheet's frame 11, Brendan's and May's; a look with no such
    // sheet goes in its own, facing the way the bird flies.
    const surf = f.skin < 2 && pose.mounted ? (f.skin === 1 ? OBJ_EVENT_GFX_MAY_SURFING : OBJ_EVENT_GFX_BRENDAN_SURFING) : 0;
    const gfx = surf && SHEETS[String(surf)].frames > 11 ? surf : SKIN_GFX[f.skin] ?? SKIN_GFX[0];
    const s = sheet(gfx);
    if (!s) continue;
    const info = SHEETS[String(gfx)];
    const fr = gfx === surf ? 11 : FACE[3];
    ctx.drawImage(s, fr * info.w, 0, info.w, info.h, Math.round(mx + pose.rider.x - info.w / 2), Math.round(at.y + TILE - info.h + pose.rider.y), info.w, info.h);
  }
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

// ---- past the edge of a map (POK-431, worldfill.ts) ------------------------------------

let worldFill: WorldFill | null = null;
const fillCuts = new ChunkCache<{ cv: HTMLCanvasElement; anims: { sheet: HTMLCanvasElement; states: Uint8Array; cells: number[] }[] }>();
/** A pattern per look of the sea, and a pattern per block of one forest or ridge: laid in the
 *  world's coordinates, so they stay on the grid however the camera moves. */
let seaLooks: { patterns: CanvasPattern[]; states: Uint8Array; tint: string } | null = null;
const blockPatterns = new Map<number, { pattern: CanvasPattern; tint: string }>();
/** Milliseconds of a frame to spend cutting chunks: at least one, so a slow phone still gets there. */
const FILL_CUT_MS = 4;

/** The map that draws a fill cell: its own if the block names one, else any on General. */
function fillArtOf(ref: string | null): { group: number; num: number } {
  const p = placed.get(ref ?? 'MAP_LITTLEROOT_TOWN')!;
  return { group: p.m.group, num: p.m.num };
}

function seaOf(): typeof seaLooks {
  if (seaLooks || !art) return seaLooks;
  const home = fillArtOf(null);
  const looks = art.metatileLooks(home.group, home.num, SEA_METATILE);
  if (!looks) return null;
  const patterns: CanvasPattern[] = [];
  for (let n = 0; n * TILE < looks.sheet.width; n++) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    c.getContext('2d')!.drawImage(looks.sheet, n * TILE, 0, TILE, TILE, 0, 0, TILE, TILE);
    patterns.push(ctx.createPattern(c, 'repeat')!);
  }
  // Far out the maps are mips of their still ground (mipFor), so the sea's colour is that one's.
  const still = art.cells(1, 1, () => ({ ...home, id: SEA_METATILE }));
  seaLooks = { patterns, states: looks.states, tint: tint(still) };
  return seaLooks;
}

/** A chunk of cells, cut from the ROM; `null` while there is no art. */
function cutChunk(f: WorldFill, cx: number, cy: number): { cv: HTMLCanvasElement; anims: { sheet: HTMLCanvasElement; states: Uint8Array; cells: number[] }[] } | null {
  if (!art) return null;
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  const cv = art.cells(CHUNK, CHUNK, (x, y) => {
    const m = f.metatile(x0 + x, y0 + y);
    return m ? { ...fillArtOf(m.ref), id: m.id } : null;
  });
  // What moves in it: the water in a coast's pieces, in step with the sea beside it.
  const moving = new Map<number, { sheet: HTMLCanvasElement; states: Uint8Array; cells: number[] }>();
  for (let y = 0; y < CHUNK; y++) {
    for (let x = 0; x < CHUNK; x++) {
      const m = f.metatile(x0 + x, y0 + y);
      if (!m || m.ref) continue;
      let a = moving.get(m.id);
      if (a === undefined) {
        const home = fillArtOf(null);
        const looks = art.metatileLooks(home.group, home.num, m.id);
        a = looks ? { ...looks, cells: [] } : { sheet: cv, states: new Uint8Array(0), cells: [] };
        moving.set(m.id, a);
      }
      if (a.states.length) a.cells.push(y * CHUNK + x);
    }
  }
  return { cv, anims: [...moving.values()].filter((a) => a.states.length) };
}

/** The holes in Hoenn and the sea past it, under the maps, in the world's coordinates. False if
 *  this isn't the plane worldfill.ts covers (a building, the Zone), or the file isn't here yet. */
function drawFill(vx0: number, vy0: number, vx1: number, vy1: number, far: boolean, step: number): boolean {
  const f = worldFill;
  const sea = f ? seaOf() : null;
  if (!f || !sea || !art) return false;
  ctx.fillStyle = far ? sea.tint : sea.patterns[sea.states[step]];
  ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
  const size = CHUNK * TILE;
  const { cx0, cy0, cx1, cy1 } = chunksOver(vx0, vy0, vx1, vy1);
  const t0 = performance.now();
  let cut = 0;
  const keyOf = (cx: number, cy: number) => (cy + 4096) * 8192 + cx + 4096;
  const cutOne = (cx: number, cy: number) => {
    if (cut > 0 && performance.now() - t0 > FILL_CUT_MS) return undefined;
    cut += 1;
    const c = cutChunk(f, cx, cy) ?? undefined;
    if (c) fillCuts.set(keyOf(cx, cy), c);
    return c;
  };
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = f.chunk(cx, cy);
      if (c.kind === 'sea') continue;
      const x = cx * size, y = cy * size;
      if (c.kind === 'block') {
        let b = blockPatterns.get(c.block);
        if (!b) {
          const fb = f.blocks[c.block]!;
          const pic = art.cells(2, 2, (ux, uy) => ({ ...fillArtOf(fb.ref), id: fb.ids[(uy << 1) | ux] }));
          b = { pattern: ctx.createPattern(pic, 'repeat')!, tint: tint(pic) };
          blockPatterns.set(c.block, b);
        }
        ctx.fillStyle = far ? b.tint : b.pattern;
        ctx.fillRect(x, y, size, size);
        continue;
      }
      const got = fillCuts.get(keyOf(cx, cy)) ?? cutOne(cx, cy);
      if (!got) continue;
      if (far) ctx.imageSmoothingEnabled = true;
      ctx.drawImage(got.cv, x, y, size, size);
      if (far) { ctx.imageSmoothingEnabled = false; continue; }
      for (const a of got.anims) {
        const sx = a.states[step] * TILE;
        for (const i of a.cells) ctx.drawImage(a.sheet, sx, 0, TILE, TILE, x + (i % CHUNK) * TILE, y + Math.floor(i / CHUNK) * TILE, TILE, TILE);
      }
    }
  }
  // The next ones a walk comes to, so the edge of the view is never waiting on them.
  if (performance.now() - t0 < FILL_CUT_MS) {
    const out = chunksOver(vx0, vy0, vx1, vy1, 1);
    for (let cy = out.cy0; cy <= out.cy1; cy++) {
      for (let cx = out.cx0; cx <= out.cx1; cx++) {
        if ((cy >= cy0 && cy <= cy1 && cx >= cx0 && cx <= cx1) || f.chunk(cx, cy).kind !== 'cells' || fillCuts.get(keyOf(cx, cy))) continue;
        if (performance.now() - t0 >= FILL_CUT_MS) return true;
        const c = cutChunk(f, cx, cy);
        if (c) fillCuts.set(keyOf(cx, cy), c);
      }
    }
  }
  return true;
}

/** #battle.see's #0007: a battle's dim over the field, and a room's. */
const ROOM_DIM = 0x77 / 255;
/** What a scene is for: the world under a room, the room itself (only it, clipped to it, faded
 *  in by `alpha` as its door opens), or neither, the field as it is. */
interface Scene { under?: boolean; room?: Placed; alpha?: number }

/** The world's camera under a room: as far from the door as the trainer is from the cell the
 *  door lands on, so the room stands over the building and nothing jumps at the door. */
function underRoom(r: Placed, x: number, y: number): { x: number; y: number } {
  return { x: (r.door!.x - r.entry!.x - r.gx) * TILE + x, y: (r.door!.y - r.entry!.y - r.gy) * TILE + y };
}

/** A trainer just through a door: the room stands over that door, of the several it may have. */
function noteDoor(a: Actor, dir: number): void {
  const r = placed.get(a.m.spot.map), from = placed.get(a.m.prev.map);
  if (!r?.door || !from || (!MAINLAND.has(from.m.id) && !from.door)) return;
  const x = a.m.prev.x + (dir === 3 ? -1 : dir === 4 ? 1 : 0), y = a.m.prev.y + (dir === 1 ? 1 : dir === 2 ? -1 : 0);
  r.door = from.door ? { x: from.door.x + x - from.entry!.x, y: from.door.y + y - from.entry!.y } : { x: from.gx + x, y: from.gy + y };
  r.entry = { x: a.m.spot.x, y: a.m.spot.y };
}

function draw(): void {
  const all = actors();
  seamFrame(all);
  const followed = follow ? all.find((a) => a.id === follow) : undefined;
  flightFrame(all);
  // Whoever the camera goes with is seen off where they were; it follows them through the fade.
  const flight = followed && flights.find((f) => f.id === followed.id);
  if (flight && frame - flight.start < ARRIVES) {
    cam.x = flight.from.x + 8;
    cam.y = flight.from.y + 8;
  } else if (followed) {
    const p = pixelOf(followed);
    cam.x = p.x + 8;
    cam.y = p.y + 8;
  }
  // Under one GBA pixel per CSS pixel (a spectator zoomed out), CSS pixels are plenty.
  const dpr = devicePixelRatio || 1;
  // (A spectator's zoom between two whole ones draws at its own pixel, not at the device's.)
  const k = zoom < dpr ? dpr : Math.max(1, zoom);
  const W = Math.ceil(devW / k), H = Math.ceil(devH / k);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const z = zoom / k;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d1a14';
  ctx.fillRect(0, 0, W, H);
  const home = mapUnder(cam.x, cam.y) ?? placed.get('MAP_LITTLEROOT_TOWN')!;
  // Whole-pixel camera at zoom >= 1, so tiles never shimmer.
  const ox = Math.round(W / 2 - cam.x * z);
  const oy = Math.round(H / 2 - cam.y * z);
  const going = followed?.m.action?.kind === 'warp' ? followed.m.action : null;
  const open = going ? going.t / going.len : 1;
  if (going && going.t < 2 && followed) noteDoor(followed, going.dir);
  const left = going && followed ? placed.get(followed.m.prev.map) : undefined;
  if (home.door) {
    // A room is a window over the world it is in, the world going on dimmed behind it (Cam,
    // 11-02: "the room is shown like in the same instance but maybe just a layer on top ...
    // and so the background is dimmed"), instead of a box on black.
    const out = underRoom(home, cam.x, cam.y);
    drawScene(all, out.x, out.y, W, H, z, { under: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Coming in from outside, the dim comes up as the door opens; between two rooms it stays.
    ctx.fillStyle = `rgba(0, 0, 0, ${ROOM_DIM * (going && !left?.door ? open : 1)})`;
    ctx.fillRect(0, 0, W, H);
    drawScene(all, cam.x, cam.y, W, H, z, { room: home, alpha: open });
  } else {
    drawScene(all, cam.x, cam.y, W, H, z, {});
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (going && left?.door && home.m.outdoor) {
      // Back out through the door: the room lets go, and the world comes back up. The room stands
      // where the camera has just come from.
      ctx.fillStyle = `rgba(0, 0, 0, ${ROOM_DIM * (1 - open)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.setTransform(z, 0, 0, z, ox, oy);
      ctx.globalAlpha = 1 - open;
      const rx = (left.door.x - left.entry!.x) * TILE, ry = (left.door.y - left.entry!.y) * TILE;
      if (left.ground) ctx.drawImage(left.ground, rx, ry);
      if (left.cover) ctx.drawImage(left.cover, rx, ry);
      ctx.globalAlpha = 1;
    } else if (going) {
      // A door to nowhere on Hoenn (the Zone's, an island's): the screen fades out and back in.
      ctx.fillStyle = `rgba(0, 0, 0, ${1 - Math.abs(open * 2 - 1)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  if (flight) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(0, 0, 0, ${flightFade(frame - flight.start)})`;
    ctx.fillRect(0, 0, W, H);
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

/** The field as a camera at (camX, camY) sees it. */
function drawScene(all: Actor[], camX: number, camY: number, W: number, H: number, z: number, scene: Scene): void {
  const room = scene.room;
  const home = room ?? mapUnder(camX, camY) ?? placed.get('MAP_LITTLEROOT_TOWN')!;
  const ox = Math.round(W / 2 - camX * z);
  const oy = Math.round(H / 2 - camY * z);
  const far = z < 0.5;
  const vx0 = -ox / z, vy0 = -oy / z, vx1 = vx0 + W / z, vy1 = vy0 + H / z;
  // Hoenn goes on past its maps (drawFill). Everywhere else, past every map's edge the GBA
  // repeats the map's 2x2 border block (Route 101's trees): tile the block of the map under
  // the camera, aligned to its even coordinates.
  if (!room) {
    ctx.setTransform(z, 0, 0, z, ox, oy);
    const filled = MAINLAND.has(home.m.id) && drawFill(vx0, vy0, vx1, vy1, far, frame % ANIM_COUNTER_MAX);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (filled) { /* the world is drawn */ } else if (paint(home) && home.border && far) {
      // Far out the 32 px block is noise: one flat colour, its average.
      home.borderTint ??= tint(home.border);
      ctx.fillStyle = home.borderTint;
      ctx.fillRect(0, 0, W, H);
    } else if (home.border) {
      const pat = ctx.createPattern(home.border, 'repeat')!;
      const bx = home.gx * TILE, by = home.gy * TILE;
      pat.setTransform(new DOMMatrix([z, 0, 0, z, ox + bx * z, oy + by * z]));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.setTransform(z, 0, 0, z, ox, oy);
  // A room shows itself and what is in it: a spectator's wide view stops at its walls, the other
  // rooms in their rows stay out of it. (A head may stand a cell over its top row.)
  if (room) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(room.gx * TILE, (room.gy - 1) * TILE, room.m.w * TILE, (room.m.h + 1) * TILE);
    ctx.clip();
  }
  const alpha = room ? scene.alpha ?? 1 : 1;
  // Far out, each map is drawn from a quarter-size copy averaged once (mip), because
  // nearest-neighbour shrinking turns trees into static and smoothing every frame is slow.
  const visible: Placed[] = [];
  let painted = 0;
  for (const p of room ? [room] : placed.values()) {
    const x = p.gx * TILE, y = p.gy * TILE;
    if (x > vx1 || y > vy1 || x + p.m.w * TILE < vx0 || y + p.m.h * TILE < vy0) continue;
    visible.push(p);
    // Far out, a map with its mips is drawn from them, its full-size pictures let go or not.
    if ((far && p.mips) || ((p.ground || p === room || painted++ < 2) && paint(p))) {
      ctx.globalAlpha = alpha;
      if (far) ctx.drawImage(mipFor(p, z), x, y, p.m.w * TILE, p.m.h * TILE);
      else { p.usedAt = frame; ctx.drawImage(p.ground!, x, y); if (alpha === 1) drawAnims(ctx, p, vx0, vy0, vx1, vy1); }
      ctx.globalAlpha = 1;
    }
  }
  const block = far || scene.under ? 0 : poisonBlock(z);
  if (block) pixelate(canvas, block);
  if (!far) for (const p of visible) drawPatches(p);
  if (!far) drawGround(vx0, vy0, vx1, vy1);
  if (!far) drawProps(visible, all);
  if (!scene.under) {
    stepFrame(all);
    jankFrame();
    tagFrame();
  }
  if (!far) drawEffects((e) => isFloor(e.kind), vx0, vy0, vx1, vy1);
  const people = all
    .map((a) => ({ a, p: pixelOf(a) }))
    .filter(({ a, p }) => (!room || a.m.spot.map === room.m.id) && p.x > vx0 - 32 && p.x < vx1 + 32 && p.y > vy0 - 48 && p.y < vy1 + 32)
    .sort((u, v) => u.p.y - v.p.y);
  // Each, while they stand in the fog: the shake now, and the blend once the fog's over everything.
  const ring = link.room.ring();
  const blends: (() => void)[] = [];
  const drawPerson = ({ a, p }: (typeof people)[number]): void => {
    // In the air: drawFlights has them.
    if (flights.some((f) => f.id === a.id)) return;
    // Under the sea: Brendan's and May's diving sheet, bobbing, with no blob (br_ghosts.c).
    const under = !!placed.get(a.m.spot.map)?.m.emerge;
    // On the water: sitting on the blob, bobbing (SURF's pose, FLDEFF_SURF_BLOB's bob).
    const surf = !under && classAt(a.m.spot) === CLASS_WATER;
    const surfGfx = a.skin === 1 ? OBJ_EVENT_GFX_MAY_SURFING : OBJ_EVENT_GFX_BRENDAN_SURFING;
    // My rod out (fish.ts), on foot or on the blob: Brendan's and May's fishing sheet,
    // nudged toward the water as AlignFishingAnimationFrames does.
    const rod = casting && a.id === link.me && a.skin < 2 ? fishPose(casting.f.anim, casting.f.animT, a.m.facing) : null;
    // On a bike: Brendan's and May's own; any other look rides on foot (br_skin.c).
    const gfx = rod ? FISH_GFX[a.skin] : under && a.skin < 2 ? DIVE_GFX[a.skin] : surf ? surfGfx : a.m.bike && a.skin < 2 ? (a.m.acro ? ACRO_GFX : BIKE_GFX)[a.skin] : SKIN_GFX[a.skin];
    const info = SHEETS[String(gfx)];
    const s = sheet(gfx);
    if (!s) return;
    const fr = rod ? rod.frame : surf ? FACE[a.m.facing] : frameOf(a);
    const bob = surf || under ? ((frame >> 4) & 1) - 2 : 0;
    const poison = link.room.inFog(a.m.spot, ring) ? poisonLook(poisonBeat(link.room.tick, a.id)) : null;
    const dx = p.x + TILE / 2 - info.w / 2 + (rod?.dx ?? 0) + (poison?.dx ?? 0);
    const dy = p.y + TILE - info.h - p.lift + bob + (rod?.dy ?? 0);
    if (surf) drawBlob(surfGfx, a.m.facing, p.x + TILE / 2 - 16, p.y + TILE - 32 - p.lift + bob + 4);
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
    if (poison?.blend) {
      const purple = purpleSheet(gfx, s), flip = a.m.facing === DIR_EAST;
      // Not the feet tall grass has covered.
      const h = !a.m.action && classAt(a.m.spot) === 7 ? info.h - 8 : info.h;
      blends.push(() => {
        ctx.save();
        ctx.globalAlpha = poison.blend / 16;
        if (flip) { ctx.translate(dx + info.w, dy); ctx.scale(-1, 1); } else ctx.translate(dx, dy);
        ctx.drawImage(purple, fr * info.w, 0, info.w, h, 0, 0, info.w, h);
        ctx.restore();
      });
    }
    if (spectating && a.id === follow) {
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 1 / Math.min(1, z);
      ctx.strokeRect(dx - 1, dy - 1, info.w + 2, info.h + 2);
    }
  };
  const onTop = people.filter(({ a }) => heights?.over(a.id, a.m.spot));
  // Rustling grass and puffs of ash stand among the people, by who is below whom.
  let fxDone = -Infinity;
  const fxUpTo = (y: number): void => {
    if (far) return;
    const from = fxDone;
    drawEffects((e) => !isFloor(e.kind) && e.y > from && e.y <= y, vx0, vy0, vx1, vy1);
    fxDone = y;
  };
  for (const q of people) {
    if (onTop.includes(q)) continue;
    fxUpTo(q.p.y - 1);
    drawPerson(q);
  }
  fxUpTo(Infinity);
  if (block) {
    if (coverCanvas.width !== W || coverCanvas.height !== H) { coverCanvas.width = W; coverCanvas.height = H; }
    const c = coverCanvas.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.imageSmoothingEnabled = false;
    c.setTransform(z, 0, 0, z, ox, oy);
    for (const p of visible) if (p.cover) c.drawImage(p.cover, p.gx * TILE, p.gy * TILE);
    pixelate(coverCanvas, block);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(coverCanvas, 0, 0);
    ctx.restore();
  } else for (const p of visible) {
    if (p.cover && !far) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(p.cover, p.gx * TILE, p.gy * TILE);
      ctx.globalAlpha = 1;
    }
  }
  onTop.forEach(drawPerson);
  drawNurses(visible);
  drawClerks(visible);
  for (const { a, p } of people) if (a.meet?.walk && link.room.tick - a.meet.since < WALKUP_BANG) drawBang(p.x, p.y - p.lift, link.room.tick - a.meet.since);
  // Not over me, nor over whoever I watch, who I can see is fighting (br_ghosts.c SeatMark).
  for (const { a, p } of people) if (a.battling && a.id !== link.me && a.id !== follow) drawVs(p.x, p.y - p.lift);
  if (room) {
    // The fog inside is the fog at the door: on the room, not on the cell of heads over it.
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(room.gx * TILE, room.gy * TILE, room.m.w * TILE, room.m.h * TILE);
    ctx.clip();
    drawFog(vx0, vy0, vx1, vy1, home);
    ctx.restore();
  } else drawFog(vx0, vy0, vx1, vy1, home);
  for (const b of blends) b();
  for (const { a, p } of people) if (dollShows(a, link.room.tick, frame)) drawDoll(p.x, p.y - p.lift);
  drawFlights();
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

/** The loading screen (loading.ts), up from the first paint until there is something to do:
 *  the menu, or a match whose battle ROM is booted and whose team is back. */
/** Dev: `?loading` keeps it up, to look at. */
const stayLoading = import.meta.env.DEV && new URLSearchParams(location.search).has('loading');
const loading = new LoadingScreen(() => {
  if (stayLoading) return false;
  if (matchOn) return !!rom && !comingBack;
  return !!lobby?.shown;
});

function loop(now: number): void {
  const dt = now - last;
  last = now;
  gaps.push(dt);
  if (gaps.length > 120) gaps.shift();
  if (dt > SPIKE_MS && !document.hidden) recorder.spike(dt);
  acc += Math.min(dt, 100);
  const t0 = performance.now();
  let steps = 0;
  while (acc >= 1000 / 60 && steps < 4) {
    acc -= 1000 / 60;
    steps += 1;
    frame += 1;
    link.hurry = !!battle || swapping || romUp;
    for (const e of link.frame(myBits())) startFor(e);
    keysEl.hidden = intro() || !!lobby?.shown;
    for (const l of legendFrames) l();
    roundFrame();
    fieldFrame();
    teamFrame();
    seeFrame();
    soundFrame();
    stepsFrame();
    doorsFrame();
    if (frame % 60 === 0) unpaintFar();
    fogFrame();
    foeFrame();
    remember();
    gymFrame();
    hudFrame();
    fishFrame();
    if (pressed.has('a') && watchOffer) takeWatchOffer();
    else if (pressed.has('a')) dig();
    // Not while a box is up (the peek's): left and right are its keys then.
    if (!asking) for (const k of pressed) watch.key(k);
    pressed.clear();
  }
  const t1 = performance.now();
  draw();
  watch.frame();
  if (sayUntil && performance.now() > sayUntil) { sayUntil = tickUntil = 0; msgBox.hide(); }
  msgBox.place();
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

/** The game stopping under the player, said over everything with the way out, as
 *  /classic/ says it (app.ts wireWatchdog): the page's own ROM's frames stopping, its
 *  heartbeat stopping, or the core crashing (emu/watchdog.ts). The ROM here is paused
 *  between its screens on purpose, which the watchdog never counts; a stop is one while
 *  a battle or a screen is up, and a game that comes back takes it back. */
function wireWatchdog(files: Awaited<ReturnType<typeof loadRom>>): void {
  const box = document.getElementById('stall')!;
  document.getElementById('stall-reload')!.addEventListener('click', () => location.reload());
  // LEAVE: out of the match on the relay (the standings say "left"), then a fresh page,
  // since the ROM that stopped is still this tab's.
  document.getElementById('stall-leave')!.addEventListener('click', () => {
    if (matchOn) leaveMatch();
    setTimeout(() => location.reload(), 300);
  });
  watchRom({
    emu: files.emu,
    symbols: files.table,
    onStall: (report) => {
      const line = stallLine(report, versionLine);
      document.getElementById('stall-line')!.textContent = line;
      box.hidden = false;
      console.error('[watchdog] the game stopped:', line);
    },
    onBack: () => { box.hidden = true; },
  });
}

/** The game never got going (no patch for this ROM, a core that would not start): said
 *  over the page, not only into the debug stats, with RELOAD. */
function didNotStart(why: string): void {
  document.getElementById('stall-head')!.textContent = "THE GAME DIDN'T START";
  document.getElementById('stall-line')!.textContent = `${why} · ${versionLine}`;
  document.getElementById('stall-leave')!.hidden = true;
  document.getElementById('stall-reload')!.addEventListener('click', () => location.reload());
  document.getElementById('stall')!.hidden = false;
}

async function boot(): Promise<void> {
  watchPage();
  registerServiceWorker();
  void askToKeepStorage();
  const hoenn = new WorldIndex(((await import('./data/world.json')).default as { maps: WorldMap[] }).maps);
  heights = new Heights((map, x, y) => hoenn.world.height(map, x, y));
  placed = layout(hoenn.maps);
  // Past the maps' edges (worldfill.ts). Until it is here, or if it never comes, the border as ever.
  void import('./data/world-fill.json').then((d) => { worldFill = new WorldFill(d.default as unknown as FillFile); }).catch((e) => console.warn('[world-fill]', e));
  let files: Awaited<ReturnType<typeof loadRom>>;
  try {
    // The ROM picker is the player's to answer: the loading screen steps aside for it.
    const pick = async (emu: Parameters<typeof importRom>[0]) => {
      if (devRomParam()) return importRom(emu, ''); // a test's file, read without asking
      loading.hold(true);
      try { await importRom(emu, ''); } finally { loading.hold(false); }
    };
    files = await loadRom(gbaCanvas, (t) => { statsEl.textContent = t; loading.say(t); }, pick, devRomParam(), (bytes) => {
      try { loading.ride(introArt(bytes), me().skin % 2 === 1); } catch (e) { console.warn('[loading] no ride', e); }
    });
    loading.say('Drawing Hoenn…');
    romEmu = files.emu;
    versionLine = files.version;
    recorder.setVersion({ line: files.version, romSha1: files.romSha, world: WORLD_HASH_SHORT });
  battlesOn(files.romSha);
  romSeven = files.romSha;
    wireBattleMenu(files);
    if (touchPad) wirePhoneHud();
    else {
      wirePhoneHud(true);
    }
  } catch (e) {
    console.warn('spike ROM not loaded', e);
    loading.hide();
    didNotStart(e instanceof Error ? e.message : String(e));
    return;
  }
  wireWatchdog(files);
  const t0 = performance.now();
  art = new RomArt(files.rom, files.sym);
  // `#battleview`: the page-drawn battle (battleview.ts) on a canned log, no match.
  if (/^#battleview(&|$)/.test(location.hash)) { void import('./battleview-dev').then((m) => m.openDevBattleView(art!, location.hash)); return; }
  romTables ={ bytes: files.rom, sym: (n) => { const a = files.sym(n); return Number.isNaN(a) ? undefined : a; } };
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
  // Only its mips are kept: the full-size pictures of a map nobody is near go again (unpaint).
  const next = () => { const p = rest.find((r) => !r.mips); if (p) { paint(p); mipFor(p, 0); if ((p.usedAt ?? -Infinity) < frame - 60) unpaint(p); setTimeout(next, 16); } };
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
      // The bots' fights in the simulator, as the relay has them; #nosim, on this page's hidden ROM.
      simBots: !new URLSearchParams(location.hash.slice(1)).has('nosim'),
      name: me().name, skin: me().skin,
    });
  };
  if (q.has('solo') || parseRoomHash(location.hash)?.mode === 'solo') {
    // The debug path (Cam, 2026-10-29): straight into a world of the page's own, the bots
    // and nobody else, under the old preview's notes.
    document.body.classList.add('dev-intro');
    startMatch(solo());
  } else {
    // The live game's way in: the menu, a room, START (lobby.ts).
    document.getElementById('intro')?.remove();
    const make = (seed: number) => makeRoom(hoenn.maps, patches, seed, hoenn.world);
    const sock = connectWorld(url, make, {
      onRoom: (r) => {
        room = r;
        reloadedFrom = null;
        // A hosted room's link is the address bar: copy it, send it, and a friend is in.
        if (!r.quick && parseRoomHash(location.hash)?.code !== r.code) history.replaceState(null, '', `#${withRoom(location.hash, 'join', r.code)}`);
        rom?.pace(r.set.textSpeed, r.set.animations);
        if (matchOn && !r.playing) matchOver();
        // The standings stay up until PLAY AGAIN; then the room as it is by then.
        else if (!matchOn && !winEl.classList.contains('on')) lobby!.roomIs(r);
        // Between matches a reload is back in this seat too (the relay holds it a moment),
        // the host still the host: the link alone made it a second trainer (11-12).
        if (!r.playing) rememberRoom(r);
      },
      onNoRoom: (code, pass, rom, full, removed) => {
        forget(); unlink();
        if (pass) { lobby!.askPass(code, knockedWithPass); return; }
        // Back from a reload mid-match to a room that has gone: a reload in a battle is out of the
        // match (the relay holds no battling trainer), and a bot match with nobody else in it ends
        // there (Reddit, 11-12: "when I came back it said something like cant find room").
        const ended = !!code && code === reloadedFrom && !rom && !full && !removed;
        reloadedFrom = null;
        if (ended) { lobby!.menu('The page reloaded, and your match ended without you.'); return; }
        lobby!.menu(removed ? `The host of room ${code} took you out of it.` : rom ? `Room ${code} is on another version of the game. Reload the page to update.` : full ? `Room ${code} is full.` : code ? `There is no room ${code}.` : 'Every place in the world is taken.');
      },
      onKicked: () => { room = null; forget(); unlink(); lobby!.menu('The host took you out of the room.'); },
      onOld: () => { room = null; matchOn = false; forget(); lobby!.old(); },
      onRooms: (rooms) => lobby?.listed(rooms),
      onMatch: (l) => { reloadedFrom = null; startMatch(l); },
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
    sheetBtn.hidden = watchLeave.hidden = false;
    const joinAs = (how: { code?: string; host?: boolean; pass?: string }) => {
      knockedWithPass = !!how.pass;
      const c = loadCareer();
      // MY VOICE goes with the card: whoever fights me hears my lines (MY LOOK's picks).
      sock.join(me().name, me().skin, { ...how, rec: { wins: c.wins, played: c.matches, ...(c.best ? { best: c.best } : {}), intro: c.intro ?? 0, win: c.win ?? 0, lose: c.lose ?? 0 } });
    };
    lobby = new Lobby({
      join: joinAs,
      start: () => sock.start(),
      set: (set) => sock.set(set),
      kick: (id) => sock.kick(id),
      makeHost: (id) => sock.makeHost(id),
      toBot: (id) => sock.toBot(id),
      list: () => sock.list(),
      relayUrl: url.replace(/\/world$/, ''),
      // Cam, 11-11: a note names the real build, not "spike B": the sheet's line without
      // its leading word (patch, shell, rom; "local build" from a dev page).
      version: () => versionLine.replace(/^spike B · /, ''),
      // Out of the room for good: its link goes too, or the reload would walk back in.
      // Said to the relay first: a socket that only closes is held for a reload (11-12).
      leave: () => { forget(); unlink(); sock.leave(); setTimeout(() => location.reload(), 300); },
      names: { species: speciesName, move: (id) => moveInfo(romTables, id)?.name },
      solo: () => { room = null; recordSolo(); startMatch(solo()); },
    });
    // Reloaded within a minute of a match: straight back in (or, too late, in to watch).
    const back = token();
    const linked = parseRoomHash(location.hash);
    reloadedFrom = back && !back.room ? back.code : null;
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
  loading.say(matchToken() ? 'Back to your match…' : 'Getting the game ready…');
  bootRom(files, link?.room.seed ?? 0, () => link?.mine()?.skin ?? 0).then(booted, (e) => { console.warn('spike ROM not booted', e); loading.hide(); });
  (window as unknown as { __spike: unknown }).__spike = { watch, frameOf, get frame() { return frame; }, canvas, get animStep() { return frame % ANIM_COUNTER_MAX; }, get flights() { return flights; }, get link() { return link; }, get mapWindow() { return mapWindow; }, get ringMap() { return ringMap; }, get lobby() { return lobby; }, get room() { return room; }, actors, placed, goOut, get battleMenu() { return battleMenu; }, get effects() { return effects; }, ashGone, get art() { return art; }, get zoom() { return zoom; }, set zoom(v: number) { zoom = v; }, cam, toggleSpectate, startFor, handoff, stuckLimits, runMenu, get rom() { return rom; }, get battle() { return battle; }, get lastStart() { return lastStart; }, get lastResult() { return lastResult; }, get isOut() { return isOut; }, get waiting() { return waiting; }, give: (item: number) => { toGive.push({ key: 0, item, gift: true } as never); giveNext(); }, get swapping() { return swapping; }, get asking() { return !!asking; }, get spectating() { return spectating; }, get version() { return versionLine; }, get jank() { return jank; }, get askingRows() { return asking ? { rows: asking.rows.map((r) => r[1]), pick: asking.pick } : null; }, get movesBox() { return movesBox; }, pocket: (n: number) => (rom ? readPocket(rom.emu, romTables.sym, n) : []), radial, moveName: (id: number) => moveInfo(romTables, id)?.name ?? '' };
}

void boot();
