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
import { rungForPhase } from '../../src/bots/party';
import { World, type Spot, type WorldMap } from '../../src/bots/world';
import { dealPatches, type Patch, type PatchTable } from '../../src/bots/patches';
import { blueTm, scatterItem } from '../../src/match/scatter';
import roomsJson from '../data/rooms.json';
import { GIFTS } from '../../src/match/gifts';
import { cableOrDoll, type BagRows } from './items';
import { SIGHT_RANGE, eitherSees, type Facing } from '../../src/bots/sight';
import { CLASS_WATER, DIR_NORTH, dirOf, newMover, stepFn, tick, type Keys, type Mover, type StepFn } from '../sim';

export const KEY_UP = 1, KEY_DOWN = 2, KEY_LEFT = 4, KEY_RIGHT = 8, KEY_B = 16, KEY_A = 32;

export function keysOf(bits: number): Keys {
  return { up: !!(bits & KEY_UP), down: !!(bits & KEY_DOWN), left: !!(bits & KEY_LEFT), right: !!(bits & KEY_RIGHT), b: !!(bits & KEY_B), a: !!(bits & KEY_A) };
}

export function bitsOf(k: Keys): number {
  return (k.up ? KEY_UP : 0) | (k.down ? KEY_DOWN : 0) | (k.left ? KEY_LEFT : 0) | (k.right ? KEY_RIGHT : 0) | (k.b ? KEY_B : 0) | (k.a ? KEY_A : 0);
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
  /** A bot somebody has fought: it does not ask again. */
  beaten: boolean;
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
  /** Where to drop at the Safari's end (an outdoor map), as asked. */
  pick?: string;
  /** Bites the fog has taken out of a bot (BOT_BITES and it is out). */
  bites?: number;
  /** Fighting gym leader n - 1 (gyms.ts). */
  boss?: number;
  /** A fight that started from a look, before it starts (br_walkup.h): the "!", then the
   *  walker walks the eyeline to the cell beside the other. On both; `walk` on the one
   *  who walks, `duel` for two trainers (a bot's is a fight). */
  meet?: { foe: number; walk: boolean; since: number; duel: boolean };
}

/** A team with somebody who could SURF: water is walkable (and up a waterfall). */
export const FIELD_SURF = 4;

/** What a frame started: a phone starts the matching ROM battle for its own trainer. */
export type RoomEvent =
  | { type: 'wild'; tick: number; id: number; map: string; x: number; y: number; key: number }
  | { type: 'fight'; tick: number; id: number; foe: number }
  /** Two trainers saw each other: a link battle. `first` is the side that challenged
   *  (link id 0, the lower id, as the ROM's own engage has it). */
  | { type: 'duel'; tick: number; id: number; foe: number; first: boolean }
  | { type: 'item'; tick: number; id: number; key: number; item: number; gift?: boolean }
  | { type: 'bag'; tick: number; id: number; key: number; bag: Bag; name: string }
  /** A at a CENTER's nurse, from the counter. */
  | { type: 'nurse'; tick: number; id: number; map: string }
  /** A at an event's legendary: its battle (the room took it off the ground). */
  | { type: 'legend'; tick: number; id: number; key: number; species: number; level: number }
  /** A at an event's trader: his offer, for one of mine (`traded` says which). */
  | { type: 'trade'; tick: number; id: number; n: number; species: number; gives?: boolean }
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
export interface Spill { key: number; map: string; x: number; y: number; name: string; bag: Bag; legend?: boolean }

/** An event this round (events.ts, DESIGN §Events): its number, where its legendary
 *  stands (its key), and which one. */
export interface EventMark { n: number; key: number; map: string; x: number; y: number; species: number; trader?: Trader }

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
/** The fog bites a bot every BOT_BITE frames, and the BOT_BITES-th takes it. */
export const BOT_BITE = 600;
export const BOT_BITES = 3;

/** The caches' rooms (tools/br/spike-rooms.py, from br_balls.c): map, cell, a house. */
const ROOMS = roomsJson as [string, number, number, boolean, boolean, number, number, boolean][];

/** Spill keys, clear of the dealt balls' 1..n. */
export const SPILL_KEY = 1 << 20;

/** An item ball: its key, its cell and what is in it. */
export interface Ground { key: number; map: string; x: number; y: number; item: number; gift?: boolean }

/** Item balls a map gets: the match deals two a section, and a spike map is two or three
 *  of them (Cam, POK-354: "more items all over the place"). */
export const GROUND_PER_MAP = 6;

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
  | { c: 'bots'; id: number; a: number; b: number; winner: number }
  /** `id` traded event `n`'s trader the species `given` (0: thought better of it). */
  | { c: 'traded'; id: number; n: number; given: number }
  /** `id`'s page went (a reload), or came back. */
  | { c: 'away'; id: number; on: boolean }
  /** Drop `id` on `map` when the Safari ends. */
  | { c: 'pick'; id: number; map: string };

/** The marked spots grow back: the ring's phase does it in the game; here, a while. */
export const REGROW = 60 * 90;

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
export interface Benched { id: number; name: string; skin: number }

/** One who went out of a round: what beat them (a name; '' for the fog), or `left`. */
export interface Fallen { id: number; name: string; by: string; wild?: boolean; left?: boolean; bot?: boolean }

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

/** A ring phase, in frames: the match's 120 s (DEFAULT_FOG_SECS, web/src/match/director.ts). */
export const RING_PHASE = 60 * 120;
/** What each phase leaves of the reachable world, as a share of its farthest cell from
 *  the centre: the first an announcement (no fog), then clock.ts's RING_RADII
 *  [28, 15, 9, 7, 5, 3, 2, 0, -1] as shares of its 28 -- 0 the centre cell alone, -1
 *  everywhere. The match measures in region-map sections; here it is tiles, on purpose:
 *  this world is walked tile by tile, and a section-sized ring would fog half a town. */
const RING_STEPS = [Infinity, 15 / 28, 9 / 28, 7 / 28, 5 / 28, 3 / 28, 2 / 28, 0, -1];

/** The ring at a frame, in the plane layout() places the maps in (tiles). `r` is Infinity
 *  for no fog and -1 for fog everywhere; `left` the frames to the next phase. */
export interface Ring { round: number; phase: number; last: boolean; cx: number; cy: number; r: number; next?: number; left: number; safari?: boolean }

/** The Safari opening (DESIGN §The drop): every round begins with every trainer in the
 *  Safari Zone for one phase's length, catching, no fighting; then the drop puts each
 *  where they asked (`pick`), or anywhere. */
export const SAFARI = 'MAP_SAFARI_ZONE_';

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
      if (a && !a.bot) a.field = cmd.bits & 7;
    } else if (cmd.c === 'pick') {
      const a = this.actor(cmd.id);
      if (a && !a.bot && this.places.has(cmd.map) && !cmd.map.startsWith(SAFARI)) a.pick = cmd.map;
    } else if (cmd.c === 'away') {
      const a = this.actor(cmd.id);
      if (a && !a.bot) a.away = cmd.on || undefined;
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
      if (won && lost && !lost.beaten) { lost.beaten = true; this.fall(lost, won.name); }
    } else if (cmd.c === 'lock') {
      this.results.entrants = this.actors.map((a) => [a.id, a.name]);
    } else if (cmd.c === 'join') {
      if (this.actor(cmd.id) || this.bench.some((b) => b.id === cmd.id)) return;
      // The fog has closed on this round: in from the next.
      if (this.results.entrants.length && !cmd.bot) { this.bench.push({ id: cmd.id, name: cmd.name, skin: cmd.skin }); return; }
      const a: Actor = { id: cmd.id, bot: cmd.bot, name: cmd.name, skin: cmd.skin, m: newMover(cmd.spot, cmd.facing), keys: 0, last: 0, battling: false, beaten: false, foe: 0, calm: this.tick + JOIN_GRACE, shun: 0, shunUntil: 0, arriving: false };
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
        const key = SPILL_KEY + a.id;
        this.spills.set(key, { key, map: a.m.spot.map, x: a.m.spot.x, y: a.m.spot.y, name: a.name, bag: structuredClone(cmd.bag) });
      }
      // A trainer they were fighting is still in that battle: their page ends it (their
      // ROM wins it, BrNetlink_PeerOut) and says so.
      const foe = a?.foe ? this.actor(a.foe) : undefined;
      if (foe?.bot) foe.battling = false;
      // Bots whose fight their page was running: no answer is coming, they walk on.
      for (const o of this.actors) if (o.bot && o.judge === cmd.id) this.part(o);
      // A legendary they were fighting stands again (Cam: they go back for retries).
      for (const [key, by] of this.picked) if (by === cmd.id && this.spills.get(key)?.legend) this.picked.delete(key);
      for (const e of this.events) if (e.trader?.busy === cmd.id) e.trader.busy = 0;
      for (const h of this.homes) if (h.busy === cmd.id) h.busy = 0;
      this.actors = this.actors.filter((o) => o.id !== cmd.id);
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
        // Beaten, and out of the round (the page says nothing of a fight that ran over
        // into a new round: that was the old round's).
        if (cmd.won && !foe.beaten) { foe.beaten = true; this.fall(foe, a.name); }
      }
      a.foe = 0;
      // A gym leader falls once: the first to beat them closes the gym.
      if (a.boss) {
        if (cmd.won && !this.bossDown(a.boss - 1)) this.gyms.push([a.boss - 1, a.name]);
        a.boss = undefined;
      }
    }
  }

  /** Gym leader `n` has been beaten this round. */
  bossDown(n: number): boolean {
    return this.gyms.some(([m]) => m === n);
  }

  isTaken(key: number): boolean {
    const at = this.taken.get(key);
    return at !== undefined && this.tick - at < REGROW;
  }

  /** Every item ball the seed deals, taken or not, by cell (`map:x:y`). Walked out from
   *  Littleroot on foot over this room's maps, so none is on an island or behind a ledge
   *  that only goes one way out; each on plain ground, never a marked spot or a door, nor
   *  the corner new trainers stand on. */
  ground(): ReadonlyMap<string, Ground> {
    if (this.dealt) return this.dealt;
    // The same seed over the same maps deals the same balls: dealt once a process (the
    // relay makes one room; the tests and a phone's resyncs make many).
    const id = `${this.seed}:${[...this.maps.keys()].join()}`;
    const hit = DEALS.get(id);
    if (hit) return (this.dealt = hit);
    const land = new Map<string, Spot[]>();
    for (const at of this.reachable()) {
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
        // A machine is taught there and then, as a match's is (rom.ts teach).
        const item = cableOrDoll(scatterItem(rng), rng());
        out.set(`${id}:${c.x}:${c.y}`, { key: ++n, map: id, x: c.x, y: c.y, item });
      }
    }
    // A cache in every house and on every other floor that had nothing (br_balls.c's
    // sRooms, Cam 2026-10-18: "an item, trader, or both on every floor"): a machine, or
    // gold one time in three in a house and one in eight on a floor.
    for (const [map, x, y, house, cache] of ROOMS) {
      if (!cache) continue;
      // A building this world goes into (makeRoom's interiors), on its floor.
      if (!this.maps.has(map) || this.places.has(map) || this.world.cell(map, x, y) !== 0 || out.has(`${map}:${x}:${y}`)) continue;
      // The match keeps its cells off the wild patches (BrBalls_Spot); here the patch has it.
      if (this.patchesOn(map).some((q) => q.x === x && q.y === y)) continue;
      const gold = Math.floor(rng() * (house ? 3 : 8)) === 0;
      out.set(`${map}:${x}:${y}`, { key: ++n, map, x, y, item: gold ? GOLD[Math.floor(rng() * GOLD.length)] : blueTm(rng) });
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
    const cycle = RING_STEPS.length * len + this.opening;
    const n = Math.floor((tick - this.epoch) / cycle);
    const round = this.results.round + n;
    let t = tick - this.epoch - n * cycle;
    const { cx, cy, far } = this.centre(round);
    // The Safari: phase 0's no-fog, before it.
    if (t < this.opening) return { round, phase: 0, last: false, cx, cy, r: Infinity, next: Infinity, left: this.opening - t, safari: true };
    t -= this.opening;
    const phase = Math.floor(t / len);
    const at = (i: number) => (RING_STEPS[i] === Infinity || RING_STEPS[i] < 0 ? RING_STEPS[i] : RING_STEPS[i] * far);
    const last = phase === RING_STEPS.length - 1;
    return { round, phase, last, cx, cy, r: at(phase), next: last ? undefined : at(phase + 1), left: len - (t - phase * len) };
  }

  /** Frames a phase lasts: RING_PHASE, or shorter for a solo test (`?ring=` seconds). */
  ringPhase = RING_PHASE;
  /** The frame this round started on. */
  epoch = 0;
  /** Frames of Safari each round opens with (SAFARI); 0, none (a test's room). */
  opening = 0;

  private centres = new Map<number, { cx: number; cy: number; far: number }>();
  /** A round's centre: a cell a trainer can stand on, from the seed; and how far the
   *  farthest reachable cell is from it. */
  private centre(round: number): { cx: number; cy: number; far: number } {
    const hit = this.centres.get(round);
    if (hit) return hit;
    const cells = this.reachable();
    let h = Math.imul((this.seed ^ 0x51ed270b) >>> 0, 0x9e3779b1) ^ Math.imul(round + 1, 0x85ebca6b);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    const c = cells[(h >>> 0) % cells.length];
    const p = this.places.get(c.map)!;
    const cx = p.gx + c.x + 0.5, cy = p.gy + c.y + 0.5;
    let far = 0;
    for (const s of cells) {
      const q = this.places.get(s.map)!;
      far = Math.max(far, Math.hypot(q.gx + s.x + 0.5 - cx, q.gy + s.y + 0.5 - cy));
    }
    const out = { cx, cy, far };
    if (this.centres.size > 4) this.centres.clear();
    this.centres.set(round, out);
    return out;
  }

  /** Is this cell in the fog now? */
  inFog(s: Spot, ring = this.ring()): boolean {
    if (ring.r === Infinity) return false;
    if (ring.r < 0) return true;
    const p = this.places.get(s.map);
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
    if (ring.round !== was.round || (r.wonAt !== undefined && this.tick >= r.wonAt + AFTER_WIN)) this.newRound(r.round + 1);
    else if (was.safari && !ring.safari) this.drop(ring.round);
    else if (ring.phase !== was.phase) {
      // The fog closes for the first time: who is on the map is the match.
      if (ring.phase === 1 && !r.entrants.length) r.entrants = this.actors.map((a) => [a.id, a.name]);
      const n = eventForRing(ring.phase);
      if (n !== undefined) this.dropEvent(n, ring);
    }
    // The last one standing, once the frame's goings are all in (the last two out on one
    // frame: neither).
    if (!r.winner && r.entrants.length >= 2) {
      const alive = r.entrants.filter(([id]) => !r.fallen.some((f) => f.id === id));
      if (alive.length === 1) { r.winner = alive[0][0]; r.wonAt = this.tick; }
    }
    // The fog bites a bot in it every ten seconds and takes it at the third (a match's
    // bleed, in bites): time to walk out, which a bot on its way does (bots.ts).
    if ((this.tick - this.epoch) % Math.max(1, Math.round(this.ringPhase / RING_PHASE * BOT_BITE)) === 0) {
      for (const a of this.actors) {
        if (!a.bot || a.beaten || a.battling || !this.inFog(a.m.spot, ring)) continue;
        a.bites = (a.bites ?? 0) + 1;
        if (a.bites >= BOT_BITES) { a.beaten = true; this.fall(a, ''); }
      }
    }
    for (const [key, at] of this.taken) if (this.tick - at >= REGROW) this.taken.delete(key);
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
    // A page that can run it now: not reloading, not in a battle of its own (its ROM is busy).
    const judges = this.actors.filter((a) => !a.bot && !a.away && !a.battling);
    if (!judges.length) return;
    const byMap = new Map<string, Actor[]>();
    for (const a of this.actors) {
      if (!a.bot || a.beaten || a.battling || a.m.action || this.tick < a.calm) continue;
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

  /** `a` is out of this round's match (once; nothing after the win). */
  private fall(a: Actor, by: string, how: { wild?: boolean; left?: boolean } = {}): void {
    const r = this.results;
    if (r.winner || !r.entrants.some(([id]) => id === a.id) || r.fallen.some((f) => f.id === a.id)) return;
    r.fallen.push({ id: a.id, name: a.name, by, ...how, ...(a.bot ? { bot: true } : {}) });
  }

  /** The cells by the truck that no bot stands on: along its row first, nearest first, so
   *  trainers stood side by side facing south do not see each other (and fight the moment
   *  their grace is up). */
  truck(): Spot[] {
    if (this.ring().safari) return this.zone();
    const d = (s: Spot) => Math.abs(s.y - 10) * 64 + Math.abs(s.x - 10) * 2 + (s.x < 10 ? 1 : 0);
    const near = this.reachable().filter((s) => s.map === 'MAP_LITTLEROOT_TOWN').sort((p, q) => d(p) - d(q)).slice(0, TRUCK);
    return near.filter((s) => !this.actors.some((a) => a.bot && a.m.spot.map === s.map && a.m.spot.x === s.x && a.m.spot.y === s.y));
  }

  /** Where trainers stand when the Safari opens: spread over the Zone's areas, as far
   *  as one walks from its gate (no bike, no SURF). */
  zone(): Spot[] {
    const all = this.safariCells();
    const taken = (s: Spot) => this.actors.some((a) => a.m.spot.map === s.map && a.m.spot.x === s.x && a.m.spot.y === s.y);
    // Every seventh cell, so a crowd starts apart rather than in a line.
    return all.filter((s, i) => i % 7 === 0 && !taken(s));
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

  /** The Safari is over: everybody still in the Zone drops where they asked (or, asking
   *  nowhere, anywhere outdoors), on a free cell of that map dealt from the seed. */
  private drop(round: number): void {
    let state = (this.seed ^ Math.imul(round + 1, 0x2545f491)) >>> 0 || 1;
    const rng = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const maps = [...this.places.keys()].filter((m) => !m.startsWith(SAFARI)).sort();
    const used = new Set(this.actors.map((a) => `${a.m.spot.map}:${a.m.spot.x}:${a.m.spot.y}`));
    for (const a of this.actors) {
      if (a.bot || !a.m.spot.map.startsWith(SAFARI)) continue;
      const want = a.pick && this.places.has(a.pick) ? a.pick : maps[Math.floor(rng() * maps.length)];
      a.pick = undefined;
      const m = this.maps.get(want);
      if (!m) continue;
      const cells: Spot[] = [];
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        if (this.world.cell(want, x, y) !== 0 || used.has(`${want}:${x}:${y}`) || this.groundAt(want, x, y) || this.spillAt(want, x, y)) continue;
        if (this.patchesOn(want).some((q) => q.x === x && q.y === y)) continue;
        cells.push({ map: want, x, y });
      }
      if (!cells.length) continue;
      const to = cells[Math.floor(rng() * cells.length)];
      used.add(`${to.map}:${to.x}:${to.y}`);
      a.m = newMover(to, 1);
      a.calm = this.tick + JOIN_GRACE;
    }
  }

  /** The fog lifted: a new match. Every trainer, out or in, back at the truck with the
   *  join's grace; the balls, spots and bags back as dealt; the bots to be fought again. */
  private newRound(round: number): void {
    const humans: Actor[] = [];
    for (const a of this.actors) if (!a.bot) humans.push(a);
    for (const b of this.bench) {
      humans.push({ id: b.id, bot: false, name: b.name, skin: b.skin, m: newMover({ map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, 1), keys: 0, last: 0, battling: false, beaten: false, foe: 0, calm: 0, shun: 0, shunUntil: 0, arriving: false });
    }
    humans.sort((p, q) => p.id - q.id);
    this.bench = [];
    // The new round's clock first: it opens in the Safari (truck()).
    this.results = { round, entrants: [], fallen: [], winner: 0 };
    this.epoch = this.tick;
    const spots = this.truck();
    humans.forEach((a, i) => {
      // Somebody still in a battle of the round before ends it where they now stand.
      a.m = newMover(spots[i % spots.length], 1);
      a.calm = this.tick + JOIN_GRACE;
      a.shun = a.shunUntil = 0;
      a.arriving = false;
    });
    this.actors = [...this.actors.filter((a) => a.bot), ...humans];
    this.actors.sort((p, q) => p.id - q.id);
    for (const a of this.actors) if (a.bot) { a.beaten = false; a.bites = 0; if (a.judge) this.part(a); }
    this.duelAfter = 0;
    this.events = [];
    this.gyms = [];
    this.homes = this.dealHomes(round);
    this.taken.clear();
    this.picked.clear();
    this.spills.clear();
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
      } else events.push({ type: 'fight', tick: this.tick, id: h.id, foe: f.id });
    }
  }

  /** Two trainers on one map who see each other fight (br_engage.c's BrEngage_Tick): the
   *  eyeline both ways, BR_SIGHT_RANGE cells, stopped by collision (bots/sight.ts). Only
   *  trainers standing still, neither in a fight nor in its grace. They turn to face each
   *  other, and the lower id is the side that challenged. */
  private engage(events: RoomEvent[]): void {
    if (this.ring().safari) return; // the Safari is for catching
    const free = this.actors.filter((a) => !a.bot && !a.away && !a.battling && !a.m.action && this.tick >= a.calm);
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
    // then, as a route trainer does (Bots engage players, DESIGN §10). Not one already
    // beaten, fighting, mid-step or in its grace; nor one the trainer fled.
    for (const h of free) {
      if (h.battling) continue;
      for (const b of this.actors) {
        if (!b.bot || b.beaten || b.battling || b.m.action || this.tick < b.calm || b.m.spot.map !== h.m.spot.map) continue;
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
        // A, from a bot on its way somewhere (bots.ts): it may jump a ledge, or SURF.
        if (!r || ((r.hop || (r.water && !this.onWater(a))) && !(bits & KEY_A))) { a.last = bits; return; }
      }
    }
    const before = a.m.strides;
    tick(a.m, keysOf(bits), this.stepFor(a));
    if (a.m.strides !== before) a.arriving = true;
    if (!a.m.action && !a.bot) {
      if (a.arriving) {
        a.arriving = false;
        const p = this.patchesOn(a.m.spot.map).find((q) => q.x === a.m.spot.x && q.y === a.m.spot.y && !this.isTaken(q.key));
        if (p) {
          this.taken.set(p.key, this.tick);
          a.battling = true;
          events.push({ type: 'wild', tick: this.tick, id: a.id, map: a.m.spot.map, x: p.x, y: p.y, key: p.key });
        }
      }
      if (!a.battling && (bits & KEY_A) && !(a.last & KEY_A)) {
        const [x, y] = this.ahead(a);
        const g = this.groundAt(a.m.spot.map, x, y);
        const b = g ? undefined : this.spillAt(a.m.spot.map, x, y);
        const foe = g || b ? undefined : this.facing(a);
        const tr = foe ? undefined : this.traderAt(a.m.spot.map, x, y);
        const boss = foe || tr ? undefined : leaderAt(a.m.spot.map, x, y);
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
        } else if (b?.legend) {
          const mon = b.bag.mons![0];
          this.picked.set(b.key, a.id);
          a.battling = true;
          events.push({ type: 'legend', tick: this.tick, id: a.id, key: b.key, species: mon.species, level: mon.level });
        } else if (b) {
          this.picked.set(b.key, a.id);
          events.push({ type: 'bag', tick: this.tick, id: a.id, key: b.key, bag: structuredClone(b.bag), name: b.name });
        } else if (foe && foe.bot && !foe.beaten && !foe.battling && !foe.m.action) {
          a.battling = foe.battling = true;
          foe.m.facing = foe.m.moveDir = BACK[a.m.facing];
          a.foe = foe.id;
          events.push({ type: 'fight', tick: this.tick, id: a.id, foe: foe.id });
        } else if (!foe && this.clerk(a)) {
          events.push({ type: 'mart', tick: this.tick, id: a.id, map: a.m.spot.map });
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
    return (from, dir) => {
      // A bot can go anywhere a team could (Kanto's bots cross water): a wanderer keeps
      // to land and off ledges all the same (Room.move).
      const bits = a.bot ? 7 : a.field ?? 0;
      const r = bits ? (this.fields[bits] ??= stepFn(this.world, { surf: (bits & FIELD_SURF) !== 0, cut: bits & 3 }))(from, dir) : this.base(from, dir);
      if (!r || !this.maps.has(r.to.map)) return null;
      // A townsperson stays out in the street.
      if (a.bot && !this.places.has(r.to.map)) return null;
      const t = r.to;
      if (this.groundAt(t.map, t.x, t.y) || this.spillAt(t.map, t.x, t.y) || clerkAt(t.map, t.x, t.y) || this.traderAt(t.map, t.x, t.y)) return null;
      // The Zone's gate is shut until the drop, both ways.
      if (from.map.startsWith(SAFARI) !== t.map.startsWith(SAFARI) && this.ring().safari) return null;
      const boss = leaderAt(t.map, t.x, t.y);
      if (boss && !this.bossDown(boss.n)) return null;
      if (this.actors.some((o) => o.id !== a.id && o.m.spot.map === t.map && o.m.spot.x === t.x && o.m.spot.y === t.y)) return null;
      return r;
    };
  }

  /** A short fingerprint of the room: two machines that disagree find out within a second. */
  hash(): number {
    let h = 0x811c9dc5 ^ this.tick;
    const mix = (v: number) => { h = Math.imul(h ^ (v & 0xffff), 0x01000193) >>> 0; h = Math.imul(h ^ (v >>> 16), 0x01000193) >>> 0; };
    const str = (t: string) => { for (let i = 0; i < t.length; i++) mix(t.charCodeAt(i)); };
    for (const a of this.actors) {
      const m = a.m;
      mix(a.id); str(m.spot.map); mix(m.spot.x); mix(m.spot.y); str(m.prev.map); mix(m.prev.x); mix(m.prev.y);
      mix(m.facing); mix(m.moveDir); mix(m.runningState); mix(m.run ? 1 : 0); mix(m.strides);
      mix(m.px + 1024); mix(m.py + 1024); mix(m.lift + 1024);
      mix(m.action ? m.action.t + 64 * m.action.len + 4096 * m.action.dir : 0xffff);
      mix((a.battling ? 1 : 0) | (a.beaten ? 2 : 0) | (a.arriving ? 4 : 0) | ((a.field ?? 0) << 3)); mix(a.foe); mix(a.calm); mix(a.shun); mix(a.shunUntil); mix(a.keys); mix(a.last); mix(a.judge ?? 0); mix(a.since ?? 0); mix(a.bites ?? 0); mix(a.boss ?? 0); mix(a.pick?.length ?? 0); mix(a.away ? 1 : 0);
      if (a.meet) { mix(a.meet.foe); mix(a.meet.since); mix((a.meet.walk ? 1 : 0) | (a.meet.duel ? 2 : 0)); }
    }
    for (const [k, t] of this.taken) { mix(k); mix(t); }
    for (const [k, by] of this.picked) { mix(k); mix(by); }
    for (const b of this.bench) { mix(b.id); mix(b.skin); str(b.name); }
    const r = this.results;
    mix(r.round); mix(r.winner); mix(r.wonAt ?? 0); mix(this.epoch); mix(this.opening); mix(this.duelAfter); for (const [n, w] of this.gyms) { mix(n); mix(w.length); }
    for (const h of this.homes) { mix(h.n); mix(h.species); mix(h.busy); mix(h.gone ? 1 : 0); }
    for (const e of this.events) { mix(e.key); mix(e.x); mix(e.y); mix(e.species); if (e.trader) { mix(e.trader.x); mix(e.trader.y); mix(e.trader.species); mix(e.trader.busy); } }
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
      if (!to || to.outdoor || CLOSED_DOORS.has(to.id) || out.has(to.id)) continue;
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
  return new Room(world ?? new World(all as WorldMap[]), maps, patches, seed, places, anchors);
}
