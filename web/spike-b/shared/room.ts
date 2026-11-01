// Spike B, stage 2: one Hoenn for the whole room.
//
// Everything that moves is here, and nothing else: who stands where, the keys each one
// holds this frame, the marked spots and who took them, who is fighting. It has no
// clock, no network and no drawing. A Room only goes forward by step(), one GBA frame,
// with every trainer's keys for that frame -- so two Rooms that start from the same
// state and are given the same keys frame by frame are the same Room. That is the whole
// design: the relay runs the Room and sends every frame's key changes; each phone runs
// the same Room from those keys and gets the same world, frame for frame (its own
// trainer predicted ahead of it, see net.ts).
//
// Walking is sim.ts, the ROM's rules, for everybody. A trainer is solid to the others.
// Stepping onto a marked spot nobody has taken, or pressing A at a bot, starts a battle:
// the trainer (and the bot) stand still until the phone says the battle is over.
//
// The fog closes in as a match's does (br_ring.c): a ring on a clock, the first phase an
// announcement, each later one smaller, the last everywhere -- then a new round with a new
// centre. It is the room's tick and seed and nothing else, so every phone has the same
// ring without a word on the wire. Outside it the page bleeds the team (main.ts).
//
// Each fog cycle is a match (Cam, 10-29). Whoever is on the map when the fog first closes
// is in it; a trainer who comes in later, or goes out, waits on the bench and watches.
// The last one standing wins. When the fog lifts, everybody starts again at the truck.
//
// Items lie about as item balls (match/scatter.ts's table, a few on every map), dealt
// from the seed on cells a trainer can walk to from Littleroot. A ball is solid, as the
// ROM's are; A at one takes it, for that trainer and off everybody's map.

import { clerkAt, type Clerk } from './marts';
import { leaderAt } from './gyms';
import { EVENT_GOLD, EVENT_MAX, EVENT_RARES, GOLD, LEGENDS, RARES, SUPPLIES, draw, eventForRing } from '../../src/match/events';
import { DOOR_Y, FINAL_CHANCE, STORIES, STORY_CHANCE, type Story, type StoryDoor } from '../../src/match/story';
import { dealParty, rungForPhase } from '../../src/bots/party';
import { gradeOf } from '../../src/bots/roster';
import { add, carried, purse, quaff, spend, type Stack } from '../../src/bots/bag';
import { World, decodeGrid, type Spot, type WorldMap } from '../../src/bots/world';
import { dealPatches, type Patch, type PatchTable } from '../../src/bots/patches';
import { blueTm, scatterItem } from '../../src/match/scatter';
import roomsJson from '../data/rooms.json';
import { GIFTS } from '../../src/match/gifts';
import { cableOrDoll, isTm, type BagRows } from './items';
import { SIGHT_RANGE, eitherSees, type Facing } from '../../src/bots/sight';
import { SAFARI_CELLS } from '../../src/match/safari';
import { RING_RADII } from '../../src/match/clock';
import { CLASS_WATER, DIR_NORTH, dirOf, newMover, stepFn, tick, type Keys, type Mover, type StepFn } from '../sim';

export const KEY_UP = 1, KEY_DOWN = 2, KEY_LEFT = 4, KEY_RIGHT = 8, KEY_B = 16, KEY_A = 32, KEY_SELECT = 64;

export function keysOf(bits: number): Keys {
  return { up: !!(bits & KEY_UP), down: !!(bits & KEY_DOWN), left: !!(bits & KEY_LEFT), right: !!(bits & KEY_RIGHT), b: !!(bits & KEY_B), a: !!(bits & KEY_A), select: !!(bits & KEY_SELECT) };
}

export function bitsOf(k: Keys): number {
  return (k.up ? KEY_UP : 0) | (k.down ? KEY_DOWN : 0) | (k.left ? KEY_LEFT : 0) | (k.right ? KEY_RIGHT : 0) | (k.b ? KEY_B : 0) | (k.a ? KEY_A : 0) | (k.select ? KEY_SELECT : 0);
}

export interface Actor {
  id: number;
  bot: boolean;
  name: string;
  /** The wardrobe index: what the ROM draws this trainer as in a battle. */
  skin: number;
  m: Mover;
  /** The keys it moved on last, and the time before (A is a press, not a hold). A bot's
   *  are set for each frame; a trainer's are the phone's inputs, one per move. */
  keys: number;
  last: number;
  /** In a battle: stands still, keys ignored, until end(). */
  battling: boolean;
  /** Who this trainer is fighting, a bot or a trainer, 0 for none (ids start at 1). */
  foe: number;
  /** No engage before this frame: the grace after a fight (BR_ENGAGE_GRACE). */
  calm: number;
  /** The trainer this one fled (or could not fight), and until when they keep apart
   *  (br_engage.c's fledFrom, BR_ENGAGE_LOCKOUT). */
  shun: number;
  shunUntil: number;
  /** A step finished whose arrival has not been looked at yet (the spots). */
  arriving: boolean;
  /** Aboard the SS TIDAL (TIDAL): where the crossing is. */
  cruise?: Cruise;
  /** In the Zone after the Safari: the frame the fly map's answer is due by, then the drop
   *  is anywhere. A battle there pushes it on, so the fly map always gets its time. */
  pickBy?: number;
  /** What the team could do on the field (FIELD_*): SURF, CUT, STRENGTH, as the page
   *  reads its party (br_hm.c asks the same: knows the move or could learn it). */
  field?: number;
  /** A bot fighting a bot: the trainer whose page fights it out (its hidden ROM, the
   *  proxy duel), and the frame it began. 0 for none. */
  judge?: number;
  since?: number;
  /** A trainer whose page is gone for now (a reload): they stand, and nobody engages
   *  them, until it is back or the relay gives up on it. */
  away?: boolean;
  /** Bites the fog has taken out of a bot (BOT_BITES and it is out), and the frame the
   *  next is due while it stands in the fog (its own clock, as brain.ts's bleedAt). */
  bites?: number;
  bleedAt?: number;
  /** A bot's pickings: the balls and the bags' items and money it took on its way, which
   *  go into the bag it drops when it is out. */
  loot?: { items: Stack[]; money: number };
  /** The trainer a bot's last fight was with: theirs is the one word on its wounds. */
  foughtBy?: number;
  /** A bot's wounds: each slot's HP as a share of its most, as its last fight left it
   *  (wornParty), none for a fresh one. */
  wear?: number[];
  /** Fighting gym leader n - 1 (gyms.ts). */
  boss?: number;
  /** A fight that started from a look, before it starts (br_walkup.h): the "!", then the
   *  walker walks the eyeline to the cell beside the other. On both; `walk` on the one
   *  who walks, `duel` for two trainers (a bot's is a fight). */
  meet?: { foe: number; walk: boolean; since: number; duel: boolean };
}

/** brain.ts QUAFF_COOLDOWN_MS: a bot drinks at most one medicine every 10 s. */
const QUAFF_FRAMES = 600;

/** A bot's team as the seed deals it, with the wounds its fights left it: a fainted slot
 *  stays down, a hurt one keeps its share (at least 1 HP), and the rest are whole. */
export function wornParty<T extends { hp: number; maxHp: number }>(party: T[], wear: readonly number[] | undefined): T[] {
  if (!wear) return party;
  return party.map((m, i) => {
    const w = wear[i];
    if (w === undefined) return m;
    return { ...m, hp: w <= 0 ? 0 : Math.max(1, Math.min(m.maxHp, Math.round(m.maxHp * w))) };
  });
}

/** A team with somebody who could SURF: water is walkable (and up a waterfall). */
export const FIELD_SURF = 4;
/** ...and DIVE: A on a dive spot goes under (br_hm.c BrHm_DiveScript). */
export const FIELD_DIVE = 8;

/** Where A takes a trainer who stands on `s` (TrySetupDiveDownScript, TrySetupDiveEmerge-
 *  Script): from a dive spot, with a team that could DIVE (and SURF, to swim below), the
 *  same cell of the map under the sea; from below, anywhere but a no-surfacing cell, the
 *  same cell above, free. Only to a map this room has. */
export function diveTo(maps: ReadonlyMap<string, WorldMap>, world: World, s: Spot, field: number): Spot | undefined {
  const m = maps.get(s.map);
  if (!m) return undefined;
  const i = s.y * m.w + s.x;
  if (m.dive && m.deep && (field & (FIELD_DIVE | FIELD_SURF)) === (FIELD_DIVE | FIELD_SURF) && maps.has(m.dive) && cellsOf(m.deep, m.w * m.h)[i]) return { map: m.dive, x: s.x, y: s.y };
  if (m.emerge && maps.has(m.emerge) && !(m.nosurf && cellsOf(m.nosurf, m.w * m.h)[i]) && world.cell(m.emerge, s.x, s.y) === CLASS_WATER) return { map: m.emerge, x: s.x, y: s.y };
  return undefined;
}
const cellCache = new Map<string, Uint8Array>();
const cellsOf = (rle: string, n: number) => {
  let c = cellCache.get(rle);
  if (!c) cellCache.set(rle, (c = decodeGrid(rle, n)));
  return c;
};

/** What a frame started: a phone starts the matching ROM battle for its own trainer. */
export type RoomEvent =
  | { type: 'wild'; tick: number; id: number; map: string; x: number; y: number; key: number }
  /** SELECT facing water: the rod is out over (x, y). The page fishes (fish.ts), and ends
   *  it as a wild battle ends: nothing bit, or what bit is beaten, caught or run from. */
  | { type: 'fish'; tick: number; id: number; map: string; x: number; y: number }
  | { type: 'fight'; tick: number; id: number; foe: number }
  /** Two trainers saw each other: a link battle. `first` is the side that challenged
   *  (link id 0, the lower id, as the ROM's own engage has it). */
  | { type: 'duel'; tick: number; id: number; foe: number; first: boolean }
  | { type: 'item'; tick: number; id: number; key: number; item: number; gift?: boolean }
  | { type: 'bag'; tick: number; id: number; key: number; bag: Bag; name: string; person?: Spill['person'] }
  /** A at a CENTER's nurse, from the counter. */
  | { type: 'nurse'; tick: number; id: number; map: string }
  /** A at an event's legendary: its battle (the room took it off the ground). */
  | { type: 'legend'; tick: number; id: number; key: number; species: number; level: number }
  /** A at an event's trader: his offer, for one of mine (`traded` says which). */
  | { type: 'trade'; tick: number; id: number; n: number; species: number; gives?: boolean }
  /** A at a REGI chamber's sealed wall (br_story.c's PressedAtWall): `opened` when that
   *  did it, else how it opens, for the page to say or (a FLY wall) to try. */
  | { type: 'door'; tick: number; id: number; n: number; how: StoryDoor; opened?: boolean }
  /** A at a gate's boss (br_story.c): his own fight, and his piece if he falls. */
  | { type: 'gate'; tick: number; id: number; key: number; gate: number; bag: Bag; name: string }
  /** A at a piece a gate's boss still guards. */
  | { type: 'guarded'; tick: number; id: number; name: string }
  /** A at the ferry's attendant (the live islands' stories, none: not sailing) or at a
   *  dock's sailor (`home`: back to Lilycove), or at a CABLE CAR's attendant (`cable`). */
  | { type: 'ferry'; tick: number; id: number; to: { id: string; name: string }[]; home?: boolean; briney?: boolean; cable?: 'up' | 'down' }
  /** The SS TIDAL's crossing: `say` what its scripts do when it boards, reaches halfway or
   *  makes land, after a rest in the bed (`bed`), or at its sailor (`sailor`: the way off
   *  once in port, else the cabin to rest in). */
  | { type: 'cruise'; tick: number; id: number; say: 'board' | 'halfway' | 'land' | 'sailor'; cruise: Cruise; bed?: boolean }
  /** A on a dive spot, or below the sea: the room has taken me down (`down`) or up. */
  | { type: 'dive'; tick: number; id: number; down: boolean }
  /** A at a MART's clerk. */
  | { type: 'mart'; tick: number; id: number; map: string }
  /** A at a gym leader nobody has beaten yet: their own battle (gyms.ts). */
  | { type: 'boss'; tick: number; id: number; n: number }
  /** Two bots saw each other: `id`'s page fights `a` against `b` in a hidden ROM and
   *  says who won (`bots`). Nobody's coin flip (CLAUDE.md: simulate every battle). */
  | { type: 'bots'; tick: number; id: number; a: number; b: number };

/** What a trainer who is out carried: the bag's items (not its key items or machines),
 *  money, and their team. */
export type Bag = BagRows;

/** A trainer's bag where they fell (POK-232). Its key is SPILL_KEY + their id. */
/** `legend`: an event's legendary, its one mon in the bag: A on it is its battle. */
export interface Spill {
  key: number; map: string; x: number; y: number; name: string; bag: Bag; legend?: boolean;
  /** A story's person handing it over (story.ts's people): who stands there, and the item
   *  he wants for it first. */
  person?: { gfx: number; name: string; wants?: number; gate?: number };
  /** A gate's other pieces: his own piece's key, which has to be gone first. */
  guard?: number;
}

/** The ferry (br_story.c): Lilycove's attendant sails to an island a live story is on,
 *  and each island's sailor sails back (LilycoveCity_Harbor's and the islands' warps).
 *  A dock: where the boat lands you, and where its sailor stands. */
export const ATTENDANT = { map: 'MAP_LILYCOVE_CITY_HARBOR', x: 8, y: 10 };
const HARBOR_LANDING = { map: 'MAP_LILYCOVE_CITY_HARBOR', x: 8, y: 11 };
export const DOCKS: Record<string, { map: string; x: number; y: number; sailor: [number, number] }> = {
  'southern-island': { map: 'MAP_SOUTHERN_ISLAND_EXTERIOR', x: 13, y: 22, sailor: [13, 23] },
  'birth-island': { map: 'MAP_BIRTH_ISLAND_HARBOR', x: 8, y: 4, sailor: [8, 5] },
  'faraway-island': { map: 'MAP_FARAWAY_ISLAND_ENTRANCE', x: 13, y: 38, sailor: [13, 39] },
  'navel-rock-top': { map: 'MAP_NAVEL_ROCK_HARBOR', x: 8, y: 4, sailor: [8, 5] },
  'navel-rock-bottom': { map: 'MAP_NAVEL_ROCK_HARBOR', x: 8, y: 4, sailor: [8, 5] },
};
/** Hoenn's own boats, kept running (br_boot.c; Cam: keep the harbours open): the SS TIDAL
 *  between Slateport's and Lilycove's harbours, the BATTLE FRONTIER off its menu, and
 *  MR. BRINEY between his cottage on Route 104, Dewford's dock and Route 109's beach, each
 *  stop sailing where its multichoice does (MULTI_BRINEY_ON_DEWFORD, _OFF_DEWFORD). Where
 *  each lands you: the scripts' own warps (SSTidalCorridor's 8,11; Dewford's sail to the
 *  cottage, 5,4), or beside BRINEY ashore. */
export const PORTS: Record<string, { name: string; land: Spot; facing: number }> = {
  slateport: { name: 'SLATEPORT CITY', land: { map: 'MAP_SLATEPORT_CITY_HARBOR', x: 8, y: 11 }, facing: 1 },
  lilycove: { name: 'LILYCOVE CITY', land: HARBOR_LANDING, facing: 1 },
  petalburg: { name: 'PETALBURG', land: { map: 'MAP_ROUTE104_MR_BRINEYS_HOUSE', x: 5, y: 4 }, facing: 1 },
  dewford: { name: 'DEWFORD', land: { map: 'MAP_DEWFORD_TOWN', x: 11, y: 9 }, facing: 4 },
  beach: { name: 'SLATEPORT', land: { map: 'MAP_ROUTE109', x: 20, y: 24 }, facing: 4 },
  // The CABLE CAR (CableCarWarp lands you at 6,4; the station's ExitCableCar walks you
  // down three, past the attendant's spot, facing out).
  chimney: { name: 'MT. CHIMNEY', land: { map: 'MAP_MT_CHIMNEY_CABLE_CAR_STATION', x: 6, y: 7 }, facing: 1 },
  route112: { name: 'ROUTE 112', land: { map: 'MAP_ROUTE112_CABLE_CAR_STATION', x: 6, y: 7 }, facing: 1 },
};
/** Who sails from where (each map.json's object): Slateport's ferry attendant, and
 *  MR. BRINEY at each of his three stops, all at once (one man in pret, VAR_BRINEY_LOCATION;
 *  a room has many trainers). Lilycove's attendant is ATTENDANT, with the islands. Each
 *  CABLE CAR station's attendant rides it the one way it goes from there. */
export const BOATS: { map: string; x: number; y: number; gfx: number; to: string[]; briney?: boolean; cable?: 'up' | 'down' }[] = [
  { map: 'MAP_SLATEPORT_CITY_HARBOR', x: 8, y: 10, gfx: 45, to: ['lilycove'] },
  { map: 'MAP_ROUTE104_MR_BRINEYS_HOUSE', x: 5, y: 3, gfx: 21, to: ['dewford'], briney: true },
  { map: 'MAP_DEWFORD_TOWN', x: 12, y: 9, gfx: 21, to: ['petalburg', 'beach'], briney: true },
  { map: 'MAP_ROUTE109', x: 21, y: 24, gfx: 21, to: ['dewford'], briney: true },
  { map: 'MAP_ROUTE112_CABLE_CAR_STATION', x: 6, y: 6, gfx: 45, to: ['chimney'], cable: 'up' },
  { map: 'MAP_MT_CHIMNEY_CABLE_CAR_STATION', x: 6, y: 6, gfx: 45, to: ['route112'], cable: 'down' },
];
/** MR. BRINEY's boat, moored at each stop (OBJ_EVENT_GFX_MR_BRINEYS_BOAT). */
export const MOORINGS: Spot[] = [
  { map: 'MAP_ROUTE104', x: 12, y: 54 }, { map: 'MAP_DEWFORD_TOWN', x: 12, y: 8 }, { map: 'MAP_ROUTE109', x: 21, y: 26 },
];
const boatAt = (map: string, x: number, y: number) => BOATS.find((b) => b.map === map && b.x === x && b.y === y);
/** The SS TIDAL's crossing (SSTidalCorridor/scripts.inc): either harbour boards you into
 *  the corridor at 1,10. One leg passes by SS_TIDAL_MAX_STEPS steps aboard (CountSSTidalStep,
 *  while FLAG_SYS_CRUISE_MODE is set), the other by the bed in cabin No. 2 (ProgessCruise-
 *  AfterBed); once she has made land, the sailor at 1,11 sees you off at the far harbour. */
export const TIDAL = { map: 'MAP_SS_TIDAL_CORRIDOR', x: 1, y: 10 };
export const TIDAL_SAILOR = { map: 'MAP_SS_TIDAL_CORRIDOR', x: 1, y: 11 };
const TIDAL_BEDS: Spot[] = [{ map: 'MAP_SS_TIDAL_ROOMS', x: 15, y: 11 }, { map: 'MAP_SS_TIDAL_ROOMS', x: 15, y: 12 }];
export const TIDAL_MAPS = ['MAP_SS_TIDAL_CORRIDOR', 'MAP_SS_TIDAL_ROOMS', 'MAP_SS_TIDAL_LOWER_DECK'];
export const SS_TIDAL_MAX_STEPS = 205;
/** Where a crossing is: under way, halfway, or in port. */
export interface Cruise { to: 'lilycove' | 'slateport'; leg: 'board' | 'depart' | 'halfway' | 'land'; steps: number }
const LEGS: Cruise['leg'][] = ['board', 'depart', 'halfway', 'land'];
/** Steps count on the leg FLAG_SYS_CRUISE_MODE is set for: out of Slateport, and the
 *  second half out of Lilycove (SetSSTidalFlag's two callers). */
const counting = (c: Cruise) => (c.to === 'lilycove' ? c.leg === 'depart' : c.leg === 'halfway');
/** The bed (SSTidalRooms_EventScript_ProgessCruiseAfterBed): bound for Lilycove it lands
 *  you from either leg; bound for Slateport, the first sleep is only halfway. */
const afterBed = (c: Cruise): Cruise['leg'] => (c.to === 'slateport' && (c.leg === 'board' || c.leg === 'depart') ? 'halfway' : 'land');
const bedAt = (map: string, x: number, y: number) => TIDAL_BEDS.some((b) => b.map === map && b.x === x && b.y === y);
/** The ferry's people, by cell: the attendant, each dock's sailor, the boats', and the
 *  SS TIDAL's sailor at its way off. */
export function ferryAt(map: string, x: number, y: number): 'attendant' | 'sailor' | 'boat' | 'tidal' | undefined {
  if (map === ATTENDANT.map && x === ATTENDANT.x && y === ATTENDANT.y) return 'attendant';
  if (map === TIDAL_SAILOR.map && x === TIDAL_SAILOR.x && y === TIDAL_SAILOR.y) return 'tidal';
  if (boatAt(map, x, y)) return 'boat';
  return Object.values(DOCKS).some((d) => d.map === map && d.sailor[0] === x && d.sailor[1] === y) ? 'sailor' : undefined;
}
const port = (id: string) => ({ id, name: PORTS[id].name });
/** Every map the ferry's docks lead to on foot (their warps): the islands, which no
 *  seam or door joins to Hoenn. */
export function islandMaps(all: readonly WorldMap[]): WorldMap[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const out = new Map<string, WorldMap>();
  const queue = [...new Set(Object.values(DOCKS).map((d) => d.map))];
  while (queue.length) {
    const m = byId.get(queue.shift()!);
    if (!m || out.has(m.id)) continue;
    out.set(m.id, m);
    for (const w of m.warps ?? []) queue.push(w.to);
  }
  return [...out.values()];
}

/** The REGI chambers' walls (story.ts's door rows): how each opens. */
const DOORS: Record<string, StoryDoor> = Object.fromEntries(STORIES.filter((s) => s.door).map((s) => [s.id, s.door!]));
const DOOR_MAPS = new Set(STORIES.filter((s) => s.door).map((s) => s.map));
/** Standing under the wall's middle, facing it (br_story.c's PressedAtWall). */
const atWall = (a: Actor): boolean => DOOR_MAPS.has(a.m.spot.map) && a.m.spot.x === 8 && a.m.spot.y === DOOR_Y + 1 && a.m.facing === 2;

/** The people a story stands (include/constants/event_objects.h), by story.ts's names. */
const PERSON_GFX: Record<string, [number, string]> = {
  OBJ_EVENT_GFX_STEVEN: [134, 'STEVEN'], OBJ_EVENT_GFX_SCIENTIST_1: [46, 'CAPT. STERN'],
  OBJ_EVENT_GFX_MAXIE: [196, 'MAXIE'], OBJ_EVENT_GFX_ARCHIE: [195, 'ARCHIE'],
  OBJ_EVENT_GFX_AQUA_MEMBER_F: [118, 'SHELLY'], OBJ_EVENT_GFX_AQUA_MEMBER_M: [117, 'MATT'],
};
/** The gates' bosses in br_story.c's sPeople order: BrStory_StartGate's numbers. */
const GATES = ['TRAINER_MAXIE_MAGMA_HIDEOUT', 'TRAINER_ARCHIE', 'TRAINER_SHELLY_WEATHER_INSTITUTE', 'TRAINER_MATT', 'TRAINER_MAXIE_MT_CHIMNEY', 'TRAINER_MAXIE_MOSSDEEP'];

/** An event this round (events.ts, DESIGN §Events): its number, where its legendary
 *  stands (its key), and which one. */
export interface EventMark {
  n: number; key: number; map: string; x: number; y: number;
  /** Its legendary, or 0 for a story with none (a rare find). */
  species: number; trader?: Trader;
  /** A story event's id (story.ts) and the place the ticker names. */
  story?: string; place?: string;
  /** A REGI chamber's story: the phase it dropped on, and whether its wall is open. */
  phase?: number; opened?: boolean;
}

/** An event's trader (br_event.c): where he stands, the rare he offers for any one of
 *  yours, and who is trading with him now (0 for nobody). He keeps what he is given and
 *  offers that next (Cam's 2026-10-19 play-test, #9). */
export interface Trader { x: number; y: number; species: number; busy: number }

/** Somebody at home, or a floor's trader (br_balls.c, POK-379): one house in eight has
 *  somebody beside its cache with a Pokémon, half of them giving it to the first trainer
 *  who talks to them (then gone), half trading it; and the big floors' traders. A trader
 *  keeps what he is given and offers that next. `n` is HOME_N + the row. */
export interface Home extends Trader { n: number; map: string; gives?: boolean; gone?: boolean }
export const HOME_N = 1000;
/** br_balls.c's sHomeMons: what Hoenn's own people give and trade. */
const HOME_MONS = [277, 280, 283, 1, 4, 7, 64, 67, 75, 93, 385, 143];

/** Event pieces' keys: clear of the dealt balls' and the trainers' (SPILL_KEY + id). */
export const EVENT_SPILL = 2 << 20;
export const eventPiece = (n: number, i: number): number => EVENT_SPILL | (n << 4) | i;
/** A released mon's ball: clear of both (`released`). */
export const RELEASED_SPILL = 3 << 20;

/** Nothing in it: no items, no money, nobody. */
export const emptyBag = (b: Bag): boolean => !b.items.length && !b.money && !b.mons?.length;

/** BR_ENGAGE_GRACE: after a fight, two seconds before the next engage. */
const GRACE = 120;
/** BR_ENGAGE_LOCKOUT: a pair whose fight never got going, or was fled, keeps apart 10 s. */
const LOCKOUT = 600;
/** Everybody starts by the truck: five seconds to walk off before an engage. */
const JOIN_GRACE = 300;
const BACK: Record<number, number> = { 1: 2, 2: 1, 3: 4, 4: 3 };
/** br_walkup.h: the "!" holds everything this long before the walk, and a walk that
 *  cannot finish goes into the fight anyway after the eyeline's length in walks. */
export const WALKUP_BANG = 30;
export const APPROACH_FRAMES = (SIGHT_RANGE + 1) * 16 + 90;
const KEY_TO: Record<number, number> = { 1: KEY_DOWN, 2: KEY_UP, 3: KEY_LEFT, 4: KEY_RIGHT };
/** One bot-vs-bot fight starts at most this often, room-wide (POK-273's
 *  DUEL_COOLDOWN_MS): every pair that could see each other fighting at once decided a
 *  full room before the first ring moved. */
export const BOT_DUEL_GAP = 60 * 12;
/** A bot-vs-bot fight nobody has answered for this long lets them go (the proxy's own
 *  wall-clock cap is 90 s). */
export const BOT_DUEL_MAX = 60 * 120;
/** The fog bites a bot every BOT_BITE frames it stands in it, and the BOT_BITES-th takes
 *  it: the live bots' bleed, a tenth of the team every four seconds (brain.ts FOG_TICK_MS,
 *  FOG_BITE), whatever the room's FOG. Each bot on its own clock from when it walked in,
 *  so a ring closing on many does not take them all on one frame. */
export const BOT_BITE = 240;
export const BOT_BITES = 10;

/** The caches' rooms (tools/br/spike-rooms.py, from br_balls.c): map, cell, a house. */
const ROOMS = roomsJson as [string, number, number, boolean, boolean, number, number, boolean][];

/** Spill keys, clear of the dealt balls' 1..n. */
export const SPILL_KEY = 1 << 20;

/** An item ball: its key, its cell and what is in it. */
export interface Ground { key: number; map: string; x: number; y: number; item: number; gift?: boolean }

/** The Safari Zone's balls (br_zone.c's sSafariItemCells): one an area, each as far
 *  from that area's spawn cells as the grid allows. */
export const ZONE_CELLS: readonly Spot[] = [
  { map: 'MAP_SAFARI_ZONE_NORTHWEST', x: 8, y: 36 },
  { map: 'MAP_SAFARI_ZONE_NORTH', x: 19, y: 8 },
  { map: 'MAP_SAFARI_ZONE_NORTHEAST', x: 5, y: 20 },
  { map: 'MAP_SAFARI_ZONE_SOUTHWEST', x: 31, y: 21 },
  { map: 'MAP_SAFARI_ZONE_SOUTH', x: 4, y: 20 },
  { map: 'MAP_SAFARI_ZONE_SOUTHEAST', x: 30, y: 20 },
];
export const ITEM_MASTER_BALL = 1;
/** What a Zone ball holds (br_zone.c's sBallItems): POKe BALL, HYPER and MAX POTION, FULL
 *  RESTORE, REVIVE, FULL HEAL, X ATTACK and SPEED, RARE CANDY, the six stones, NUGGET, PP UP. */
export const ZONE_ITEMS: readonly number[] = [4, 21, 19, 24, 20, 23, 75, 77, 68, 95, 97, 96, 98, 93, 94, 110, 69];
/** Or, one ball in BR_ZONE_TM_IN, a machine (sBallTMs): DRAGON CLAW to OVERHEAT. */
export const ZONE_TMS: readonly number[] = [2, 6, 13, 14, 15, 19, 22, 24, 25, 26, 29, 30, 31, 35, 36, 38, 40, 50].map((n) => 288 + n);
const ZONE_TM_IN = 2;
/** Kanto's one-in-eight (v0.49.0): a match has a MASTER BALL in one of them, or none. */
const ZONE_MASTER_ODDS = 8;

/** What the Zone's six balls hold for a match's seed (br_zone.c BrZone_Ensure), in
 *  ZONE_CELLS order. */
export function zoneBalls(seed: number): number[] {
  let z = (seed ^ 0x5a17) >>> 0 || 1;
  const zr = () => { z ^= z << 13; z ^= z >>> 17; z ^= z << 5; return (z >>> 0) / 4294967296; };
  const pick = (t: readonly number[]) => t[Math.floor(zr() * t.length)];
  const zone = ZONE_CELLS.map(() => (Math.floor(zr() * ZONE_TM_IN) === 0 ? pick(ZONE_TMS) : pick(ZONE_ITEMS)));
  if (Math.floor(zr() * ZONE_MASTER_ODDS) === 0) zone[Math.floor(zr() * zone.length)] = ITEM_MASTER_BALL;
  return zone;
}

/** The DAY CARE, which is a chest (POK-306, Cam: "a chest where the first one there takes
 *  the Pokemon"): the middle of its floor, and what is in it, fully evolved and nothing
 *  legendary (br_zone.c's sChest). */
export const CHEST: Spot = { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 5 };
export const CHEST_SPECIES: readonly number[] = [397, 400, 334, 359, 329, 394, 366, 384, 376, 331, 343, 391, 389, 307, 338, 285, 279, 282];
const CHEST_KEY = 4 << 20;

/** Item balls a map gets: the match deals two a section, and a spike map is two or three
 *  of them (Cam, POK-354: "more items all over the place"). */
export const GROUND_PER_MAP = 6;
/** A stream of its own for one cell's roll: xorshift off the seed, the map's name and the
 *  cell, the same on every page. */
function cellRng(seed: number, map: string, x: number, y: number): () => number {
  let s = (seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b)) >>> 0;
  for (let i = 0; i < map.length; i++) s = Math.imul(s ^ map.charCodeAt(i), 0x01000193) >>> 0;
  s = s || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
/** br_balls.c BR_BALLS_TM_IN: one ground ball in this many is a machine. */
export const BALLS_TM_IN = 4;

/** A change that is not a key: applied at the start of its frame, before anybody moves. */
export type Command =
  | { c: 'join'; id: number; bot: boolean; name: string; skin: number; spot: Spot; facing: number }
  | { c: 'leave'; id: number }
  /** `fled`: the fight never got going or was run from (a link that never answered,
   *  a forfeit): that pair keeps apart a while (BrEngage_NoAnswer). `won`: a bot was
   *  beaten, and is out of the round. */
  | { c: 'end'; id: number; fled?: boolean; won?: boolean }
  /** The ball `key` would not go in `id`'s bag: it lies where it was (POK-294, nothing
   *  leaves the match). A bag goes back down holding `rest`, what did not fit. */
  | { c: 'drop'; id: number; key: number; rest?: Bag }
  /** `id`'s team is down (the fog, or a lost battle): off the map, watching. What they
   *  carried lies where they stood (POK-232). `by` the trainer or bot that beat them,
   *  `wild` a wild POKeMON did; neither, the fog. */
  | { c: 'out'; id: number; bag?: Bag; by?: number; wild?: boolean }
  /** START (a lobby's): the trainers on the map now are the match; anybody later watches. */
  | { c: 'lock' }
  /** `id`'s team could now do these on the field (FIELD_*). */
  | { c: 'field'; id: number; bits: number }
  /** `id`'s page fought bots `a` and `b` (a `bots` event): `winner` beat the other, or
   *  0 for no answer (its ROM could not), and both walk on. */
  /** `hp`: what the winner had left, as shares; `used`: what each side spent of its bag. */
  | { c: 'bots'; id: number; a: number; b: number; winner: number; hp?: number[]; used?: [number[], number[]] }
  /** `id` traded event `n`'s trader the species `given` (0: thought better of it). */
  | { c: 'traded'; id: number; n: number; given: number }
  /** `id` caught one more than a party holds and let `mons` go: they lie beside them, as
   *  balls anybody can take (POK-294, BrLoot_Released: nothing leaves the match). */
  | { c: 'released'; id: number; mons: { species: number; level: number }[] }
  /** `id` opened event `n`'s REGI wall (a Flying-type in their party, the page saw). */
  | { c: 'open'; id: number; n: number }
  /** `id` flew off the MAP (FLY, br_map.c) and landed at `to`. */
  | { c: 'fly'; id: number; to: Spot }
  /** Trainer `id`'s ROM's word on the bot it is fighting: what is left of its team. */
  | { c: 'wear'; id: number; bot: number; hp: number[]; spent?: number[] }
  /** `id` sails to story `to`'s island, or ('') from an island back to Lilycove. */
  | { c: 'sail'; id: number; to: string }
  /** `id`'s page went (a reload), or came back. */
  | { c: 'away'; id: number; on: boolean }
  /** Drop `id` on `map` when the Safari ends. */
  | { c: 'pick'; id: number; map: string };

/** Everything a Room is, as plain data: what a phone joining late is sent. */
export interface RoomState {
  tick: number;
  seed: number;
  actors: Actor[];
  taken: [number, number][];
  /** Item balls taken: key, and who took it. */
  picked?: [number, number][];
  /** Bags dropped by trainers who are out, taken or not (`picked` says). */
  spills?: Spill[];
  bench?: Benched[];
  results?: Results;
  /** Frames a ring phase lasts, when not RING_PHASE (a test's quicker fog). */
  ringPhase?: number;
  /** The frame this round started on (a win starts the next early). */
  epoch?: number;
  opening?: number;
  /** No bot-vs-bot fight starts before this frame (BOT_DUEL_GAP). */
  duelAfter?: number;
  events?: EventMark[];
  /** The gym leaders beaten this round: leader n, by whom. */
  gyms?: [number, string][];
  homes?: Home[];
}

/** A trainer in the world but not on the map: out this round, or come in after the fog
 *  closed. Back at the truck when it lifts. */
/** `away`: its phone gone a moment (a reload, a dropped socket), coming back within the minute. */
export interface Benched { id: number; name: string; skin: number; away?: boolean }

/** One who went out of a round: what beat them (a name; '' for the fog), or `left`. */
export interface Fallen { id: number; name: string; by: string; wild?: boolean; left?: boolean; bot?: boolean; at?: number }

/** A round as a match: who was in when the fog closed -- trainers and bots, as a match's
 *  seats are (director.ts aliveSeats) -- who went out in what order, and the last one
 *  standing (0 until there is one), and when. Nobody on the map when the fog closes: no
 *  entrants, the round is nobody's, and joins go straight in until the next. */
export interface Results { round: number; entrants: [number, string][]; fallen: Fallen[]; winner: number; wonAt?: number }

/** After a win the next round starts this soon (Cam: the next match promptly). */
export const AFTER_WIN = 60 * 15;

/** The cells by the truck new trainers stand on, nearest first. */
const TRUCK = 40;

const DEALS = new Map<string, ReadonlyMap<string, Ground>>();
/** Every cell a trainer can walk to from Littleroot, per set of maps. */
const REACH = new Map<string, Spot[]>();
const LANDS = new Map<string, Set<string>>();
/** The cells inside those big components themselves, per set of maps (Room.open). */
const OPENS = new Map<string, Spot[]>();
/** The maps with a landing cell, by landing(). */
const LANDED = new WeakMap<ReadonlySet<string>, Set<string>>();
/** The least ground a drop's cell must be joined to on foot (Room.landing). */
const LANDING = 200;

/** A ring phase, in frames: the match's 120 s (DEFAULT_FOG_SECS, web/src/match/director.ts). */
export const RING_PHASE = 60 * 120;
/** Tiles to a region-map section in this world's plane: the least-squares fit of each
 *  placed map's centre against its section's (region_map_sections.json), 27.4 across and
 *  27.0 down (room.test.ts checks it). */
export const SECTION_TILES = 27;
/** Each phase's radius in tiles: the live match's, clock.ts's RING_RADII in sections at
 *  SECTION_TILES each. The first an announcement (no fog); 0 the centre's own section, as
 *  the ROM's nearest-point test keeps it (br_ring.c BrRing_SectionInside); -1 everywhere.
 *  Not shares of the centre's farthest reachable cell, as it was: that world is the walk
 *  out of Littleroot, a few sections across, so the first shrink fogged most of Hoenn
 *  (Cam 2026-10-29, as on 09-18 with Mossdeep). */
const RING_STEPS = RING_RADII.map((r, i) => (i === 0 ? Infinity : r < 0 ? r : Math.max(r, 0.5) * SECTION_TILES));
/** How near a walking trainer must be able to stand to a final story's place for the ring
 *  to centre on it (FINAL_CHANCE). */
const FINAL_REACH = 24;

/** The ring at a frame, in the plane layout() places the maps in (tiles). `r` is Infinity
 *  for no fog and -1 for fog everywhere; `left` the frames to the next phase. */
export interface Ring { round: number; phase: number; last: boolean; cx: number; cy: number; r: number; next?: number; left: number; safari?: boolean }

/** The Safari opening (DESIGN §The drop): every round begins with every trainer in the
 *  Safari Zone for one phase's length, catching, no fighting; then the drop puts each
 *  where they asked (`pick`), or anywhere. */
export const SAFARI = 'MAP_SAFARI_ZONE_';
/** Frames after the Safari before whoever has not chosen on the fly map drops anyway:
 *  br_pick.c's twenty seconds to choose and fifteen of waiting for the cell. */
export const PICK_WAIT = 35 * 60;

export class Room {
  tick = 0;
  actors: Actor[] = [];
  /** Taken spots by key, and the frame they were taken. */
  taken = new Map<number, number>();
  /** Item balls taken, by key, and who took each (they do not grow back). */
  picked = new Map<number, number>();
  /** Bags trainers who went out left, by key; one is lying while `picked` has not got it. */
  spills = new Map<number, Spill>();
  bench: Benched[] = [];
  results: Results = { round: 0, entrants: [], fallen: [], winner: 0 };
  duelAfter = 0;
  /** This round's events, in the order they dropped. */
  events: EventMark[] = [];
  /** Who beat which gym leader this round, in the order they fell. */
  gyms: [number, string][] = [];
  /** This round's people at home and floor traders (dealHomes). */
  homes: Home[] = [];
  private readonly base: StepFn;
  /** The StepFn for each FIELD_* combination a team has. */
  private readonly fields: StepFn[] = [];
  private dealt: ReadonlyMap<string, Ground> | null = null;

  constructor(
    readonly world: World,
    /** The maps a trainer may walk on: the outdoor ones joined to Littleroot. */
    readonly maps: ReadonlyMap<string, WorldMap>,
    readonly patches: PatchTable,
    readonly seed: number,
    /** Where each outdoor map sits in the plane (layout()): the ring is measured there. */
    readonly places: ReadonlyMap<string, { gx: number; gy: number }>,
    /** Where each building and cave counts as being: the outdoor cell its way in leaves
     *  from (interiors()). The fog outside a door is the fog inside it. */
    readonly anchors: ReadonlyMap<string, { gx: number; gy: number }> = new Map(),
  ) {
    this.base = stepFn(world);
    this.homes = this.dealHomes(0);
    this.placeChest(0);
  }

  /** Round `round`'s people at home, from the seed: the houses this world goes into,
   *  one in eight with somebody (half give), and every floor that has a trader. */
  private dealHomes(round: number): Home[] {
    let state = (this.seed ^ 0x40e5 ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0 || 1;
    const rng = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const which = Math.floor(rng() * 8);
    const out: Home[] = [];
    ROOMS.forEach(([map, , , house, , x, y, trader], i) => {
      const draw = rng(), gives = rng() < 0.5;
      if (!this.maps.has(map) || this.places.has(map) || (house ? i % 8 !== which : !trader)) return;
      out.push({ n: HOME_N + i, map, x, y, species: HOME_MONS[Math.floor(draw * HOME_MONS.length)], busy: 0, ...(house && gives ? { gives: true } : {}) });
    });
    return out;
  }

  state(): RoomState {
    return { tick: this.tick, seed: this.seed, actors: structuredClone(this.actors), taken: [...this.taken], picked: [...this.picked], spills: structuredClone([...this.spills.values()]), bench: structuredClone(this.bench), results: structuredClone(this.results), ...(this.ringPhase !== RING_PHASE ? { ringPhase: this.ringPhase } : {}), ...(this.epoch ? { epoch: this.epoch } : {}), ...(this.opening ? { opening: this.opening } : {}), ...(this.duelAfter ? { duelAfter: this.duelAfter } : {}), ...(this.events.length ? { events: structuredClone(this.events) } : {}), ...(this.gyms.length ? { gyms: structuredClone(this.gyms) } : {}), homes: structuredClone(this.homes) };
  }

  load(s: RoomState): void {
    this.tick = s.tick;
    this.ringPhase = s.ringPhase ?? RING_PHASE;
    this.epoch = s.epoch ?? 0;
    this.opening = s.opening ?? 0;
    this.duelAfter = s.duelAfter ?? 0;
    this.events = structuredClone(s.events ?? []);
    this.gyms = structuredClone(s.gyms ?? []);
    this.homes = s.homes ? structuredClone(s.homes) : this.dealHomes(s.results?.round ?? 0);
    this.actors = structuredClone(s.actors);
    this.taken = new Map(s.taken);
    this.picked = new Map(s.picked ?? []);
    this.spills = new Map(structuredClone(s.spills ?? []).map((b) => [b.key, b]));
    this.bench = structuredClone(s.bench ?? []);
    this.results = structuredClone(s.results ?? { round: 0, entrants: [], fallen: [], winner: 0 });
  }

  actor(id: number): Actor | undefined {
    return this.actors.find((a) => a.id === id);
  }

  apply(cmd: Command): void {
    if (cmd.c === 'field') {
      const a = this.actor(cmd.id);
      if (a && !a.bot) a.field = cmd.bits & 15;
    } else if (cmd.c === 'pick') {
      const a = this.actor(cmd.id);
      // The fly map's answer (br_pick.h): out of the Zone now, onto a free cell of the
      // map asked for. At the opening's end, or before it when the balls ran out.
      if (a && !a.bot && a.m.spot.map.startsWith(SAFARI) && this.places.has(cmd.map) && !cmd.map.startsWith(SAFARI)) this.dropOne(a, cmd.map);
    } else if (cmd.c === 'away') {
      const a = this.actor(cmd.id) ?? this.bench.find((b) => b.id === cmd.id);
      if (a && !('bot' in a && a.bot)) a.away = cmd.on || undefined;
    } else if (cmd.c === 'wear') {
      // Once, from the trainer it last fought (out by now, if it won), and only a bot
      // still in: its next fight is with the team that one left it (classic's setParty,
      // brain.ts). A share, so a new rung's levels keep it (climb()).
      const b = this.actor(cmd.bot);
      if (!b?.bot || b.foughtBy !== cmd.id) return;
      b.foughtBy = undefined;
      b.wear = cmd.hp.slice(0, 6).map((v) => Math.min(1, Math.max(0, v)));
      // And what it spent of the bag it fought with (br_bot.c SendSpent): gone, so not
      // in its next fight nor on the ground when it falls.
      if (cmd.spent && b.loot) spend(b.loot.items, cmd.spent.slice(0, 4));
    } else if (cmd.c === 'fly') {
      // To a town of the match's own Hoenn, on a cell a trainer could stand on, and not
      // out of the Zone before the drop (its gate is shut both ways).
      const a = this.actor(cmd.id), t = cmd.to;
      if (!a || a.bot || a.battling || a.m.action || this.ring().safari || !this.places.has(t.map)) return;
      if (this.world.cell(t.map, t.x, t.y) !== 0 || this.actors.some((o) => o.m.spot.map === t.map && o.m.spot.x === t.x && o.m.spot.y === t.y)) return;
      a.m = newMover({ map: t.map, x: t.x, y: t.y }, 1);
    } else if (cmd.c === 'sail') {
      const a = this.actor(cmd.id);
      if (!a || a.bot || a.battling || a.m.action) return;
      const [x, y] = this.ahead(a);
      const who = ferryAt(a.m.spot.map, x, y);
      const boat = who === 'boat' ? boatAt(a.m.spot.map, x, y) : undefined;
      if (who === 'tidal') {
        // Off the SS TIDAL at the harbour it made land in (SSTidalCorridor_EventScript_ExitLilycove).
        if (a.cruise?.leg === 'land' && cmd.to === a.cruise.to) {
          const p = PORTS[cmd.to];
          a.m = newMover({ ...p.land }, p.facing);
          a.cruise = undefined;
        }
      } else if (cmd.to === '' && who === 'sailor') a.m = newMover(HARBOR_LANDING, 1);
      else if ((boat?.to.includes(cmd.to) || (who === 'attendant' && cmd.to === 'slateport')) && PORTS[cmd.to]) {
        const p = PORTS[cmd.to];
        // The SS TIDAL's two harbours board you, as their attendants do (SlateportCity_Harbor's
        // warp MAP_SS_TIDAL_CORRIDOR, 1, 10); MR. BRINEY and the CABLE CAR take you straight there.
        if (cmd.to === 'lilycove' || cmd.to === 'slateport') {
          a.m = newMover({ ...TIDAL }, 2);
          a.cruise = { to: cmd.to, leg: 'board', steps: 0 };
        } else a.m = newMover({ ...p.land }, p.facing);
      } else if (who === 'attendant' && this.sailingTo().some((s) => s.id === cmd.to)) {
        const d = DOCKS[cmd.to];
        a.m = newMover({ map: d.map, x: d.x, y: d.y }, 2);
      }
    } else if (cmd.c === 'open') {
      const a = this.actor(cmd.id), e = this.events.find((q) => q.n === cmd.n);
      if (a && e && e.story && DOORS[e.story] && a.m.spot.map === e.map && atWall(a)) e.opened = true;
    } else if (cmd.c === 'released') {
      // Beside the trainer, never under: a ball at their feet is taken back by the A
      // already held, into a party still full (br_loot.c's BrLoot_Released). Facing first,
      // then round; nowhere free, and it stays in its ball, as the ROM's does.
      const a = this.actor(cmd.id);
      if (!a) return;
      const used = new Set<string>();
      for (const mon of cmd.mons.slice(0, 6)) {
        const to = this.beside(a, used);
        if (!to) return;
        used.add(`${to.map}:${to.x}:${to.y}`);
        let key = RELEASED_SPILL | ((cmd.id & 0xff) << 12) | (this.tick & 0xfff);
        while (this.spills.has(key)) key++;
        this.spills.set(key, { key, map: to.map, x: to.x, y: to.y, name: '', bag: { items: [], money: 0, mons: [{ species: mon.species, level: mon.level }] } });
      }
    } else if (cmd.c === 'traded') {
      const t: (Trader & { gives?: boolean; gone?: boolean }) | undefined = this.events.find((e) => e.n === cmd.n)?.trader ?? this.homes.find((h) => h.n === cmd.n);
      if (!t || t.busy !== cmd.id) return;
      t.busy = 0;
      // A giver's is taken (given: anything but 0), and he is gone; a trader holds yours.
      if (t.gives) { if (cmd.given) t.gone = true; }
      else if (cmd.given > 0 && cmd.given < 412) t.species = cmd.given;
      const a = this.actor(cmd.id);
      if (a?.battling && !a.foe) { a.battling = false; a.calm = this.tick + GRACE; }
    } else if (cmd.c === 'bots') {
      const a = this.actor(cmd.a), b = this.actor(cmd.b);
      if (!a || !b || !a.bot || !b.bot || a.foe !== b.id || b.foe !== a.id || a.judge !== cmd.id || !a.battling) return;
      this.part(a);
      this.part(b);
      const won = cmd.winner === a.id ? a : cmd.winner === b.id ? b : undefined;
      const lost = won === a ? b : won === b ? a : undefined;
      // Each bag spends what it used, and the winner keeps what the fight left it
      // (brain.ts settleAnswered); then the loser goes, with what it has left.
      if (cmd.used && a.loot) spend(a.loot.items, cmd.used[0].slice(0, 4));
      if (cmd.used && b.loot) spend(b.loot.items, cmd.used[1].slice(0, 4));
      if (won && cmd.hp) won.wear = cmd.hp.slice(0, 6).map((v) => Math.min(1, Math.max(0, v)));
      if (won && lost) this.botOut(lost, won.name);
    } else if (cmd.c === 'lock') {
      this.results.entrants = this.actors.map((a) => [a.id, a.name]);
      // No Safari (SAFARI 0, the live room's escape hatch): straight to a dealt drop,
      // each trainer somewhere of their own, not side by side at the truck and into a
      // duel the moment the grace is up (HBR-104).
      if (!this.opening) for (const a of this.actors) if (!a.bot) this.dropOne(a);
    } else if (cmd.c === 'join') {
      if (this.actor(cmd.id) || this.bench.some((b) => b.id === cmd.id)) return;
      // The fog has closed on this round: in from the next.
      if (this.results.entrants.length && !cmd.bot) { this.bench.push({ id: cmd.id, name: cmd.name, skin: cmd.skin }); return; }
      const a: Actor = { id: cmd.id, bot: cmd.bot, name: cmd.name, skin: cmd.skin, m: newMover(cmd.spot, cmd.facing), keys: 0, last: 0, battling: false, foe: 0, calm: this.tick + JOIN_GRACE, shun: 0, shunUntil: 0, arriving: false };
      // Ordered by id, on every machine: who moves first decides who gets a contested cell.
      this.actors.push(a);
      this.actors.sort((p, q) => p.id - q.id);
    } else if (cmd.c === 'drop') {
      if (this.picked.get(cmd.key) !== cmd.id) return;
      this.picked.delete(cmd.key);
      const b = this.spills.get(cmd.key);
      if (b && cmd.rest) b.bag = structuredClone(cmd.rest);
    } else if (cmd.c === 'leave' || cmd.c === 'out') {
      // A bot fought by somebody who left walks again.
      const a = this.actor(cmd.id);
      // Where they stood: nobody else can be on that cell, nor a ball (both are solid).
      if (a && cmd.c === 'out' && cmd.bag && !emptyBag(cmd.bag)) {
        const key = SPILL_KEY + a.id, at = this.fallen(a);
        this.spills.set(key, { key, map: at.map, x: at.x, y: at.y, name: a.name, bag: structuredClone(cmd.bag) });
      }
      this.remove(cmd.id);
      if (cmd.c === 'leave') this.bench = this.bench.filter((b) => b.id !== cmd.id);
      if (!a || a.bot) return;
      if (cmd.c === 'out') this.bench.push({ id: a.id, name: a.name, skin: a.skin });
      if (cmd.c === 'leave') this.fall(a, '', { left: true });
      else this.fall(a, cmd.by ? this.actor(cmd.by)?.name ?? this.bench.find((b) => b.id === cmd.by)?.name ?? '' : '', cmd.wild ? { wild: true } : {});
    } else {
      const a = this.actor(cmd.id);
      if (!a || !a.battling) return;
      a.battling = false;
      a.keys = a.last = 0;
      a.calm = this.tick + GRACE;
      if (cmd.fled && a.foe) { a.shun = a.foe; a.shunUntil = this.tick + LOCKOUT; }
      const foe = a.foe ? this.actor(a.foe) : undefined;
      // Ended before the walk-up was over: the other has no battle to end, so is free too.
      if (a.meet) {
        a.meet = undefined;
        if (foe?.meet?.foe === a.id) { foe.meet = undefined; foe.battling = false; foe.foe = 0; foe.calm = this.tick + GRACE; }
      }
      if (foe?.bot) {
        foe.battling = false;
        foe.calm = this.tick + GRACE;
        // Beaten: out, and its bag down where it stood (the page says nothing of a fight
        // that ran over into a new round: that was the old round's).
        if (cmd.won) this.botOut(foe, a.name);
      }
      a.foe = 0;
      // A gym leader falls once: the first to beat them closes the gym.
      if (a.boss) {
        if (cmd.won && !this.bossDown(a.boss - 1)) this.gyms.push([a.boss - 1, a.name]);
        a.boss = undefined;
      }
    }
  }

  /** The islands the ferry sails to now: a live story's whose first piece still lies there
   *  (br_story.c's LiveAt), one row an island. */
  sailingTo(): { id: string; name: string }[] {
    const out: { id: string; name: string }[] = [];
    for (const e of this.events) {
      const d = e.story ? DOCKS[e.story] : undefined;
      if (!d || !this.spills.has(e.key) || this.picked.has(e.key) || out.some((o) => DOCKS[o.id].map === d.map)) continue;
      out.push({ id: e.story!, name: e.place ?? e.story! });
    }
    return out;
  }

  /** Gym leader `n` has been beaten this round. */
  bossDown(n: number): boolean {
    return this.gyms.some(([m]) => m === n);
  }

  /** Every CENTER's doorstep on the match's own outdoor maps: the cell below a door into a
   *  map with a nurse (world.ts centre), where its trainers walk out. Found once. */
  centreSteps(): Spot[] {
    if (this.steps) return this.steps;
    const out: Spot[] = [];
    for (const id of this.places.keys()) {
      for (const w of this.world.map(id)?.warps ?? []) {
        if (this.world.map(w.to)?.centre && this.world.cell(id, w.x, w.y + 1) === 0) out.push({ map: id, x: w.x, y: w.y + 1 });
      }
    }
    return (this.steps = out);
  }
  private steps: Spot[] | null = null;

  /** A marked spot taken stays taken for the rest of its ring phase, and every one is
   *  back on the next (br_patch.c Regrow, on each new phase's RING). */
  isTaken(key: number): boolean {
    const at = this.taken.get(key);
    return at !== undefined && this.phaseAt(at) === this.phaseAt(this.tick);
  }

  /** The ring phase a frame is in, -1 for the Safari before the ring. */
  private phaseAt(tick: number): number {
    const r = this.ring(tick);
    return r.safari ? -1 : r.phase;
  }

  /** Every item ball the seed deals, taken or not, by cell (`map:x:y`). On the room's
   *  open ground (open(): every outdoor map, none on an island or behind a ledge that only
   *  goes one way out; it was the ground walkable from Littleroot, which put all of them
   *  on seven maps), each on plain ground, never a marked spot or a door, nor the corner
   *  new trainers stand on. */
  ground(): ReadonlyMap<string, Ground> {
    if (this.dealt) return this.dealt;
    // The same seed over the same maps deals the same balls: dealt once a process (the
    // relay makes one room; the tests and a phone's resyncs make many).
    const id = `${this.seed}:${[...this.maps.keys()].join()}`;
    const hit = DEALS.get(id);
    if (hit) return (this.dealt = hit);
    const land = new Map<string, Spot[]>();
    for (const at of this.open()) {
      if (this.world.cell(at.map, at.x, at.y) !== 0 || this.world.warpAt(at.map, at.x, at.y)) continue;
      const l = land.get(at.map) ?? [];
      l.push(at);
      land.set(at.map, l);
    }
    let state = (this.seed ^ 0x17e3ba11) >>> 0 || 1;
    const rng = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const out = new Map<string, Ground>();
    let n = 0;
    for (const id of [...land.keys()].sort()) {
      const marked = new Set(this.patchesOn(id).map((q) => `${q.x}:${q.y}`));
      const cells = land.get(id)!.filter((c) => !marked.has(`${c.x}:${c.y}`) &&
        !(id === 'MAP_LITTLEROOT_TOWN' && c.x >= 7 && c.x <= 13 && c.y >= 9 && c.y <= 13));
      for (let i = 0; i < GROUND_PER_MAP && cells.length; i++) {
        const c = cells.splice(Math.floor(rng() * cells.length), 1)[0];
        // A machine one ball in BALLS_TM_IN, as br_balls.c's BrBalls_Deal makes them (Cam,
        // 10-31: "not enough TMs"; the table alone gave one in ten); the rest off the
        // table without its machines, a cable or a doll among them. A machine is taught
        // there and then, as a match's is (rom.ts teach).
        // The roll is the ball's own (seed and cell, as BrBalls_Deal mixes the seed with
        // the ball's map and id), so the match's stream draws what it always did.
        let item = cableOrDoll(scatterItem(rng), rng());
        const own = cellRng(this.seed ^ 0xba11, id, c.x, c.y);
        if (Math.floor(own() * BALLS_TM_IN) === 0) item = blueTm(own);
        else while (isTm(item)) item = cableOrDoll(scatterItem(own), own());
        out.set(`${id}:${c.x}:${c.y}`, { key: ++n, map: id, x: c.x, y: c.y, item });
      }
    }
    // The Zone's six (br_zone.c BrZone_Ensure): a machine one time in two, and one match in
    // eight a MASTER BALL in place of one of them. On the Zone's own maps, which the
    // opening walks; a room with no Zone has none.
    const zone = zoneBalls(this.seed);
    ZONE_CELLS.forEach((c, i) => {
      if (this.maps.has(c.map) && !out.has(`${c.map}:${c.x}:${c.y}`)) out.set(`${c.map}:${c.x}:${c.y}`, { key: ++n, map: c.map, x: c.x, y: c.y, item: zone[i] });
    });
    // A cache in every house and on every other floor that had nothing (br_balls.c's
    // sRooms, Cam 2026-10-18: "an item, trader, or both on every floor"): a machine, or
    // gold one time in three in a house and one in eight on a floor.
    for (const [map, x, y, house, cache] of ROOMS) {
      if (!cache) continue;
      // A building this world goes into (makeRoom's interiors), on its floor.
      // On its floor or on the table br_balls.c lays it on (a wall cell, taken from the
      // cell in front, as a counter's clerk is): turning tables away left five houses in
      // six with nothing (Cam, 10-31: "no items in buildings").
      if (!this.maps.has(map) || this.places.has(map) || this.world.cell(map, x, y) > 1 || out.has(`${map}:${x}:${y}`)) continue;
      // The match keeps its cells off the wild patches (BrBalls_Spot); here the patch has it.
      if (this.patchesOn(map).some((q) => q.x === x && q.y === y)) continue;
      // A table's own roll, so the floors' draws (and all the match deals after them) are
      // what they always were.
      const r = this.world.cell(map, x, y) === 0 ? rng : cellRng(this.seed ^ 0x7ab1e, map, x, y);
      const gold = Math.floor(r() * (house ? 3 : 8)) === 0;
      out.set(`${map}:${x}:${y}`, { key: ++n, map, x, y, item: gold ? GOLD[Math.floor(r() * GOLD.length)] : blueTm(r) });
    }
    // A gift-giver in every town and city (gifts.ts, Cam 2026-10-13: "some gift giving
    // NPCs"): a person holding one held item, standing on a free cell. A at him takes it,
    // and the first trainer there takes it for everybody.
    for (const id of [...land.keys()].sort()) {
      if (!/^MAP_\w+_(TOWN|CITY)$/.test(id)) continue;
      const marked = new Set(this.patchesOn(id).map((q) => `${q.x}:${q.y}`));
      const cells = land.get(id)!.filter((c) => !marked.has(`${c.x}:${c.y}`) && !out.has(`${id}:${c.x}:${c.y}`) &&
        !(id === 'MAP_LITTLEROOT_TOWN' && c.x >= 7 && c.x <= 13 && c.y >= 9 && c.y <= 13));
      if (!cells.length) continue;
      const c = cells[Math.floor(rng() * cells.length)];
      out.set(`${id}:${c.x}:${c.y}`, { key: ++n, map: id, x: c.x, y: c.y, item: GIFTS[Math.floor(rng() * GIFTS.length)], gift: true });
    }
    // A relay world makes one room a seed; keep the last few, not every one ever dealt.
    if (DEALS.size >= 8) DEALS.delete(DEALS.keys().next().value!);
    DEALS.set(id, out);
    return (this.dealt = out);
  }

  /** Every cell a trainer can walk to from Littleroot, in the order a walk out finds them. */
  reachable(): readonly Spot[] {
    const id = [...this.maps.keys()].join();
    const hit = REACH.get(id);
    if (hit) return hit;
    const seen = new Set<string>();
    const out: Spot[] = [];
    const start: Spot = { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 };
    const queue = [start];
    seen.add(`${start.map}:${start.x}:${start.y}`);
    while (queue.length) {
      const at = queue.shift()!;
      out.push(at);
      for (let dir = 1; dir <= 4; dir++) {
        const r = this.base(at, dir);
        // Outdoors: what the deals and the ring's centres are drawn from.
        if (!r || !this.places.has(r.to.map)) continue;
        const k = `${r.to.map}:${r.to.x}:${r.to.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push(r.to);
      }
    }
    REACH.set(id, out);
    return out;
  }

  /** The ring this frame (or at `tick`). */
  ring(tick = this.tick): Ring {
    const len = this.ringPhase;
    const round = this.results.round;
    let t = tick - this.epoch;
    const { cx, cy } = this.centre(round);
    // The Safari: phase 0's no-fog, before it.
    if (t < this.opening) return { round, phase: 0, last: false, cx, cy, r: Infinity, next: Infinity, left: this.opening - t, safari: true };
    t -= this.opening;
    // The fog everywhere holds until somebody wins (director.ts stops its ring timer
    // there): it used to lift on a timer and end the match with nobody crowned.
    const phase = Math.min(RING_STEPS.length - 1, Math.floor(t / len));
    const at = (i: number) => RING_STEPS[i];
    const last = phase === RING_STEPS.length - 1;
    return { round, phase, last, cx, cy, r: at(phase), next: last ? undefined : at(phase + 1), left: last ? 0 : len - (t - phase * len) };
  }

  /** The frame this round is over from, for the next to start AFTER_WIN on: its win;
   *  everybody in it out with nobody left standing; or, with nobody in it at all (a world
   *  nobody locked), a whole phase of the fog everywhere. */
  private roundEnd(): number | undefined {
    const r = this.results;
    if (r.wonAt !== undefined) return r.wonAt;
    if (r.entrants.length) return r.fallen.length >= r.entrants.length ? r.fallen[r.fallen.length - 1].at : undefined;
    const end = this.epoch + this.opening + RING_STEPS.length * this.ringPhase;
    return this.tick >= end ? end - AFTER_WIN : undefined;
  }

  /** Frames a phase lasts: RING_PHASE, or shorter for a solo test (`?ring=` seconds). */
  ringPhase = RING_PHASE;
  /** The frame this round started on. */
  epoch = 0;
  /** Frames of Safari each round opens with (SAFARI); 0, none (a test's room). */
  opening = 0;

  private centres = new Map<number, { cx: number; cy: number; far: number; final?: string }>();
  /** A round's centre: a cell a trainer can stand on, from the seed, or one round in four
   *  a final story's place (story.ts's FINAL_CHANCE: SKY PILLAR), which then holds that
   *  story for the last event; and how far the farthest reachable cell is from it. */
  centre(round: number): { cx: number; cy: number; far: number; final?: string } {
    const hit = this.centres.get(round);
    if (hit) return hit;
    const cells = this.reachable();
    let h = Math.imul((this.seed ^ 0x51ed270b) >>> 0, 0x9e3779b1) ^ Math.imul(round + 1, 0x85ebca6b);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    const c = cells[(h >>> 0) % cells.length];
    const p = this.places.get(c.map)!;
    let cx = p.gx + c.x + 0.5, cy = p.gy + c.y + 0.5;
    // Only a final story whose place the walking trainers can stand near: a ring shut on
    // open sea (SKY PILLAR's, while the deal is the mainland's) would fog every one of them.
    const near = (x: number, y: number) => cells.some((s) => { const q = this.places.get(s.map)!; return Math.hypot(q.gx + s.x + 0.5 - x, q.gy + s.y + 0.5 - y) <= FINAL_REACH; });
    const at = (s: Story) => { const q = this.places.get(s.map), a = this.anchors.get(s.map); return q ? { x: q.gx + s.cells[0].x + 0.5, y: q.gy + s.cells[0].y + 0.5 } : a ? { x: a.gx, y: a.gy } : undefined; };
    const finals = STORIES.filter((s) => { const p = s.final && this.maps.has(s.map) ? at(s) : undefined; return p && near(p.x, p.y); });
    const story = finals.length && ((h >>> 7) % 1000) / 1000 < FINAL_CHANCE ? finals[((h >>> 17) >>> 0) % finals.length] : undefined;
    if (story) ({ x: cx, y: cy } = at(story)!);
    let far = 0;
    for (const s of cells) {
      const q = this.places.get(s.map)!;
      far = Math.max(far, Math.hypot(q.gx + s.x + 0.5 - cx, q.gy + s.y + 0.5 - cy));
    }
    const out = { cx, cy, far, ...(story ? { final: story.id } : {}) };
    if (this.centres.size > 4) this.centres.clear();
    this.centres.set(round, out);
    return out;
  }

  /** Is this cell in the fog now? */
  inFog(s: Spot, ring = this.ring()): boolean {
    if (ring.r === Infinity) return false;
    if (ring.r < 0) return true;
    // Under the sea, the sea above's cell (DIVE lands you on the same one).
    const p = this.places.get(s.map) ?? this.places.get(this.maps.get(s.map)?.emerge ?? '');
    const inside = p ? undefined : this.anchors.get(s.map);
    if (!p && !inside) return true;
    const x = p ? p.gx + s.x + 0.5 : inside!.gx, y = p ? p.gy + s.y + 0.5 : inside!.gy;
    return Math.hypot(x - ring.cx, y - ring.cy) > ring.r;
  }

  /** The item ball still lying on a cell, if any. */
  groundAt(map: string, x: number, y: number): Ground | undefined {
    const g = this.ground().get(`${map}:${x}:${y}`);
    return g && !this.picked.has(g.key) ? g : undefined;
  }

  /** A free cell beside a trainer, facing first, then round: walkable for them, not a
   *  door, a ledge, a ball or a bag, nor one of `used`. */
  private beside(a: Actor, used = new Set<string>()): Spot | undefined {
    const step = this.stepFor(a);
    return [a.m.facing, 1, 2, 3, 4].map((d) => step(a.m.spot, d)).find((r) => r && !r.warp && !r.hop
      && !this.world.warpAt(r.to.map, r.to.x, r.to.y) && !used.has(`${r.to.map}:${r.to.x}:${r.to.y}`)
      && !this.spillAt(r.to.map, r.to.x, r.to.y) && !this.groundAt(r.to.map, r.to.x, r.to.y))?.to;
  }

  /** Where a fallen trainer's bag lies: where they stood, but never on a doormat or a
   *  door (the cell they stand on just through one), which a solid bag would shut. */
  private fallen(a: Actor): Spot {
    const s = a.m.spot;
    return this.world.warpAt(s.map, s.x, s.y) ? this.beside(a) ?? s : s;
  }

  /** The bag lying on a cell, if any. */
  spillAt(map: string, x: number, y: number): Spill | undefined {
    for (const b of this.spills.values()) if (b.map === map && b.x === x && b.y === y && !this.picked.has(b.key)) return b;
    return undefined;
  }

  patchesOn(mapId: string): Patch[] {
    const m = this.maps.get(mapId);
    return m ? dealPatches(this.patches, m.id, m, this.seed) : [];
  }

  /** One frame, everybody in id order. A bot moves once, on its keys. A trainer moves
   *  once for each of its phone's inputs this frame used (`ins`): none while they are
   *  late, two while it catches up. So a trainer's walk is its thumb's, input for input,
   *  however the network bunched them -- the phone's own replay of the same inputs lands
   *  on the same tile (net.ts). */
  step(ins?: ReadonlyMap<number, readonly number[]>): RoomEvent[] {
    this.tick += 1;
    const ring = this.ring();
    // The round's first frame has no frame before it in the round.
    const was = this.tick - 1 >= this.epoch ? this.ring(this.tick - 1) : { ...ring, phase: -1 };
    const r = this.results;
    const end = this.roundEnd();
    if (end !== undefined && this.tick >= end + AFTER_WIN) this.newRound(r.round + 1);
    // The Safari is over: the bots drop at once, anywhere (they have no fly map).
    else if (was.safari && !ring.safari) {
      for (const a of this.actors) if (a.bot && a.m.spot.map.startsWith(SAFARI)) this.dropOne(a);
    }
    else if (ring.phase !== was.phase) {
      // ISLAND CAVE's wall opens by itself once the ring has moved on a phase (br_story.c).
      for (const e of this.events) if (e.story && DOORS[e.story] === 'wait' && ring.phase > (e.phase ?? 0)) e.opened = true;
      // The fog closes for the first time: who is on the map is the match.
      if (ring.phase === 1 && !r.entrants.length) r.entrants = this.actors.map((a) => [a.id, a.name]);
      const n = eventForRing(ring.phase);
      if (n !== undefined) this.dropEvent(n, ring);
    }
    if (!ring.safari && this.opening) this.waitPicks();
    // The last one standing, once the frame's goings are all in (the last two out on one
    // frame: neither).
    if (!r.winner && r.entrants.length >= 2) {
      const alive = r.entrants.filter(([id]) => !r.fallen.some((f) => f.id === id));
      if (alive.length === 1) { r.winner = alive[0][0]; r.wonAt = this.tick; }
    }
    // The fog bites a bot standing in it (not in a fight: the fog leaves those alone)
    // every BOT_BITE frames from when it walked in; out of it, the clock stops but the
    // bites stay. Time to walk out, which a bot on its way does (bots.ts).
    // A test's fog quicker than any room's (FOG 30 s at the least) bites as much quicker.
    const bite = Math.max(1, Math.min(BOT_BITE, Math.round(this.ringPhase / (30 * 60) * BOT_BITE)));
    for (const a of [...this.actors]) {
      if (!a.bot) continue;
      if (a.battling || !this.inFog(a.m.spot, ring)) { a.bleedAt = undefined; continue; }
      a.bleedAt ??= this.tick + bite;
      if (this.tick < a.bleedAt) continue;
      a.bleedAt += bite;
      a.bites = (a.bites ?? 0) + 1;
      if (a.bites >= BOT_BITES) this.botOut(a, '');
    }
    // A bot sees to its wounds (#222's wear), here and not in bots.ts, which only the host
    // runs: every copy of the room heals it on the same frame. On a CENTER's doorstep it
    // has been in, the whole team back (brain.ts healHere); out of the fog, every
    // QUAFF_FRAMES it may drink the weakest medicine it carries onto its worst-hurt mon
    // under 60% (tryQuaff, bag.ts quaff).
    for (const a of this.actors) {
      if (!a.bot || a.battling || !a.wear) continue;
      if (this.centreSteps().some((s) => s.map === a.m.spot.map && s.x === a.m.spot.x && s.y === a.m.spot.y)) { a.wear = undefined; continue; }
      if (!a.loot?.items.length || (this.tick + a.id * 13) % QUAFF_FRAMES !== 0 || this.inFog(a.m.spot, ring)) continue;
      const party = wornParty(dealParty(this.seed, a.id, ring.phase + 1, a.m.spot.map, gradeOf(this.seed, a.id)), a.wear);
      if (quaff(party, a.loot.items) !== null) a.wear = party.map((m) => (m.maxHp > 0 ? m.hp / m.maxHp : 0));
    }
    const phase = this.phaseAt(this.tick);
    for (const [key, at] of this.taken) if (this.phaseAt(at) !== phase) this.taken.delete(key);
    const events: RoomEvent[] = [];
    for (const a of this.actors) {
      if (a.bot) this.move(a, a.keys, events);
      else for (const bits of ins?.get(a.id) ?? []) this.move(a, bits, events);
    }
    this.approach(events);
    this.engage(events);
    for (const a of this.actors) if (a.judge && this.tick - (a.since ?? 0) > BOT_DUEL_MAX) this.part(a);
    this.engageBots(events);
    return events;
  }

  /** Event `n` (every other ring from the first shrink, DESIGN §Events): its legendary,
   *  two rares at the phase's rung, three gold balls and a bag of supplies, on the free
   *  cells nearest a spot inside the ring -- the last one at the ring's centre, the one
   *  place its final ring still holds. Whoever gets there takes it. */
  private dropEvent(n: number, ring: Ring): void {
    let state = (this.seed ^ Math.imul(ring.round + 1, 0x9e3779b1) ^ Math.imul(n + 1, 0x85ebca6b)) >>> 0 || 1;
    const rng = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const free = (s: Spot) => this.world.cell(s.map, s.x, s.y) === 0 && !this.world.warpAt(s.map, s.x, s.y)
      && !this.groundAt(s.map, s.x, s.y) && !this.spillAt(s.map, s.x, s.y)
      && !this.actors.some((a) => a.m.spot.map === s.map && a.m.spot.x === s.x && a.m.spot.y === s.y);
    const all = this.reachable().filter(free);
    const plane = (s: Spot) => { const p = this.places.get(s.map)!; return Math.hypot(p.gx + s.x + 0.5 - ring.cx, p.gy + s.y + 0.5 - ring.cy); };
    // The last event is the final ring's: its story, when the ring is centred on one.
    const final = n === EVENT_MAX - 1 ? STORIES.find((s) => s.id === this.centre(ring.round).final) : undefined;
    if (final && !this.events.some((e) => e.story === final.id)) return this.tellStory(n, ring, final, rng);
    const story = n < EVENT_MAX - 1 && rng() < STORY_CHANCE ? this.storyFor(rng, ring) : undefined;
    if (story) return this.tellStory(n, ring, story, rng);
    let from: Spot | undefined;
    if (n === EVENT_MAX - 1) for (const s of all) { if (!from || plane(s) < plane(from)) from = s; }
    else {
      const inside = all.filter((s) => !this.inFog(s, ring));
      from = inside[Math.min(inside.length - 1, Math.floor(rng() * inside.length))];
    }
    if (!from) return;
    const f = from;
    const d = (s: Spot) => Math.abs(s.x - f.x) + Math.abs(s.y - f.y);
    // Within eight, never on the legendary's four sides (events.ts's clusterCells).
    const cells = all.filter((s) => s.map === f.map && d(s) <= 8 && d(s) !== 1)
      .sort((p, q) => d(p) - d(q) || p.y - q.y || p.x - q.x).slice(0, 1 + EVENT_RARES + EVENT_GOLD + 2);
    const level = rungForPhase(ring.phase + 1);
    const legends = LEGENDS[Math.min(n, LEGENDS.length - 1)];
    const species = [legends[Math.min(legends.length - 1, Math.floor(rng() * legends.length))], ...draw(rng, RARES, EVENT_RARES)];
    const bags = [...draw(rng, GOLD, EVENT_GOLD).map((id) => [{ id, n: 1 }]), SUPPLIES.map((r) => ({ ...r }))];
    // The cell past the pieces is the trader's, with a rare the event did not drop.
    const spot = cells.length > species.length + bags.length ? cells.pop()! : undefined;
    const offers = RARES.filter((r) => !species.includes(r));
    const trader = spot && offers.length ? { x: spot.x, y: spot.y, species: offers[Math.min(offers.length - 1, Math.floor(rng() * offers.length))], busy: 0 } : undefined;
    cells.forEach((c, i) => {
      const key = eventPiece(n, i);
      const bag: Bag = i < species.length ? { items: [], money: 0, mons: [{ species: species[i], level }] } : { items: bags[i - species.length], money: 0 };
      this.spills.set(key, { key, map: c.map, x: c.x, y: c.y, name: '', bag, ...(i === 0 ? { legend: true } : {}) });
    });
    this.events.push({ n, key: eventPiece(n, 0), map: f.map, x: f.x, y: f.y, species: species[0], ...(trader ? { trader } : {}) });
  }

  /** A story event this round has not had (story.ts), where Emerald set that beat, inside
   *  the ring. The ones the page can tell: a place and its reward, or a person handing it
   *  over, a REGI behind its wall, a gate's boss to beat first, or an island the ferry
   *  sails to; not the final ring's. */
  private storyFor(rng: () => number, ring: Ring): Story | undefined {
    const open = STORIES.filter((s) => (s.people ?? []).every((p) => PERSON_GFX[p.gfx] && (!p.trainer || GATES.includes(p.trainer))) && (!s.boat || DOCKS[s.id]) && !s.final && !s.noBots &&
      !this.events.some((e) => e.story === s.id) &&
      s.cells.every((c) => this.maps.has(c.map ?? s.map) && this.world.cell(c.map ?? s.map, c.x, c.y) === 0) &&
      !this.inFog({ map: s.map, x: s.cells[0].x, y: s.cells[0].y }, ring));
    return open.length ? open[Math.floor(rng() * open.length)] : undefined;
  }

  /** The story's pieces on its own cells (story.ts's storyDrop): its mons at the phase's
   *  rung, its rares, its items, the supplies, and the trader past them. */
  private tellStory(n: number, ring: Ring, story: Story, rng: () => number): void {
    const level = rungForPhase(ring.phase + 1);
    const species = [...(story.mons ?? []).map((pick) => pick[Math.floor(rng() * pick.length)]), ...draw(rng, RARES, story.rares ?? 0)];
    const bags = [...(story.items ?? []).map((pick) => [{ id: pick[Math.floor(rng() * pick.length)], n: 1 }]), SUPPLIES.map((r) => ({ ...r }))];
    const cells = story.cells.map((c) => ({ map: c.map ?? story.map, x: c.x, y: c.y }));
    const pieces = species.length + bags.length;
    const offers = RARES.filter((r) => !species.includes(r));
    const spot = cells.length > pieces && offers.length ? cells[pieces] : undefined;
    cells.slice(0, pieces).forEach((c, i) => {
      const key = eventPiece(n, i);
      const bag: Bag = i < species.length ? { items: [], money: 0, mons: [{ species: species[i], level }] } : { items: bags[i - species.length], money: 0 };
      const p = story.people?.find((q) => q.at === i);
      const [gfx, name] = p ? PERSON_GFX[p.gfx] : [0, ''];
      const gate = p?.trainer ? GATES.indexOf(p.trainer) : -1;
      const person = p ? { gfx, name, ...(p.wants ? { wants: p.wants } : {}), ...(gate >= 0 ? { gate } : {}) } : undefined;
      // The rest of a gate's story waits on his piece (br_story.c's GuardOf).
      const boss = story.people?.find((q) => q.trainer);
      const guard = boss && boss.at !== i ? eventPiece(n, boss.at) : undefined;
      this.spills.set(key, { key, map: c.map, x: c.x, y: c.y, name: '', bag, ...(person ? { person } : {}), ...(guard !== undefined ? { guard } : {}) });
    });
    const trader = spot ? { x: spot.x, y: spot.y, species: offers[Math.floor(rng() * offers.length)], busy: 0 } : undefined;
    const legend = species.some((sp) => LEGENDS.flat().includes(sp));
    // A legendary a gate's boss holds is his to hand over, not a battle of its own.
    if (legend) { const b = this.spills.get(eventPiece(n, 0)); if (b && !b.person) b.legend = true; }
    this.events.push({ n, key: eventPiece(n, 0), map: cells[0].map, x: cells[0].x, y: cells[0].y, species: legend ? species[0] : 0, story: story.id, place: story.name, ...(trader ? { trader } : {}), ...(story.door ? { phase: ring.phase, opened: false } : {}) });
  }

  /** Out of a walk-up whose battle never started: walking again after the grace. */
  private unmeet(a: Actor): void {
    a.meet = undefined;
    a.battling = false;
    a.foe = 0;
    a.calm = this.tick + GRACE;
  }

  /** A bot out of its bot-vs-bot fight, answered or not: walking again after the grace. */
  private part(a: Actor): void {
    a.battling = false;
    a.foe = a.judge = a.since = 0;
    a.calm = this.tick + GRACE;
  }

  /** Two bots on one map in each other's eyeline fight (POK-238), one pair at a time
   *  room-wide (BOT_DUEL_GAP). A bot has no ROM, so a trainer's page fights it in a
   *  hidden one: the trainers take turns at it, by the frame. Nobody on the map to do it,
   *  nobody fights. */
  private engageBots(events: RoomEvent[]): void {
    if (this.ring().safari) return;
    if (this.tick < this.duelAfter || this.tick % 8) return;
    // A page that can run it now: not reloading, not in a battle of its own (its ROM is
    // busy); or one on the bench, out and watching (or in for the next match), which is
    // still here: a phone that goes leaves the bench too. Otherwise, once the last trainer
    // was out, the bots only ever bled out in the fog and nobody was crowned.
    const judges = [...this.actors.filter((a) => !a.bot && !a.away && !a.battling), ...this.bench.filter((b) => !b.away)];
    if (!judges.length) return;
    const byMap = new Map<string, Actor[]>();
    for (const a of this.actors) {
      if (!a.bot || a.battling || a.m.action || this.tick < a.calm) continue;
      const l = byMap.get(a.m.spot.map) ?? [];
      l.push(a);
      byMap.set(a.m.spot.map, l);
    }
    const look = (o: Actor) => ({ map: o.m.spot.map, x: o.m.spot.x, y: o.m.spot.y, dir: o.m.facing as Facing });
    for (const id of [...byMap.keys()].sort()) {
      const l = byMap.get(id)!;
      for (let i = 0; i < l.length; i++) {
        for (let j = i + 1; j < l.length; j++) {
          const a = l[i], b = l[j];
          if (!eitherSees(this.world, look(a), look(b))) continue;
          const dx = b.m.spot.x - a.m.spot.x, dy = b.m.spot.y - a.m.spot.y;
          const toB = dx > 0 ? 4 : dx < 0 ? 3 : dy > 0 ? 1 : 2;
          a.m.facing = a.m.moveDir = toB;
          b.m.facing = b.m.moveDir = BACK[toB];
          const judge = judges[(this.tick >>> 3) % judges.length];
          a.battling = b.battling = true;
          a.foe = b.id;
          b.foe = a.id;
          a.judge = b.judge = judge.id;
          a.since = b.since = this.tick;
          a.keys = a.last = b.keys = b.last = 0;
          this.duelAfter = this.tick + BOT_DUEL_GAP;
          events.push({ type: 'bots', tick: this.tick, id: judge.id, a: a.id, b: b.id });
          return;
        }
      }
    }
  }

  /** `id` off the map, and everything that waited on them let go. */
  private remove(id: number): void {
    const a = this.actor(id);
    // A trainer they were fighting is still in that battle: their page ends it (their
    // ROM wins it, BrNetlink_PeerOut) and says so.
    const foe = a?.foe ? this.actor(a.foe) : undefined;
    if (foe?.bot) foe.battling = false;
    // Whoever they were meeting (the "!" or the walk-up): no battle is coming, so free.
    for (const o of this.actors) if (o.meet?.foe === id) this.unmeet(o);
    // Bots whose fight their page was running: no answer is coming, they walk on.
    for (const o of this.actors) if (o.bot && o.judge === id) this.part(o);
    // A legendary they were fighting stands again (Cam: they go back for retries).
    // So does a gate's boss whose fight they left: his pieces wait for the next.
    for (const [key, by] of this.picked) {
      const b = this.spills.get(key);
      if (by === id && (b?.legend || b?.person?.gate !== undefined)) this.picked.delete(key);
    }
    for (const e of this.events) if (e.trader?.busy === id) e.trader.busy = 0;
    for (const h of this.homes) if (h.busy === id) h.busy = 0;
    this.actors = this.actors.filter((o) => o.id !== id);
  }

  /** A bot is beaten (by `by`, '' the fog): out of the match and off the map, its team and
   *  purse in a bag where it stood, as the live bots' eliminate() drops theirs. */
  private botOut(a: Actor, by: string): void {
    if (!this.actor(a.id)) return;
    const phase = this.ring().phase + 1;
    const grade = gradeOf(this.seed, a.id);
    const party = dealParty(this.seed, a.id, phase, a.m.spot.map, grade);
    // And whatever it picked up on its way (bots carry what they pick up, POK-322).
    const bag: Bag = { items: carried(party, a.loot?.items ?? []), money: purse(phase, grade) + (a.loot?.money ?? 0), mons: party.map((m) => ({ species: m.species, level: m.level })) };
    const key = SPILL_KEY + a.id, at = this.fallen(a);
    if (!emptyBag(bag)) this.spills.set(key, { key, map: at.map, x: at.x, y: at.y, name: a.name, bag });
    this.fall(a, by);
    this.remove(a.id);
  }

  /** `a` is out of this round's match (once; nothing after the win). */
  private fall(a: Actor, by: string, how: { wild?: boolean; left?: boolean } = {}): void {
    const r = this.results;
    if (r.winner || !r.entrants.some(([id]) => id === a.id) || r.fallen.some((f) => f.id === a.id)) return;
    r.fallen.push({ id: a.id, name: a.name, by, ...how, ...(a.bot ? { bot: true } : {}), at: this.tick });
  }

  /** The cells by the truck that no bot stands on: along its row first, nearest first, so
   *  trainers stood side by side facing south do not see each other (and fight the moment
   *  their grace is up). */
  truck(id = 0): Spot[] {
    if (this.ring().safari) return this.zone(id);
    const d = (s: Spot) => Math.abs(s.y - 10) * 64 + Math.abs(s.x - 10) * 2 + (s.x < 10 ? 1 : 0);
    const near = this.reachable().filter((s) => s.map === 'MAP_LITTLEROOT_TOWN').sort((p, q) => d(p) - d(q)).slice(0, TRUCK);
    return near.filter((s) => !this.actors.some((a) => a.bot && a.m.spot.map === s.map && a.m.spot.x === s.x && a.m.spot.y === s.y));
  }

  /** Where trainer `id` stands when the Safari opens: its own of the Zone's twenty-four
   *  cells, dealt from the seed and the seat as br_match.c's BrMatch_SafariCell deals the
   *  live one, so every run starts somewhere else; then the free cells nearest it. */
  zone(id: number): Spot[] {
    let h = Math.imul(this.seed ^ Math.imul(id + 1, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    const c = SAFARI_CELLS[(h >>> 0) % SAFARI_CELLS.length];
    // Nobody within two steps, while there is room: a crowd dealt one cell starts apart.
    const near = (s: Spot, r: number) => this.actors.some((a) => a.m.spot.map === s.map && Math.abs(a.m.spot.x - s.x) <= r && Math.abs(a.m.spot.y - s.y) <= r);
    const d = (s: Spot) => (s.map === c.map ? 0 : 1 << 16) + Math.abs(s.x - c.x) + Math.abs(s.y - c.y);
    const free = this.safariCells().filter((s) => !near(s, 0)).sort((p, q) => d(p) - d(q));
    return [...free.filter((s) => !near(s, 2)), ...free.filter((s) => near(s, 2))].slice(0, 8);
  }

  private safariCells(): readonly Spot[] {
    const id = 'safari:' + [...this.maps.keys()].join();
    const hit = REACH.get(id);
    if (hit) return hit;
    const start = { map: 'MAP_SAFARI_ZONE_SOUTH', x: 32, y: 34 };
    const seen = new Set<string>([`${start.map}:${start.x}:${start.y}`]);
    const out: Spot[] = [];
    const queue: Spot[] = this.maps.has(start.map) ? [start] : [];
    while (queue.length) {
      const at = queue.shift()!;
      out.push(at);
      for (let dir = 1; dir <= 4; dir++) {
        const r = this.base(at, dir as Facing);
        if (!r || !r.to.map.startsWith(SAFARI) || !this.maps.has(r.to.map) || this.world.cell(r.to.map, r.to.x, r.to.y) !== 0) continue;
        const k = `${r.to.map}:${r.to.x}:${r.to.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push(r.to);
      }
    }
    REACH.set(id, out);
    return out;
  }

  /** Cells a drop may land on: outdoors, from which one can walk to a stretch of ground
   *  where every cell reaches every other, LANDING cells or more (a strongly connected
   *  component of the step graph: ledges go one way). A pocket walled in by water or rock
   *  (the bank behind the ABANDONED SHIP), or one a ledge drops into with no way back to
   *  open ground, is no place to be dropped without SURF. */
  landing(): ReadonlySet<string> {
    const id = 'landing:' + [...this.maps.keys()].join();
    const hit = LANDS.get(id);
    if (hit) return hit;
    // The graph: every outdoor cell a step reaches, numbered, with its steps out.
    const index = new Map<string, number>(), spots: Spot[] = [], next: number[][] = [];
    // A bridge cell is two places (Spot.z); a drop lands with none, which is either.
    const node = (s: Spot) => {
      const k = `${s.map}:${s.x}:${s.y}:${s.z ?? ''}`;
      let n = index.get(k);
      if (n === undefined) { n = spots.length; index.set(k, n); spots.push(s); next.push([]); }
      return n;
    };
    for (const map of this.places.keys()) {
      if (map.startsWith(SAFARI)) continue;
      const m = this.maps.get(map)!;
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (this.world.cell(map, x, y) === 0) node({ map, x, y });
    }
    for (let n = 0; n < spots.length; n++) {
      for (let dir = 1; dir <= 4; dir++) {
        const r = this.base(spots[n], dir as Facing);
        if (r && this.places.has(r.to.map) && !r.to.map.startsWith(SAFARI)) next[n].push(node(r.to));
      }
    }
    // Tarjan's components, without recursion (23k cells).
    const N = spots.length, order = new Int32Array(N).fill(-1), low = new Int32Array(N), comp = new Int32Array(N).fill(-1);
    const stack: number[] = [], onStack = new Uint8Array(N), sizes: number[] = [];
    let time = 0;
    for (let root = 0; root < N; root++) {
      if (order[root] >= 0) continue;
      const work: [number, number][] = [[root, 0]];
      order[root] = low[root] = time++; stack.push(root); onStack[root] = 1;
      while (work.length) {
        const top = work[work.length - 1], v = top[0];
        if (top[1] < next[v].length) {
          const w = next[v][top[1]++];
          if (order[w] < 0) { order[w] = low[w] = time++; stack.push(w); onStack[w] = 1; work.push([w, 0]); }
          else if (onStack[w]) low[v] = Math.min(low[v], order[w]);
          continue;
        }
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
        if (low[v] === order[v]) {
          const c = sizes.length;
          let size = 0, w: number;
          do { w = stack.pop()!; onStack[w] = 0; comp[w] = c; size++; } while (w !== v);
          sizes.push(size);
        }
      }
    }
    // Back from every cell of a big component: whoever can walk to one.
    const prev: number[][] = spots.map(() => []);
    for (let v = 0; v < N; v++) for (const w of next[v]) prev[w].push(v);
    const ok = new Uint8Array(N), queue: number[] = [];
    for (let v = 0; v < N; v++) if (sizes[comp[v]] >= LANDING) { ok[v] = 1; queue.push(v); }
    while (queue.length) for (const u of prev[queue.pop()!]) if (!ok[u]) { ok[u] = 1; queue.push(u); }
    const out = new Set<string>();
    const open: Spot[] = [];
    for (let v = 0; v < N; v++) {
      const s = spots[v];
      if (ok[v] && s.z === undefined && this.world.cell(s.map, s.x, s.y) === 0) out.add(`${s.map}:${s.x}:${s.y}`);
      if (sizes[comp[v]] >= LANDING && s.z === undefined) open.push(s);
    }
    LANDS.set(id, out);
    OPENS.set(id, open);
    return out;
  }

  /** Outdoor cells inside a big stretch of ground (landing's components): every one of
   *  them walks to every other, so nothing put there is behind a ledge that only goes one
   *  way, or on a pocket only SURF reaches -- and they cover all of Hoenn, not the part of
   *  it walkable from Littleroot. */
  open(): readonly Spot[] {
    const id = 'landing:' + [...this.maps.keys()].join();
    if (!OPENS.has(id)) { LANDS.delete(id); this.landing(); }
    return OPENS.get(id)!;
  }

  /** The fly map's time (PICK_WAIT after the Safari, or after a battle fought in the
   *  Zone since): whoever is still there, having chosen nowhere, drops anywhere outdoors
   *  (br_pick.c's timeout). */
  private waitPicks(): void {
    for (const a of this.actors) {
      if (a.bot || !a.m.spot.map.startsWith(SAFARI)) continue;
      if (a.battling) a.pickBy = this.tick + PICK_WAIT;
      else if (this.tick >= (a.pickBy ?? this.epoch + this.opening + PICK_WAIT)) this.dropOne(a);
    }
  }

  /** `a` out of the Zone onto a free cell of `want` (or of any outdoor map), dealt from
   *  the seed, the round and who it is, as the host deals the live drop's cell. */
  private dropOne(a: Actor, want?: string): void {
    let state = (this.seed ^ Math.imul(this.results.round + 1, 0x2545f491) ^ Math.imul(a.id + 1, 0x9e3779b1) ^ this.tick) >>> 0 || 1;
    const rng = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const used = new Set(this.actors.map((o) => `${o.m.spot.map}:${o.m.spot.x}:${o.m.spot.y}`));
    // A bot only where a trainer could walk to it: it has no SURF, and one dropped on an
    // island or into a pocket could never be met nor walk into the ring (a trainer may
    // land anywhere, islands too: Cam, 2026-10-20).
    const reach = a.bot ? new Set(this.reachable().map((s) => `${s.map}:${s.x}:${s.y}`)) : null;
    // A trainer only on ground joined to LANDING cells (Room.landing): no walled-in pocket.
    const land = this.landing();
    let landed = LANDED.get(land);
    if (!landed) LANDED.set(land, landed = new Set([...land].map((k) => k.slice(0, k.indexOf(':')))));
    const maps = [...new Set(reach ? this.reachable().map((s) => s.map) : this.places.keys())].filter((m) => !m.startsWith(SAFARI) && landed.has(m)).sort();
    for (let tries = 0; tries < 4; tries++) {
      const map = tries === 0 && want ? want : maps[Math.floor(rng() * maps.length)];
      const m = this.maps.get(map);
      if (!m) continue;
      const cells: Spot[] = [];
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        if (this.world.cell(map, x, y) !== 0 || !land.has(`${map}:${x}:${y}`) || used.has(`${map}:${x}:${y}`) || this.groundAt(map, x, y) || this.spillAt(map, x, y)) continue;
        if (reach && !reach.has(`${map}:${x}:${y}`)) continue;
        if (this.patchesOn(map).some((q) => q.x === x && q.y === y)) continue;
        cells.push({ map, x, y });
      }
      if (!cells.length) continue;
      a.m = newMover(cells[Math.floor(rng() * cells.length)], 1);
      a.calm = this.tick + JOIN_GRACE;
      a.pickBy = undefined;
      return;
    }
  }

  /** The fog lifted: a new match. Every trainer, out or in, back at the truck with the
   *  join's grace; the balls, spots and bags back as dealt; the bots to be fought again. */
  private newRound(round: number): void {
    const humans: Actor[] = [];
    for (const a of this.actors) if (!a.bot) humans.push(a);
    for (const b of this.bench) {
      humans.push({ id: b.id, bot: false, name: b.name, skin: b.skin, m: newMover({ map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, 1), keys: 0, last: 0, battling: false, foe: 0, calm: 0, shun: 0, shunUntil: 0, arriving: false });
    }
    humans.sort((p, q) => p.id - q.id);
    this.bench = [];
    // The new round's clock first: it opens in the Safari (truck()).
    this.results = { round, entrants: [], fallen: [], winner: 0 };
    this.epoch = this.tick;
    const safari = this.ring().safari;
    const spots = safari ? [] : this.truck();
    humans.forEach((a, i) => {
      // Somebody still in a battle of the round before ends it where they now stand.
      a.m = newMover(safari ? this.zone(a.id)[0] ?? a.m.spot : spots[i % spots.length], 1);
      a.calm = this.tick + JOIN_GRACE;
      a.shun = a.shunUntil = 0;
      a.arriving = false;
      a.pickBy = undefined;
    });
    this.actors = [...this.actors.filter((a) => a.bot), ...humans];
    this.actors.sort((p, q) => p.id - q.id);
    // A bot's pickings were the old round's, as are `picked` and the spills cleared below.
    for (const a of this.actors) if (a.bot) { a.bites = 0; a.bleedAt = undefined; a.loot = undefined; if (a.judge) this.part(a); }
    // The bots open in the Zone with everybody, as the live host deals them (bots/host.ts).
    if (safari) for (const a of this.actors) if (a.bot) a.m = newMover(this.zone(a.id)[0] ?? a.m.spot, a.m.facing);
    // A walk-up the old round left half done starts no battle in this one.
    for (const a of this.actors) if (a.meet) { a.meet = undefined; a.battling = false; a.foe = 0; }
    this.duelAfter = 0;
    this.events = [];
    this.gyms = [];
    this.homes = this.dealHomes(round);
    this.taken.clear();
    this.picked.clear();
    this.spills.clear();
    this.placeChest(round);
  }

  /** The DAY CARE's chest for round `round` (br_zone.c BrZone_PlaceChest): one POKeMON off
   *  the seed, at level 0 -- the rung the match is at when somebody walks in, which the page
   *  that takes it fills in. */
  private placeChest(round: number): void {
    if (!this.maps.has(CHEST.map)) return;
    let h = Math.imul(this.seed ^ Math.imul(round + 1, 0x2545f491) ^ 0x06d0, 0x85ebca6b);
    h ^= h >>> 13;
    const species = CHEST_SPECIES[(h >>> 0) % CHEST_SPECIES.length];
    this.spills.set(CHEST_KEY, { key: CHEST_KEY, map: CHEST.map, x: CHEST.x, y: CHEST.y, name: 'DAY CARE', bag: { items: [], money: 0, mons: [{ species, level: 0 }] } });
  }

  /** The walk-ups under way: after the "!", the walker steps the eyeline toward the
   *  other, and beside them (or out of time, or the other gone) the fight starts. */
  private approach(events: RoomEvent[]): void {
    for (const w of this.actors) {
      const m = w.meet;
      if (!m || !m.walk) continue;
      const o = this.actor(m.foe);
      // The other is gone (left, out): no fight, and the walker walks on.
      if (!o || o.meet?.foe !== w.id) { w.meet = undefined; w.battling = false; w.foe = 0; continue; }
      if (this.tick - m.since < WALKUP_BANG) continue;
      const dx = o.m.spot.x - w.m.spot.x, dy = o.m.spot.y - w.m.spot.y;
      const beside = o.m.spot.map === w.m.spot.map && Math.abs(dx) + Math.abs(dy) <= 1;
      if (w.m.action) { tick(w.m, keysOf(0), this.stepFor(w)); continue; }
      if (!beside && this.tick - m.since < APPROACH_FRAMES) {
        const dir = dx > 0 ? 4 : dx < 0 ? 3 : dy > 0 ? 1 : 2;
        const before = w.m.strides;
        tick(w.m, keysOf(KEY_TO[dir]), this.stepFor(w));
        if (w.m.strides !== before || w.m.action) continue;
      }
      // Face to face, and the fight: the trainer who looked first is the challenger.
      const toO = dx > 0 ? 4 : dx < 0 ? 3 : dy > 0 ? 1 : 2;
      if (dx || dy) { w.m.facing = w.m.moveDir = toO; o.m.facing = o.m.moveDir = BACK[toO]; }
      w.meet = o.meet = undefined;
      const [h, f] = w.bot ? [o, w] : o.bot ? [w, o] : w.id < o.id ? [w, o] : [o, w];
      if (m.duel) {
        events.push({ type: 'duel', tick: this.tick, id: h.id, foe: f.id, first: true });
        events.push({ type: 'duel', tick: this.tick, id: f.id, foe: h.id, first: false });
      } else { f.foughtBy = h.id; events.push({ type: 'fight', tick: this.tick, id: h.id, foe: f.id }); }
    }
  }

  /** Two trainers on one map who see each other fight (br_engage.c's BrEngage_Tick): the
   *  eyeline both ways, BR_SIGHT_RANGE cells, stopped by collision (bots/sight.ts). Only
   *  trainers standing still, neither in a fight nor in its grace. They turn to face each
   *  other, and the lower id is the side that challenged. */
  private engage(events: RoomEvent[]): void {
    if (this.ring().safari) return; // the Safari is for catching
    // Nor whoever is still in the Zone after it, on the fly map.
    const free = this.actors.filter((a) => !a.bot && !a.away && !a.battling && !a.m.action && this.tick >= a.calm && !a.m.spot.map.startsWith(SAFARI));
    for (let i = 0; i < free.length; i++) {
      const a = free[i];
      if (a.battling) continue;
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j];
        if (b.battling || a.m.spot.map !== b.m.spot.map) continue;
        if ((a.shun === b.id && this.tick < a.shunUntil) || (b.shun === a.id && this.tick < b.shunUntil)) continue;
        const look = (o: Actor) => ({ map: o.m.spot.map, x: o.m.spot.x, y: o.m.spot.y, dir: o.m.facing as Facing });
        if (!eitherSees(this.world, look(a), look(b))) continue;
        const dx = b.m.spot.x - a.m.spot.x, dy = b.m.spot.y - a.m.spot.y;
        const toB = dx > 0 ? 4 : dx < 0 ? 3 : dy > 0 ? 1 : 2;
        // Who walks: the one who was facing down the line at the other; both or neither,
        // the challenger (br_walkup.h BR_WALKUP_FIRST).
        const bWalks = b.m.facing === BACK[toB] && a.m.facing !== toB;
        a.m.facing = a.m.moveDir = toB;
        b.m.facing = b.m.moveDir = BACK[toB];
        a.battling = b.battling = true;
        a.foe = b.id;
        b.foe = a.id;
        a.keys = a.last = b.keys = b.last = 0;
        a.meet = { foe: b.id, walk: !bWalks, since: this.tick, duel: true };
        b.meet = { foe: a.id, walk: bWalks, since: this.tick, duel: true };
        break;
      }
    }
    // A bot that sees a trainer (or is seen) walks up to no one: it challenges there and
    // then, as a route trainer does (Bots engage players, DESIGN §10). Not one fighting,
    // mid-step or in its grace; nor one the trainer fled.
    for (const h of free) {
      if (h.battling) continue;
      for (const b of this.actors) {
        if (!b.bot || b.battling || b.m.action || this.tick < b.calm || b.m.spot.map !== h.m.spot.map) continue;
        if (h.shun === b.id && this.tick < h.shunUntil) continue;
        const look = (o: Actor) => ({ map: o.m.spot.map, x: o.m.spot.x, y: o.m.spot.y, dir: o.m.facing as Facing });
        if (!eitherSees(this.world, look(h), look(b))) continue;
        const dx = b.m.spot.x - h.m.spot.x, dy = b.m.spot.y - h.m.spot.y;
        const toB = dx > 0 ? 4 : dx < 0 ? 3 : dy > 0 ? 1 : 2;
        // A bot is a map trainer: it walks when it faced the trainer down the line, and
        // otherwise the trainer looked, so they do (BR_WALKUP_BOT).
        const botWalks = b.m.facing === BACK[toB];
        h.m.facing = h.m.moveDir = toB;
        b.m.facing = b.m.moveDir = BACK[toB];
        h.battling = b.battling = true;
        h.foe = b.id;
        b.foe = h.id;
        h.keys = h.last = b.keys = b.last = 0;
        h.meet = { foe: b.id, walk: !botWalks, since: this.tick, duel: false };
        b.meet = { foe: h.id, walk: botWalks, since: this.tick, duel: false };
        break;
      }
    }
  }

  /** One move of one actor on `bits`: sim.ts's frame, then what it landed on or pressed. */
  private move(a: Actor, bits: number, events: RoomEvent[]): void {
    a.keys = bits;
    if (a.battling) { a.last = bits; return; }
    if (a.bot && !a.m.action) {
      const dir = dirOf(keysOf(bits));
      if (dir) {
        // A townsperson faces its way and walks at once (WanderAround_Step4 sets the
        // direction, no turn in place as the player has); a shut way, or a ledge
        // (wanderers never jump), it only faces.
        a.m.facing = a.m.moveDir = dir;
        const r = this.stepFor(a)(a.m.spot, dir);
        // A bag in its way (a trainer's who went out): it picks it up, as live bots take
        // the loot they come to, and walks on. Not a story's piece, which is a fight.
        if (!r && (bits & KEY_A)) {
          const [x, y] = this.ahead(a);
          const g = this.groundAt(a.m.spot.map, x, y);
          const b = g ? undefined : this.spillAt(a.m.spot.map, x, y);
          const loot = (a.loot ??= { items: [], money: 0 });
          if (g && !g.gift) { this.picked.set(g.key, a.id); add(loot.items, g.item); }
          if (b && !b.legend && !b.person && b.guard === undefined) {
            // Its items and money, as live bots empty a bag (brain.ts takePiece). The
            // Pokémon stay in it for whoever comes next (HBR-82), and the bot steps over it.
            for (const st of b.bag.items) add(loot.items, st.id, st.n);
            loot.money += b.bag.money;
            if (b.bag.mons?.length) b.bag = { items: [], money: 0, mons: b.bag.mons };
            else this.picked.set(b.key, a.id);
          }
        }
        // A, from a bot on its way somewhere (bots.ts): it may jump a ledge, or SURF.
        if (!r || ((r.hop || (r.water && !this.onWater(a))) && !(bits & KEY_A))) { a.last = bits; return; }
      }
    }
    // SELECT facing water, on foot or surfing, casts the rod rather than getting on the
    // bike: a rod comes first there (br_hm.c), and every trainer holds one (br_levels.c).
    if (!a.bot && !a.m.action && !a.m.bike && (bits & KEY_SELECT) && !a.m.sel) {
      const [x, y] = this.ahead(a);
      if (this.world.cell(a.m.spot.map, x, y) === CLASS_WATER) {
        a.m.sel = true;
        a.battling = true;
        a.last = bits;
        events.push({ type: 'fish', tick: this.tick, id: a.id, map: a.m.spot.map, x, y });
        return;
      }
    }
    const before = a.m.strides;
    tick(a.m, keysOf(bits), this.stepFor(a));
    if (a.m.strides !== before) a.arriving = true;
    if (!a.m.action && !a.bot) {
      const c = a.cruise;
      // Aboard: the corridor's ON_FRAME scripts say she has left port, and on the leg the
      // steps count for, the 205th is halfway (or in port) (SSTidalCorridor_EventScript_ReachedStepCount).
      if (c?.leg === 'board') {
        c.leg = 'depart';
        events.push({ type: 'cruise', tick: this.tick, id: a.id, say: 'board', cruise: { ...c } });
      }
      if (a.arriving && c && counting(c) && ++c.steps >= SS_TIDAL_MAX_STEPS) {
        c.leg = c.to === 'lilycove' ? 'halfway' : 'land';
        c.steps = 0;
        events.push({ type: 'cruise', tick: this.tick, id: a.id, say: c.leg, cruise: { ...c } });
      }
      if (a.arriving) {
        a.arriving = false;
        const p = this.patchesOn(a.m.spot.map).find((q) => q.x === a.m.spot.x && q.y === a.m.spot.y && !this.isTaken(q.key));
        if (p) {
          this.taken.set(p.key, this.tick);
          a.battling = true;
          events.push({ type: 'wild', tick: this.tick, id: a.id, map: a.m.spot.map, x: p.x, y: p.y, key: p.key });
        }
      }
      const wall = !a.battling && (bits & KEY_A) && !(a.last & KEY_A) && atWall(a) ? this.events.find((e) => e.map === a.m.spot.map && e.story && DOORS[e.story] && !e.opened) : undefined;
      const ferry = !wall && !a.battling && (bits & KEY_A) && !(a.last & KEY_A) ? ferryAt(a.m.spot.map, ...this.ahead(a)) : undefined;
      const bed = !wall && !ferry && c && !a.battling && (bits & KEY_A) && !(a.last & KEY_A) && bedAt(a.m.spot.map, ...this.ahead(a));
      if (ferry === 'tidal') {
        if (c) events.push({ type: 'cruise', tick: this.tick, id: a.id, say: 'sailor', cruise: { ...c } });
      } else if (bed && c) {
        // The bed in cabin No. 2: a rest heals the team and moves the crossing on.
        c.leg = afterBed(c);
        c.steps = 0;
        events.push({ type: 'cruise', tick: this.tick, id: a.id, say: c.leg === 'halfway' ? 'halfway' : 'land', cruise: { ...c }, bed: true });
      } else if (ferry) {
        const boat = ferry === 'boat' ? boatAt(a.m.spot.map, ...this.ahead(a)) : undefined;
        const to = ferry === 'attendant' ? [port('slateport'), ...this.sailingTo()] : boat ? boat.to.map(port) : [];
        events.push({ type: 'ferry', tick: this.tick, id: a.id, to, ...(ferry === 'sailor' ? { home: true } : {}), ...(boat?.briney ? { briney: true } : {}), ...(boat?.cable ? { cable: boat.cable } : {}) });
      } else if (wall) {
        const how = DOORS[wall.story!];
        // DESERT RUINS': ROCK SMASH's crack, which anybody makes here (br_story.c).
        if (how === 'smash') wall.opened = true;
        events.push({ type: 'door', tick: this.tick, id: a.id, n: wall.n, how, ...(wall.opened ? { opened: true } : {}) });
      } else if (!a.battling && (bits & KEY_A) && !(a.last & KEY_A)) {
        const [x, y] = this.ahead(a);
        const g = this.groundAt(a.m.spot.map, x, y);
        const b = g ? undefined : this.spillAt(a.m.spot.map, x, y);
        const foe = g || b ? undefined : this.facing(a);
        const tr = foe ? undefined : this.traderAt(a.m.spot.map, x, y);
        const boss = foe || tr ? undefined : leaderAt(a.m.spot.map, x, y);
        // Last of A's (ProcessPlayerFieldInput asks the dive after everything ahead).
        const dive = g || b || foe || tr || boss ? undefined : diveTo(this.maps, this.world, a.m.spot, a.field ?? 0);
        if (boss && !this.bossDown(boss.n)) {
          a.battling = true;
          a.boss = boss.n + 1;
          events.push({ type: 'boss', tick: this.tick, id: a.id, n: boss.n });
        } else if (tr && !tr.t.busy) {
          tr.t.busy = a.id;
          a.battling = true;
          events.push({ type: 'trade', tick: this.tick, id: a.id, n: tr.n, species: tr.t.species, ...(tr.t.gives ? { gives: true } : {}) });
        } else if (tr) {
          // Somebody is trading with him: nothing.
        } else if (g) {
          this.picked.set(g.key, a.id);
          events.push({ type: 'item', tick: this.tick, id: a.id, key: g.key, item: g.item, ...(g.gift ? { gift: true } : {}) });
        } else if (b?.guard !== undefined && this.spills.has(b.guard) && !this.picked.has(b.guard)) {
          events.push({ type: 'guarded', tick: this.tick, id: a.id, name: this.spills.get(b.guard)!.person?.name ?? '' });
        } else if (b?.person?.gate !== undefined) {
          // His fight first, in my ROM (BrStory_StartGate); won, his piece is mine.
          this.picked.set(b.key, a.id);
          a.battling = true;
          events.push({ type: 'gate', tick: this.tick, id: a.id, key: b.key, gate: b.person.gate, bag: structuredClone(b.bag), name: b.person.name });
        } else if (b?.legend) {
          const mon = b.bag.mons![0];
          this.picked.set(b.key, a.id);
          a.battling = true;
          events.push({ type: 'legend', tick: this.tick, id: a.id, key: b.key, species: mon.species, level: mon.level });
        } else if (b) {
          this.picked.set(b.key, a.id);
          events.push({ type: 'bag', tick: this.tick, id: a.id, key: b.key, bag: structuredClone(b.bag), name: b.name, ...(b.person ? { person: { ...b.person } } : {}) });
        } else if (foe && foe.bot && !foe.battling && !foe.m.action && !a.m.spot.map.startsWith(SAFARI)) {
          // Not in the Zone, which is for catching (engage's rule; Cam 10-30 fought one there).
          a.battling = foe.battling = true;
          foe.m.facing = foe.m.moveDir = BACK[a.m.facing];
          a.foe = foe.id;
          foe.foughtBy = a.id;
          events.push({ type: 'fight', tick: this.tick, id: a.id, foe: foe.id });
        } else if (!foe && this.clerk(a)) {
          events.push({ type: 'mart', tick: this.tick, id: a.id, map: a.m.spot.map });
        } else if (dive) {
          const down = this.maps.get(a.m.spot.map)?.dive === dive.map;
          a.m = newMover(dive, a.m.facing);
          events.push({ type: 'dive', tick: this.tick, id: a.id, down });
        } else if (!foe && a.m.facing === DIR_NORTH) {
          // The nurse, across the counter (pkmn_center_nurse.inc).
          const c = this.maps.get(a.m.spot.map)?.centre;
          if (c && a.m.spot.x === c.counterX && a.m.spot.y === c.counterY) events.push({ type: 'nurse', tick: this.tick, id: a.id, map: a.m.spot.map });
        }
      }
    } else if (!a.m.action) a.arriving = false;
    a.last = bits;
  }

  /** An event's trader standing on a cell, or somebody at home (not one who gave theirs). */
  traderAt(map: string, x: number, y: number): { n: number; t: Trader & { gives?: boolean } } | undefined {
    for (const e of this.events) if (e.trader && e.map === map && e.trader.x === x && e.trader.y === y) return { n: e.n, t: e.trader };
    for (const h of this.homes) if (!h.gone && h.map === map && h.x === x && h.y === y) return { n: h.n, t: h };
    return undefined;
  }

  private onWater(a: Actor): boolean {
    return this.world.cell(a.m.spot.map, a.m.spot.x, a.m.spot.y) === CLASS_WATER;
  }

  /** The MART clerk `a` talks to: on the cell ahead, or across the counter there. */
  private clerk(a: Actor): Clerk | undefined {
    const [x, y] = this.ahead(a);
    const map = a.m.spot.map;
    return clerkAt(map, x, y) ?? (this.world.cell(map, x, y) === 1 ? clerkAt(map, 2 * x - a.m.spot.x, 2 * y - a.m.spot.y) : undefined);
  }

  /** The cell `a` faces, on its own map. */
  private ahead(a: Actor): [number, number] {
    const d = ({ 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] } as Record<number, number[]>)[a.m.facing];
    return [a.m.spot.x + d[0], a.m.spot.y + d[1]];
  }

  /** The trainer standing on the cell `a` faces. */
  facing(a: Actor): Actor | undefined {
    const [x, y] = this.ahead(a);
    return this.actors.find((o) => o.id !== a.id && o.m.spot.map === a.m.spot.map && o.m.spot.x === x && o.m.spot.y === y);
  }

  /** Where `a` may step: the ROM's rules, a map this room has, no item ball or bag, and nobody
   *  standing there (a step's destination is the trainer's spot from its first frame, so
   *  two can't both walk into one cell). */
  stepFor(a: Actor): StepFn {
    const fn: StepFn = (from, dir) => {
      // A bot can go anywhere a team could (Kanto's bots cross water): a wanderer keeps
      // to land and off ledges all the same (Room.move).
      const bits = a.bot ? 7 : a.field ?? 0;
      const r = bits ? (this.fields[bits] ??= stepFn(this.world, { surf: (bits & FIELD_SURF) !== 0, cut: bits & 3 }))(from, dir) : this.base(from, dir);
      if (!r || !this.maps.has(r.to.map)) return null;
      // A townsperson stays out in the street, or in the Zone's (live's bots wander the
      // Safari's pool through the opening, brain.ts setTargets): no Zone map is a place
      // of the plane, so the Zone's bots stood still (Cam 10-30).
      if (a.bot && !this.places.has(r.to.map) && !r.to.map.startsWith(SAFARI)) return null;
      const t = r.to;
      // A REGI chamber's wall: shut until its story opened it (and in a match without one).
      if (r.warp && DOOR_MAPS.has(from.map) && from.y === DOOR_Y + 1 && t.y < DOOR_Y && !this.events.some((e) => e.map === from.map && e.opened)) return null;
      // A bag a bot has emptied of its items but not of its Pokémon it steps over.
      const bag = this.spillAt(t.map, t.x, t.y);
      if (bag && !(a.bot && !bag.bag.items.length && !bag.bag.money && !bag.legend && !bag.person && bag.guard === undefined)) return null;
      if (this.groundAt(t.map, t.x, t.y) || clerkAt(t.map, t.x, t.y) || this.traderAt(t.map, t.x, t.y) || ferryAt(t.map, t.x, t.y)) return null;
      // The Zone's gate is shut until the drop, both ways.
      if (from.map.startsWith(SAFARI) !== t.map.startsWith(SAFARI) && this.ring().safari) return null;
      const boss = leaderAt(t.map, t.x, t.y);
      if (boss && !this.bossDown(boss.n)) return null;
      if (this.actors.some((o) => o.id !== a.id && o.m.spot.map === t.map && o.m.spot.x === t.x && o.m.spot.y === t.y)) return null;
      return r;
    };
    fn.cycling = !a.bot && !this.ring().safari ? this.base.cycling : undefined;
    return fn;
  }

  /** A short fingerprint of the room: two machines that disagree find out within a second. */
  hash(): number {
    let h = 0x811c9dc5 ^ this.tick;
    const mix = (v: number) => { h = Math.imul(h ^ (v & 0xffff), 0x01000193) >>> 0; h = Math.imul(h ^ (v >>> 16), 0x01000193) >>> 0; };
    const str = (t: string) => { for (let i = 0; i < t.length; i++) mix(t.charCodeAt(i)); };
    for (const a of this.actors) {
      const m = a.m;
      mix(a.id); str(m.spot.map); mix(m.spot.x); mix(m.spot.y); str(m.prev.map); mix(m.prev.x); mix(m.prev.y);
      mix(m.facing); mix(m.moveDir); mix(m.runningState); mix(m.run ? 1 : 0); mix(m.strides); mix(m.bike ? 1 + m.bikeSpeed * 4 + m.bikeCount * 16 : 0);
      mix(m.px + 1024); mix(m.py + 1024); mix(m.lift + 1024);
      mix(m.action ? m.action.t + 64 * m.action.len + 4096 * m.action.dir : 0xffff);
      mix((a.battling ? 1 : 0) | (a.arriving ? 4 : 0) | ((a.field ?? 0) << 3)); mix(a.foe); mix(a.calm); mix(a.shun); mix(a.shunUntil); mix(a.keys); mix(a.last); mix(a.judge ?? 0); mix(a.since ?? 0); mix(a.bites ?? 0); mix(a.bleedAt ?? 0); mix(a.boss ?? 0); mix(a.away ? 1 : 0); mix(a.pickBy ?? 0); mix(a.cruise ? (a.cruise.to === 'lilycove' ? 8 : 16) + LEGS.indexOf(a.cruise.leg) : 0); mix(a.cruise?.steps ?? 0); mix(a.loot?.money ?? 0); for (const st of a.loot?.items ?? []) { mix(st.id); mix(st.n); }
      if (a.meet) { mix(a.meet.foe); mix(a.meet.since); mix((a.meet.walk ? 1 : 0) | (a.meet.duel ? 2 : 0)); }
    }
    for (const [k, t] of this.taken) { mix(k); mix(t); }
    for (const [k, by] of this.picked) { mix(k); mix(by); }
    for (const b of this.bench) { mix(b.id); mix(b.skin); mix(b.away ? 1 : 0); str(b.name); }
    const r = this.results;
    mix(r.round); mix(r.winner); mix(r.wonAt ?? 0); mix(this.epoch); mix(this.opening); mix(this.duelAfter); for (const [n, w] of this.gyms) { mix(n); mix(w.length); }
    for (const h of this.homes) { mix(h.n); mix(h.species); mix(h.busy); mix(h.gone ? 1 : 0); }
    for (const e of this.events) { mix(e.key); mix(e.x); mix(e.y); mix(e.species); mix(e.story?.length ?? 0); mix(e.opened ? 1 : 0); if (e.trader) { mix(e.trader.x); mix(e.trader.y); mix(e.trader.species); mix(e.trader.busy); } }
    for (const [id] of r.entrants) mix(id);
    for (const f of r.fallen) { mix(f.id); str(f.by); mix((f.wild ? 1 : 0) | (f.left ? 2 : 0)); }
    for (const b of this.spills.values()) {
      mix(b.key); str(b.map); mix(b.x); mix(b.y); mix(b.bag.money);
      for (const r of b.bag.items) { mix(r.id); mix(r.n); }
      for (const m of b.bag.mons ?? []) { mix(m.species); mix(m.level); }
    }
    return h;
  }
}

/** Every outdoor map joined to Littleroot by its seams, each at its place in one plane
 *  (tiles): the maps a trainer may walk on, and where the page draws them. */
export function layout(maps: readonly WorldMap[]): Map<string, { m: WorldMap; gx: number; gy: number }> {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const placed = new Map<string, { m: WorldMap; gx: number; gy: number }>();
  const start = byId.get('MAP_LITTLEROOT_TOWN')!;
  placed.set(start.id, { m: start, gx: 0, gy: 0 });
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
      placed.set(to.id, { m: to, gx, gy });
      queue.push(to.id);
    }
  }
  return placed;
}

/** Doors a match keeps shut (br_match.c's sClosedDoors): BIRCH's LAB, the BATTLE TENTs,
 *  the TRICK HOUSE, the SAFARI ZONE and the ELITE FOUR. */
export const CLOSED_DOORS: ReadonlySet<string> = new Set([
  'MAP_LITTLEROOT_TOWN_PROFESSOR_BIRCHS_LAB',
  'MAP_FALLARBOR_TOWN_BATTLE_TENT_LOBBY', 'MAP_VERDANTURF_TOWN_BATTLE_TENT_LOBBY', 'MAP_SLATEPORT_CITY_BATTLE_TENT_LOBBY',
  'MAP_ROUTE110_TRICK_HOUSE_ENTRANCE', 'MAP_ROUTE121_SAFARI_ZONE_ENTRANCE', 'MAP_EVER_GRANDE_CITY_HALL5',
]);

/** Every building and cave a trainer can walk into from the outdoor maps -- through
 *  doors, stairs and cave mouths, floor after floor -- with the plane point (tiles) of the
 *  outdoor cell its way in leaves from: the centre of that door's cell. Closed doors, and
 *  what only they lead to, are left out. */
export function interiors(all: readonly WorldMap[], outside: ReadonlyMap<string, { gx: number; gy: number }>): Map<string, { m: WorldMap; gx: number; gy: number }> {
  const byId = new Map(all.map((m) => [m.id, m]));
  const out = new Map<string, { m: WorldMap; gx: number; gy: number }>();
  const queue = [...outside.keys()];
  while (queue.length) {
    const id = queue.shift()!;
    const m = byId.get(id);
    if (!m) continue;
    const here = outside.get(id);
    for (const w of m.warps ?? []) {
      const to = byId.get(w.to);
      // An outdoor map is Hoenn's own place unless a door is the only way to it (SKY
      // PILLAR's ledge, between its entrance and its first floor).
      if (!to || outside.has(to.id) || CLOSED_DOORS.has(to.id) || out.has(to.id)) continue;
      const at = here ? { gx: here.gx + w.x + 0.5, gy: here.gy + w.y + 0.5 } : out.get(id)!;
      out.set(to.id, { m: to, gx: at.gx, gy: at.gy });
      queue.push(to.id);
    }
  }
  return out;
}

/** A room over world.json's maps: walking on every outdoor map joined to Littleroot, and
 *  in every building and cave they lead into. */
export function makeRoom(all: readonly WorldMap[], patches: PatchTable, seed: number, world?: World): Room {
  const placed = layout(all);
  const places = new Map([...placed].map(([id, p]) => [id, { gx: p.gx, gy: p.gy }]));
  const inside = interiors(all, places);
  // The Safari Zone, its own cluster (its gate is a closed door): the opening's.
  const zone = all.filter((m) => m.id.startsWith(SAFARI));
  const maps = new Map([...placed, ...inside].map(([id, p]) => [id, p.m]));
  for (const m of zone) maps.set(m.id, m);
  const anchors = new Map([...inside].map(([id, p]) => [id, { gx: p.gx, gy: p.gy }]));
  for (const m of zone) anchors.set(m.id, { gx: -10000, gy: -10000 });
  // The islands, the ferry's: the ring measures them by the dock it sails from (br_story.c's
  // BrStory_Dock), Lilycove's harbour.
  const harbor = anchors.get(ATTENDANT.map);
  if (harbor) for (const m of islandMaps(all)) { maps.set(m.id, m); anchors.set(m.id, harbor); }
  // The SS TIDAL, out between its two harbours.
  const slateport = anchors.get(PORTS.slateport.land.map);
  if (harbor && slateport) for (const m of all.filter((q) => TIDAL_MAPS.includes(q.id))) { maps.set(m.id, m); anchors.set(m.id, { gx: (harbor.gx + slateport.gx) / 2, gy: (harbor.gy + slateport.gy) / 2 }); }
  // Under the sea (DIVE): each map below a dive spot and those its seams join, measured by
  // the sea above them cell for cell (inFog), with the middle of it for an anchor.
  const byId = new Map(all.map((m) => [m.id, m]));
  const below = [...maps.values()].flatMap((m) => (m.dive ? [m.dive] : []));
  while (below.length) {
    const m = byId.get(below.shift()!);
    const above = m?.emerge ? places.get(m.emerge) : undefined;
    if (!m || !above || maps.has(m.id)) continue;
    maps.set(m.id, m);
    anchors.set(m.id, { gx: above.gx + m.w / 2, gy: above.gy + m.h / 2 });
    below.push(...m.seams.map((s) => s.to));
  }
  const room = new Room(world ?? new World(all as WorldMap[]), maps, patches, seed, places, anchors);
  // Built now, once per world (cached), not on the frame of the first drop.
  room.landing();
  return room;
}
