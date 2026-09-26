// What a bot does with itself (POK-236), the walking half.
//
// One tick a step, at a real second's pace: Kanto walks a bot four tiles a second and
// never faster, because a spectator is watching and a bot that teleports reads as a
// bug even when it is not. The host's tab runs this and speaks for every bot -- one
// `step` a bot a step -- and every other client sees ghosts, which is all a bot ever
// was on the wire.
//
// This slice walks. Where it walks is one rule ("somewhere else on foot") and the
// decision list -- fog, loot, the Centre, hunting -- goes on top of it, replacing only
// `chooseTarget`.
import { findPath, findPathToAny, type Path } from './path';
import { eitherSees, type Facing, type Look } from './sight';
import { Grade, type Bot } from './roster';
import { MOVE_CUT, MOVE_FLY, MOVE_SURF } from './party';
import { battleItems, merge as mergeBag, purse, quaff, restock, spend, type Stack } from './bag';
import { duel, type DuelResult } from './duel';
import { sameSpot, spotKey, type SeamDir, type Spot, type World } from './world';
import { pageCell, type PageCell } from './space';
import { PROTOCOL, type MapRef, type Msg, type PackedMon, type SpillMsg } from '../net/wire';
import { spillCells } from '../match/loot';

/** One tile per walk animation, whatever the host's tab is doing.
 *
 *  Emerald's WALK_NORMAL takes sixteen frames -- a sixtieth each, so 266.67ms -- and
 *  a ghost walks with `GetWalkNormalMovementAction` like anything else on the map
 *  (br_ghosts.c). Kanto's four-a-second was right for Kanto's engine and is 17ms too
 *  fast for this one, which does not sound like much until you notice it never stops:
 *  a step arrives before the last one has finished, every time, so BR_STEP_QUEUE fills
 *  and the ghost snaps forward to catch up. The play-test read that as bots moving
 *  faster than the player, and they were -- by one tile every fifteen.
 */
export const STEP_MS = 267;
/** How far a bot will look for its next wander target before settling for less. */
const WANDER_BUDGET = 1500;
/** Routes across THIS map and one step off it, which is all a cross-map hop ever needs
 *  (POK-302). Hoenn's biggest outdoor map is comfortably under this; Kanto's own
 *  per-map cap is 3000 for the same reason (lib/bots.lua's Bots.PATH_NODES). */
const HOP_BUDGET = 3000;
/** How many candidate goal maps to try before giving up and drifting. Kanto's ladder is
 *  best exit, next best, then any -- "any seam beats standing still". */
const GOAL_TRIES = 3;
/** BR_ENGAGE_GRACE in src/br/br_engage.c: 120 frames, and a frame is a sixtieth. */
const ENGAGE_COOLDOWN_MS = 2000;
/** And a longer breather after one bot has beaten another (POK-273). Kanto's own
 *  `Bots.FIGHT_COOLDOWN` is twelve seconds, for the reason its comment gives: bots
 *  used to park beside a fight and take the winner the frame it ended, "a queue of
 *  fights with no way out of it". Ours had only the two-second engage cooldown, and a
 *  full room spent itself in the first minute -- half of thirty bots gone by 97s,
 *  while the fog, which is supposed to decide the match, took four all game. */
const DUEL_COOLDOWN_MS = 12_000;
/** Long on purpose: a flight is an event, not a way of moving. */
const FLY_COOLDOWN_MS = 45_000;
/** One drink every ten seconds (POK-237). Without it a hurt bot empties its bag in
 *  four steps, which is a bot with no bag by the second ring. */
const QUAFF_COOLDOWN_MS = 10_000;
/** What a grade does with the moment after a fight (POK-265). An ace is looking for the
 *  next one before the last has finished; a rookie needs a minute. The cheapest honest
 *  difference: nothing about the walk changes, only the appetite. */
const COOLDOWN_BY_GRADE: Record<number, number> = {
  [Grade.Rookie]: 3,
  [Grade.Regular]: 1,
  [Grade.Ace]: 0.5,
};

function cooldownFor(bot: Bot): number {
  return ENGAGE_COOLDOWN_MS * (COOLDOWN_BY_GRADE[bot.grade] ?? 1);
}
/** Kanto's rule: under half health is hurt enough to walk to a Centre for. */
const HURT = 0.5;
/** How far a bot will walk to be healed. A Centre across Hoenn is not worth the match
 *  it would spend getting there, and A* pays for the search either way. */
const CENTRE_BUDGET = 3000;
/** Kanto's rule: with three left the match stops being a walk and starts being a
 *  hunt. Under this many still standing, a bot aims at somebody rather than at a
 *  cell -- otherwise the last three wander a shrinking ring waiting for each other. */
const HUNT_AT = 3;
/** After a search that found nowhere to go, how long before trying another. A bot
 *  stranded outside a tight ring would otherwise run four full A* sweeps every step
 *  for the rest of the match -- on the host's tab, beside an emulator. It walks
 *  instead, and asks again in a couple of seconds. */
const RETRY_MS = 2000;
/** How much route-finding the whole roster may do in one tick, in A* nodes settled. A*
 *  over Hoenn is the expensive thing here, and eight bots deciding at once is eight of
 *  them in one main thread task -- measured at 159 ms on a CPU throttled to phone speed,
 *  which is a visible hitch in a game running at 60. Whoever misses out keeps walking
 *  the route they had, or waits a tick: at four tiles a second nobody can see the
 *  difference.
 *
 *  Counted in nodes, not in searches (POK-330 #49). It was two decisions a tick, and a
 *  decision is anything from a forty-node walk to the loot at your feet to a stuck bot's
 *  whole ladder -- the Centre, the loot, the goal maps and four wander picks, every one
 *  failing at its full budget. Two of those in one tick was the 15-20 ms p99 at thirty
 *  bots, while the cheap ones queued behind a limit they did not need. One full-size
 *  search's worth a tick (HOP_BUDGET, CENTRE_BUDGET) brought thirty bots' tick to a 1 ms
 *  p99 on desktop, with a third of the waiting.
 *
 *  A decision starts only while there is budget left, and then runs to the end: every
 *  search inside it keeps its own cap, so a route is the route it always was. Cutting a
 *  search short at the tick's edge would read as "no way there" -- a stuck bot and a two
 *  second backoff -- and a decision bigger than a tick would never finish at all. What a
 *  decision spends past the budget is the one overrun a tick can have. */
const NODES_PER_TICK = 3000;
/** BR_FOG_TICK_FRAMES in include/br/br_ring.h: 240 frames, four seconds. The ROM takes
 *  a tenth of each mon's max HP off the player on this beat while they are outside the
 *  ring; a bot standing in the same fog has to lose the same thing on the same beat, or
 *  the fog is a rule that only applies to people and a match with bots in it can never
 *  end. */
const FOG_TICK_MS = 4000;
const FOG_BITE = 10; // a tenth, as `Bleed` in src/br/br_ring.c
/** How long a fight against a player may run before the page stops waiting for it. A
 *  backstop, not a rule: a fight ends with the `party` the ROM that ran it sends back,
 *  and one whose opponent has left ends with them. What is left is a ROM that stalled
 *  or a report lost on the way -- and without this the bot stands frozen, and `busy`
 *  on every client, until the fog takes it. Long, because the shot clock gives every
 *  turn thirty seconds and six-a-side takes a while. */
const FIGHT_TIMEOUT_MS = 5 * 60_000;
/** A fight whose opponent has not been in a battle by now never started: their ROM
 *  was already in something else when the card landed, or never took it at all. */
const FIGHT_START_MS = 20_000;
/** And a duel in the hidden instance: thirty seconds a fight (proxy.ts), up to two
 *  queued ahead of it, and a boot. Past this the instance is not going to answer. */
const PROXY_TIMEOUT_MS = 2 * 60_000;

/** A bot standing still because its fight is running somewhere else. */
interface Fight {
  /** The other side: the player whose ROM runs the battle, or the other bot in a proxy
   *  duel. Only this seat's ROM may say how it went. */
  opponent: number;
  /** When it began, for the backstop. */
  since: number;
  /** Has the opponent been seen in a battle? That is what tells a fight that never
   *  started from a long one. */
  started: boolean;
  /** Set on a duel in the hidden instance, which no ROM reports on: what the backstop
   *  does when the instance never answers -- the seeded resolver. */
  proxy?: () => void;
}

const DIR_WIRE: Record<SeamDir, 1 | 2 | 3 | 4> = {
  south: 1,
  north: 2,
  west: 3,
  east: 4,
};

interface Walker {
  bot: Bot;
  at: Spot;
  path: Path | null;
  stepIndex: number;
  nextStepAt: number;
  facing: Facing;
  /** What it is carrying, right now. Dealt once and then kept: a bot that came out of
   *  a fight with two mons down is a bot that should be looking for a Centre, and a
   *  team re-dealt from the seed every time anybody asks has never been hurt. */
  party: PackedMon[];
  /** Nothing before this: the same grace the ROM keeps after a fight, so a bot that
   *  just fought does not re-challenge the player still standing in front of it. */
  engageAfter: number;
  /** No flying again until this. One flight gets you inside; the next one is a
   *  teleport every few seconds, which is not a trainer. */
  flyAfter: number;
  /** No more searching before this: the last one found nowhere to go. */
  retryAfter: number;
  /** When the fog next takes its bite, if this bot is still standing in it. */
  bleedAt: number;
  /** Nothing to drink before this: one gulp at a time, not the whole bag in four
   *  steps. */
  quaffAfter: number;
  /** Its own bag (POK-237): what it drinks between fights, what it spends in one, and
   *  what a player finds on it when it falls. */
  bag: Stack[];
  /** The map its team is dealt from at every rung: where the drop put it (POK-237 -- a
   *  trainer on Route 119 carries Route 119's mons). Not wherever it is standing when
   *  the ring moves, or its team would turn into a different one each time it did. */
  home: string;
  /** Who it last fought, kept after the fight lets go of it: the ROM that ran it sends
   *  `party`, then `spent`, then `result`, and the first of those is what ends it. The
   *  reports that follow are still that ROM's to make, and nobody else's. */
  foe?: number;
}

/** A player as the roster knows them -- where they are and which way they are looking.
 *  Exactly what the eyeline needs, and nothing a bot could not see. */
/** One rule firing, with where the bot was when it did. */
export interface Decision {
  at: number;
  seat: number;
  rule:
    | 'heal'
    /** Drank from its own bag rather than walking to a Centre (POK-237). */
    | 'quaff'
    | 'engage'
    | 'pickup'
    | 'centre'
    | 'hunt'
    | 'loot'
    | 'wander'
    | 'stuck'
    | 'fog'
    | 'duel'
    /** Waiting its turn to think: the tick's search budget went to somebody else. */
    | 'wait'
    // The flight out of the fog (POK-267).
    | 'fly';
  spot: Spot;
  detail?: string;
}

export interface PlayerView {
  seat: number;
  mapId: string;
  x: number;
  y: number;
  dir: Facing;
  /** In a battle already, or in a menu: not engageable (BR_BUSY_BATTLE in the ROM). */
  busy?: boolean;
}

export interface BotsOptions {
  world: World;
  /** Every cell a bot may wander to -- the same landing pool the drop deals from. */
  targets: { mapId: string; x: number; y: number }[];
  /** Is this map inside the fog? Bots only ever aim at somewhere that is -- the first
   *  rule of Kanto's decision list, and the one that decides whether a match ends with
   *  a fight or with everybody quietly bleeding out in the corners. */
  inside?: (mapId: string) => boolean;
  /** What is lying on the ground, and how to take it: the second rule. A bot walks to
   *  a piece it can reach and picks it up like anybody else, which is also how the
   *  room hears about it -- `pickup` is the same message a player's ROM sends. */
  loot?: {
    /** In the page's space, which is the one the brain walks: the table itself holds
     *  the wire's, and bots/adapt.ts's lootView is the door between them. */
    all: () => ({ key: number; mapId: string } & PageCell)[];
    at: (mapId: string, cell: PageCell) => number | undefined;
    /** What the next item out of this piece would be, when the piece is a bag rather
     *  than a mon (POK-237). A bot takes one the way a player does -- one press, one
     *  item -- and the rest stays on the ground for whoever is next. */
    bagAt?: (key: number) => number | undefined;
  };
  /** world.json id -> the wire's group/num. */
  mapRef: (mapId: string) => MapRef | undefined;
  /** The eyeline (POK-238). A bot has no ROM, so the fight against it is a trainer
   *  battle in the player's: `party` is what that battle is built from, staged over
   *  the wire the moment the pair see each other and immediately challenged. */
  engage?: {
    players: () => PlayerView[];
  };
  /** A bot's starting team, and the mons it picks up as the rung climbs. `mapId` is
   *  where the drop put it, which is where a trainer's mons come from (POK-237). */
  deal?: (bot: Bot, phase: number, mapId: string) => PackedMon[];
  /** And its bag (POK-237). Dealt the same way, from the seed and the grade, so a
   *  rookie's two POTIONs and an ace's X ATTACK are the same on every client. */
  bagFor?: (bot: Bot, phase: number) => Stack[];
  /** How many trainers are still in, bots included. The hunt starts at HUNT_AT. */
  alive?: () => number;
  /** The match seed, so two bots meeting settle it the same way on every client that
   *  cares to work it out. Without it bots never fight each other and only the fog
   *  ever eliminates anybody. */
  seed?: number;
  /** Two bots settled it. The only place both sides of a fight are known at once,
   *  which is what a kill feed needs. */
  onDuel?: (winner: number, loser: number) => void;
  /** Fights it for real, if the host has a proxy instance up (POK-238). Answers null
   *  when it could not -- no instance, a crash, a fight that would not end -- and the
   *  seeded resolver settles it instead, which is what happens today and what happens
   *  on every client that is not the host. */
  settle?: (
    a: { seat: number; party: PackedMon[]; items?: number[] },
    b: { seat: number; party: PackedMon[]; items?: number[] },
  ) => Promise<{
    winner: number;
    loser: number;
    a: { hp: number; status: number }[];
    b: { hp: number; status: number }[];
    /** What each side spent out of the bag it was handed (POK-237). */
    usedA?: number[];
    usedB?: number[];
  } | null>;
  /** Is anybody allowed to fight yet? FALSE through the Safari opening (POK-257):
   *  everybody is on one map catching things, and a bot that duels in there takes the
   *  field apart before the match has started -- eight went into the Zone and two came
   *  out. The ROM refuses an engage outside BR_PHASE_PLAY for the same reason. */
  fights?: () => boolean;
  /** A bot walked up to somebody. Its chance to say something (POK-239). */
  onEngage?: (seat: number, target: number) => void;
  /** Every rule that fired, as it fires. Kanto's `Bots.decisions`: the only way to
   *  answer "why did it go there" about something that walks for sixteen minutes.
   *  Off in the browser; `tools/br/bots-replay.ts` turns it on. */
  onDecision?: (d: Decision) => void;
  /** Every nurse's counter in the world, for the Centre rule. A bot under half health
   *  walks to the nearest one it can reach and is healed there, exactly the way a
   *  player would be -- and it is seen doing it, which is the point. */
  centres?: () => { mapId: string; x: number; y: number }[];
  send: (msg: Msg) => void;
  /** To one seat only. A trainer card staged in every ROM in the room would sit in
   *  six `gEnemyParty`s waiting for a challenge five of them will never get, and the
   *  next real trainer any of them walks into would be wearing it. */
  sendTo?: (seat: number, msg: Msg) => void;
  /** 0..1, the same shape as `Math.random`; seeded by the caller so a match replays. */
  rng: () => number;
}

/** Can this team cross water? One mon that knows SURF is the whole rule, the same as
 *  in the game -- and it is what gets a bot off an island the drop put it on. */
export function canSurf(party: PackedMon[]): boolean {
  return party.some((mon) => mon.moves.some((mv) => mv.id === MOVE_SURF));
}

/** And through a tree? Kanto's bots cut (v0.46.0); ours walked through them, because
 *  the exporter has always marked a cuttable tree as its own class and nothing ever
 *  looked (POK-267).
 *
 *  It answers TRUE for anybody carrying CUT, and a bot is dealt it at the rung -- but
 *  the honest answer for a contestant is that everybody can, because the boot hands
 *  over all eight HMs (POK-256) and the relearner is one menu away (POK-225). What the
 *  move actually buys is the fight: a bot that knows CUT can use it in one. */
/** And over it? A bird dealt FLY at the rung (POK-267). Unlike CUT this one is NOT
 *  something every contestant has -- the HMs are in everybody's bag, but a flight needs
 *  a Pokemon that can carry you, and whether this bot has one is the whole point of the
 *  rule. */
export function canFly(party: PackedMon[]): boolean {
  return party.some((mon) => mon.moves.some((mv) => mv.id === MOVE_FLY));
}

export function canCut(party: PackedMon[]): boolean {
  return party.length === 0 || party.some((mon) => mon.moves.some((mv) => mv.id === MOVE_CUT)) || CONTESTANTS_CARRY_HMS;
}

/** POK-256 gave every contestant the run of Hoenn, HMs included. Named rather than
 *  inlined as `true` so that if that ever stops being so, this is the one place that
 *  has to change -- and the graph keeps modelling a tree as a tree either way. */
const CONTESTANTS_CARRY_HMS = true;

/** The share of the team's health still standing: 1 is untouched, 0 is wiped. */
export function health(party: PackedMon[]): number {
  let hp = 0;
  let max = 0;
  for (const mon of party) {
    hp += mon.hp;
    max += mon.maxHp;
  }
  return max > 0 ? hp / max : 1;
}

/** The team at the new rung. A mon that is already there keeps its place and the
 *  share of its health it had -- a bot does not get healed by the fog closing, and one
 *  that has fainted stays fainted -- and the rest of the roster is whatever the deal
 *  added at this phase. Matched by slot, not by species: the rung is what evolves a
 *  mon (party.ts's grownUp), so a WURMPLE that was hurt is a hurt SILCOON, not a fresh
 *  one. It used to be a fresh one, and every fainted mon came back on 1 HP, so bots
 *  outlived the fog and the fights meant to thin them out. */
function climb(held: PackedMon[], fresh: PackedMon[]): PackedMon[] {
  return fresh.map((next, i) => {
    const mine = held[i];
    if (!mine) return next;
    const share = mine.maxHp > 0 ? mine.hp / mine.maxHp : 1;
    const hp = mine.hp <= 0 ? 0 : Math.max(1, Math.round(next.maxHp * share));
    return { ...next, hp, status: mine.status };
  });
}

export class Bots {
  private readonly walkers: Walker[] = [];
  /** Seats whose fight is running in somebody else's ROM. They stand where they were
   *  challenged until the fight comes back: a bot that strolled off mid-battle is a
   *  ghost walking around while a spectator watches it lose. Keyed by the bot, with
   *  who it is fighting -- a bare set of seats could only be released by a `result`
   *  under the bot's own seat, and the Bridge stamps every result with the player's,
   *  so a bot that won stood frozen for the rest of the match. */
  private readonly fighting = new Map<number, Fight>();
  private nonce = 0;
  private now = 0;
  /** A* nodes left to settle in this tick (NODES_PER_TICK). */
  private budget = 0;
  /** Nothing starts another bot-vs-bot fight before this (POK-273). Room-wide, not
   *  per bot: what needed slowing down was the rate the field eliminated itself at,
   *  and that is a property of the room. */
  private duelAfter = 0;
  /** The ring phase, as the last `ringMoved` left it. The rung a bot falls at is what
   *  its purse is worth (POK-237). */
  private phase = 0;

  constructor(private readonly opts: BotsOptions) {}

  /** Puts the dealt bots on the map and tells the room where they are. */
  start(bots: Bot[], now: number): void {
    for (const bot of bots) {
      const walker: Walker = {
        bot,
        at: { map: bot.mapId, x: bot.x, y: bot.y },
        path: null,
        stepIndex: 0,
        nextStepAt: now + STEP_MS,
        facing: 1,
        engageAfter: 0,
      flyAfter: 0,
        retryAfter: 0,
        bleedAt: now + FOG_TICK_MS,
        home: bot.mapId,
        party: this.opts.deal?.(bot, 0, bot.mapId) ?? [],
        bag: this.opts.bagFor?.(bot, 0) ?? [],
        quaffAfter: 0,
      };
      this.walkers.push(walker);
      this.place(walker);
    }
  }

  count(): number {
    return this.walkers.length;
  }

  /** Where every bot still walking is. For the replay tool, which needs to ask the
   *  question POK-302 is about: at the end of a match, are they inside the last ring? */
  positions(): { seat: number; map: string; x: number; y: number }[] {
    return this.walkers.map((w) => ({ seat: w.bot.seat, map: w.at.map, x: w.at.x, y: w.at.y }));
  }

  /** The pool the bots wander to. It changes once a match: the opening happens in the
   *  Safari Zone (POK-257) and the drop puts everybody out in Hoenn, so every route
   *  chosen against the old pool is abandoned with it. */
  setTargets(targets: { mapId: string; x: number; y: number }[]): void {
    this.opts.targets = targets;
    for (const walker of this.walkers) {
      walker.path = null;
      walker.retryAfter = 0;
    }
  }

  /** Puts a bot somewhere without walking it there, and tells the room -- the drop,
   *  for a bot. A player's ROM warps at the buzzer; this is the same moment. */
  placeAt(seat: number, spot: Spot): void {
    const walker = this.walkers.find((w) => w.bot.seat === seat);

    if (!walker) return;
    walker.at = { ...spot };
    // The drop is where its mons come from from now on: the opening's deal was the
    // Zone's, and the route it lands on is the one it would have caught them on.
    walker.home = spot.map;
    walker.path = null;
    walker.stepIndex = 0;
    walker.retryAfter = 0;
    this.place(walker);
  }

  /** Where a bot is standing right now -- for the engage, and for tests. */
  spotOf(seat: number): Spot | undefined {
    return this.walkers.find((w) => w.bot.seat === seat)?.at;
  }

  /** What a bot is carrying -- for answering a peek, and for the rules that care how
   *  hurt it is. Empty for a seat we do not walk. */
  partyOf(seat: number): PackedMon[] {
    return this.walkers.find((w) => w.bot.seat === seat)?.party ?? [];
  }

  /** The party a fight left behind. The ROM that fought the bot reports it under the
   *  bot's own seat, because it is the only thing that watched the fight happen.
   *  `from` is the seat whose ROM sent it (bots/adapt.ts): a report from anybody but
   *  the bot's own opponent is not about this fight, and is dropped. */
  setParty(seat: number, mons: PackedMon[], from?: number): void {
    const walker = this.walkers.find((w) => w.bot.seat === seat);

    if (!walker || mons.length === 0 || !this.heardFrom(walker, from)) return;
    walker.party = mons;
    // ...and if nothing in it is standing, that fight was the end of this bot. Only
    // the ROM that fought it knows -- it sends the team back under the bot's own seat
    // (POK-238), all of it fainted -- and this took the team and left the bot walking
    // around carrying it: no `out`, no spill, and the play-test's "beating a bot does
    // not drop its items or Pokemon". A bot the fog takes goes out through `bleed`;
    // this is the same ending by the other road.
    if (mons.some((mon) => mon.hp > 0)) {
      // Standing: the fight is over and the bot won it. The party is the one report a
      // ROM always sends when a bot fight ends (br_bot.c, before `spent` and `result`),
      // so it is what lets the bot walk again.
      this.release(seat);
      return;
    }
    this.eliminate(walker);
  }

  /** What the ROM that fought this bot spent out of its bag (POK-237). The units were
   *  handed over on the `trainer` card and are still in the bag until this says
   *  otherwise -- a fight that ended on the first turn spends nothing. */
  noteSpent(seat: number, items: number[], from?: number): void {
    const walker = this.walkers.find((w) => w.bot.seat === seat);

    if (!walker || !this.heardFrom(walker, from)) return;
    spend(walker.bag, items);
  }

  /** Is `from` the ROM that fought this bot last? Undefined is the page speaking for
   *  itself, and a bot this page never saw fight (it was dealt to an old host that
   *  has since gone, POK-252) takes the word of whoever fought it. */
  private heardFrom(walker: Walker, from: number | undefined): boolean {
    return from === undefined || walker.foe === undefined || walker.foe === from;
  }

  /** What a bot has left to spend -- for a test, and for anyone who wants to look. */
  bagOf(seat: number): Stack[] {
    return this.walkers.find((w) => w.bot.seat === seat)?.bag ?? [];
  }

  /** What a bot's bag is worth in cash right now -- the purse it would drop (POK-237),
   *  which is also what a spectator reading its bag is shown (POK-297). */
  moneyOf(seat: number): number {
    const walker = this.walkers.find((w) => w.bot.seat === seat);
    return walker ? purse(this.phase, walker.bot.grade) : 0;
  }

  /** The ring moved. Every route was chosen against the old one, so they are all
   *  suspect: dropping them makes each bot re-aim on its next step. The rung moved
   *  with it (POK-225: the ring phase IS the level), so the teams climb too. */
  ringMoved(phase = 0): void {
    this.phase = phase;
    for (const walker of this.walkers) {
      walker.path = null;
      const fresh = this.opts.deal?.(walker.bot, phase, walker.home);
      if (fresh) walker.party = climb(walker.party, fresh);
      // A trainer still standing at the new rung has restocked (POK-237) -- one
      // potion of the tier it is now on, not a fresh bag, so what it has spent
      // stays spent.
      if (this.opts.bagFor) restock(walker.bag, phase);
    }
  }

  /** A bot is out: it stops walking and stops being spoken for. */
  remove(seat: number): void {
    this.fighting.delete(seat);
    const i = this.walkers.findIndex((w) => w.bot.seat === seat);
    if (i >= 0) this.walkers.splice(i, 1);
  }

  /** A player's ROM challenged this bot (POK-238, the play-test black screen). The
   *  eyeline works both ways, and when the PLAYER is the one who spots the bot the
   *  challenge comes out of their ROM before anything here has staged a team. Their
   *  ROM cannot tell a bot from a person, so without an answer it waits to link with
   *  a seat that has no ROM behind it -- a black screen for the rest of the match.
   *  The card is the answer: it arrives, their parked challenge sees a bot, and it is
   *  an ordinary trainer battle. No `challenge` goes back, because theirs is already
   *  waiting. FALSE when this bot cannot take it (gone, empty, already fighting), in
   *  which case the `busy` already on the wire is what their ROM gives up on. */
  challenged(botSeat: number, playerSeat: number, now = this.now): boolean {
    const walker = this.walkers.find((w) => w.bot.seat === botSeat);

    if (!walker || this.fighting.has(botSeat) || walker.party.length === 0) return false;
    if (this.opts.fights && !this.opts.fights()) return false;
    const card: Msg = { t: 'trainer', seat: botSeat, name: walker.bot.name.slice(0, 7), mons: walker.party };
    const items = battleItems(walker.bag);
    if (items.length > 0) (card as { items?: number[] }).items = items;
    if (this.opts.sendTo) this.opts.sendTo(playerSeat, card);
    else this.opts.send(card);
    this.note(walker, 'engage', `seat ${playerSeat} (theirs)`);
    this.opts.onEngage?.(botSeat, playerSeat);
    this.hold(walker, playerSeat, now);
    walker.engageAfter = now + cooldownFor(walker.bot);
    return true;
  }

  /** A fight has ended -- the `result` the ROM that ran it sends. The Bridge stamps a
   *  ROM's messages with its own seat, so the result the ROM wrote under the bot's
   *  seat arrives under the player's: either one names the fight. `from` is the seat
   *  whose ROM said so, and only the bot's opponent can end its fight this way. */
  noteResult(seat: number, from?: number): void {
    for (const [bot, fight] of [...this.fighting]) {
      if (fight.proxy) continue; // no ROM runs a proxy duel, so no ROM reports on one
      if (bot !== seat && fight.opponent !== seat) continue;
      if (from !== undefined && from !== fight.opponent) continue;
      this.release(bot);
    }
  }

  /** Stands a bot still for a fight that is running somewhere else, and tells the room
   *  it is busy so nothing else engages it meanwhile. */
  private hold(walker: Walker, opponent: number, now: number, proxy?: () => void): Fight {
    const fight: Fight = { opponent, since: now, started: proxy !== undefined, proxy };

    this.fighting.set(walker.bot.seat, fight);
    walker.foe = opponent;
    walker.path = null;
    this.opts.send({ t: 'busy', seat: walker.bot.seat, kind: 'battle' });
    return fight;
  }

  /** Lets a fight go, however it ended: the bot is back on the map, after the grace
   *  the ROM keeps after a fight (BR_ENGAGE_GRACE) so it does not turn straight round
   *  on whoever is still standing in front of it. */
  private release(seat: number): void {
    if (!this.fighting.delete(seat)) return;
    this.opts.send({ t: 'busy', seat });
    const walker = this.walkers.find((w) => w.bot.seat === seat);
    if (walker) walker.engageAfter = Math.max(walker.engageAfter, this.now + cooldownFor(walker.bot));
  }

  /** The fights nobody is going to report on: an opponent who has gone (out, or out of
   *  the room), a fight that never started, and -- the backstop -- one that has simply
   *  run too long. A proxy duel past its time is settled by the seeded resolver. */
  private expireFights(now: number): void {
    if (this.fighting.size === 0) return;
    const players = this.opts.engage?.players();
    const field = players ? new Map(players.map((p) => [p.seat, p])) : undefined;
    for (const [seat, fight] of [...this.fighting]) {
      if (this.fighting.get(seat) !== fight) continue; // a proxy pair goes both at once
      if (fight.proxy) {
        if (now - fight.since > PROXY_TIMEOUT_MS) fight.proxy();
        continue;
      }
      const them = field?.get(fight.opponent);
      if (them?.busy) fight.started = true;
      if (field && !them) this.release(seat);
      else if (!fight.started && now - fight.since > FIGHT_START_MS) this.release(seat);
      else if (now - fight.since > FIGHT_TIMEOUT_MS) this.release(seat);
    }
  }

  /** Runs every bot up to `now`. Called as often as the host likes -- the pace is in
   *  here, not in the caller, so a slow frame makes bots catch up rather than crawl. */
  tick(now: number): void {
    this.now = now;
    this.budget = NODES_PER_TICK;
    this.expireFights(now);
    // Both loops walk a snapshot: the fog and a lost duel both take a bot out of the
    // list mid-pass, and splicing the array being iterated skips whoever came next.
    for (const walker of this.walkers.slice()) {
      this.bleed(walker, now);
    }
    for (const walker of this.walkers.slice()) {
      if (!this.walkers.includes(walker)) continue;
      // At most a few steps a tick: a tab that was backgrounded for a minute should
      // not teleport its bots across Hoenn when it comes back.
      let budget = 4;
      while (walker.nextStepAt <= now && budget-- > 0) {
        walker.nextStepAt += STEP_MS;
        this.stepOne(walker, now);
      }
      if (walker.nextStepAt < now) walker.nextStepAt = now + STEP_MS;
    }
  }

  /** The fog, on a bot. Outside the ring it loses a tenth of each mon every four
   *  seconds, and when the whole team is down it is out -- through `out`, the same
   *  message a player's ROM sends, so the Director counts it the same way. */
  private bleed(walker: Walker, now: number): void {
    const inside = this.opts.inside;
    if (!inside || walker.party.length === 0) return;
    // Nor while it is fighting (POK-262). The ROM's own fog never reaches a fight
    // between contestants (FogReachesThisBattle in br_ring.c: "theirs to lose"), and a
    // bot is one: in the last ring, where everywhere is fog, the page used to wipe a
    // bot mid-battle, its `out` could hand the room a `win` while the player was still
    // fighting it -- and a player who then lost that battle still got the Hall of Fame.
    if (inside(walker.at.map) || this.fighting.has(walker.bot.seat)) {
      walker.bleedAt = now + FOG_TICK_MS;
      return;
    }
    if (now < walker.bleedAt) return;
    // The next bite is due a fixed four seconds after the last one was DUE, not after
    // it happened: a tick never lands exactly on the beat, and `now + FOG_TICK_MS`
    // pushed the whole schedule later every time -- so a bot outside the ring bled
    // slightly slower than the ROM bleeds a player, and by more the slower the tick.
    walker.bleedAt += FOG_TICK_MS;
    if (walker.bleedAt <= now) walker.bleedAt = now + FOG_TICK_MS; // a long stall: start over
    let standing = 0;
    walker.party = walker.party.map((mon) => {
      if (mon.hp === 0) return mon;
      const hp = Math.max(0, mon.hp - Math.max(1, Math.floor(mon.maxHp / FOG_BITE)));
      if (hp > 0) standing++;
      return { ...mon, hp };
    });
    if (standing > 0) return;
    this.note(walker, 'fog');
    this.eliminate(walker);
  }

  /** A bot is finished. Everything it was carrying hits the ground where it fell --
   *  the same `spill` a player's ROM sends on a whiteout (POK-232), so the balls are
   *  pickable by anybody -- and then it is out and stops being walked around. */
  private eliminate(walker: Walker): void {
    const map = this.opts.mapRef(walker.at.map);
    if (map && walker.party.length > 0) {
      // Scattered, not stacked. Every piece used to be written to the dropper's own
      // cell -- which is ONE visible ball (BrLoot_At returns the first row it matches)
      // with the rest of the team underneath it and the bag under those, so a beaten bot
      // looked like it dropped a single Pokemon and no bag at all. The ROM has always
      // scattered its own spill; this is the same ring, in the same order.
      const party = walker.party.slice(0, 6);
      const cells = spillCells(this.opts.world, walker.at.map, walker.at.x, walker.at.y, party.length + 1);
      const spill: SpillMsg = {
        t: 'spill',
        seat: walker.bot.seat,
        map,
        // The ROM's key convention: the dropper's seat in the high byte, so keys never
        // collide between trainers (br_loot.c).
        mons: party.slice(0, cells.length).map((mon, i) => ({
          key: ((walker.bot.seat & 0xff) << 8) | i,
          x: cells[i].x,
          y: cells[i].y,
          species: mon.species,
          level: mon.level,
        })),
      };
      // And its bag, which is the point of it having had one (POK-237): the X ATTACKs
      // it did not get to pop are lying there for whoever beat it. Key 0xFF is the
      // ROM's own for a whiteout's bag (br_loot.c), clear of the mons' 0..5.
      // The bag takes the cell after the team's. Nowhere left to put it means no bag
      // rather than a bag nobody can reach: a piece sharing a cell with another is a
      // piece that does not exist.
      if (walker.bag.length > 0 && cells.length > party.length) {
        spill.bag = {
          key: ((walker.bot.seat & 0xff) << 8) | 0xff,
          x: cells[party.length].x,
          y: cells[party.length].y,
          items: walker.bag.map((stack) => ({ ...stack })),
          money: purse(this.phase, walker.bot.grade),
          name: walker.bot.name.slice(0, 7),
        };
      }
      this.opts.send(spill);
    }
    this.opts.send({ t: 'out', seat: walker.bot.seat });
    this.remove(walker.bot.seat);
  }

  private stepOne(walker: Walker, now: number): void {
    this.now = now;
    if (this.fighting.has(walker.bot.seat)) return;
    // At the counter: the nurse is the turn spent, and the bot walks back out whole.
    if (this.healHere(walker)) return;
    // The eyeline outranks everything: a bot that can see a player fights them, the
    // same way walking into one in the ROM does. It is checked before the step, on
    // where the bot is standing, because that is the position the room was told.
    if (this.tryEngage(walker, now)) return;
    // Loot at your feet, before anything else: a bot standing on a ball takes it, and
    // that is the turn spent.
    const here = this.opts.loot?.at(walker.at.map, pageCell(walker.at.x, walker.at.y));
    if (here !== undefined) {
      // A bag on the ground gives up one item per press -- the ROM's own rule -- so
      // the pickup names what was taken and the rest stays there (POK-237).
      const item = this.opts.loot?.bagAt?.(here);
      if (item !== undefined) {
        this.opts.send({ t: 'pickup', seat: walker.bot.seat, key: here, item });
        mergeBag(walker.bag, [{ id: item, n: 1 }]);
        this.note(walker, 'pickup', `item ${item}`);
      } else {
        this.opts.send({ t: 'pickup', seat: walker.bot.seat, key: here });
        this.note(walker, 'pickup', `key ${here}`);
      }
      walker.path = null;
      return;
    }
    if (!walker.path || walker.stepIndex >= walker.path.steps.length) {
      // A walked route is dropped before the next is chosen: chooseTarget has ways out
      // that set none (a ring with no landing cell left in it), and the old one read
      // past its last step every tick after.
      walker.path = null as Walker['path']; // widened: chooseTarget sets it
      this.chooseTarget(walker, now);
      if (!walker.path || walker.path.steps.length === 0) return;
    }
    const step = walker.path.steps[walker.stepIndex];
    // Somebody is already standing there. Two trainers never share a tile, and a pair
    // that swap through each other read as walking through a wall to anyone watching.
    // Drop the route and re-aim next step rather than shove.
    if (this.taken(step.to, walker) || this.swapping(walker, step.to)) {
      walker.path = null;
      return;
    }
    walker.stepIndex++;
    const wasMap = walker.at.map;
    walker.at = step.to;
    walker.facing = DIR_WIRE[step.dir];
    if (step.to.map !== wasMap) {
      // A new map is a `place`, not a `step`: the receiving ROM has to move the ghost
      // wholesale rather than animate it across a seam it cannot see.
      this.place(walker);
      return;
    }
    const map = this.opts.mapRef(walker.at.map);
    if (!map) return;
    this.opts.send({
      t: 'step',
      seat: walker.bot.seat,
      d: walker.facing,
      map,
      x: walker.at.x,
      y: walker.at.y,
    });
  }

  /** Is anybody in this bot's eyeline? If so, stage its party and challenge them --
   *  `trainer` then `challenge`, because the ROM has to have the team in hand before
   *  the challenge that starts the battle arrives. TRUE when it spent the step. */
  private tryEngage(walker: Walker, now: number): boolean {
    const engage = this.opts.engage;
    if (this.opts.fights && !this.opts.fights()) return false;
    if (now < walker.engageAfter) return false;
    const map = this.opts.mapRef(walker.at.map);
    if (!map) return false;
    const mine: Look = { map: walker.at.map, x: walker.at.x, y: walker.at.y, dir: walker.facing };
    for (const player of engage?.players() ?? []) {
      if (player.busy || player.mapId !== walker.at.map) continue;
      const theirs: Look = { map: player.mapId, x: player.x, y: player.y, dir: player.dir };
      if (!eitherSees(this.opts.world, mine, theirs)) continue;
      const mons = walker.party;
      if (mons.length === 0) return false;
      // PLAYER_NAME_LENGTH is 7: a HUD name may be longer, a trainer card may not.
      const name = walker.bot.name.slice(0, 7);
      // What it may spend in there, out of the bag it is actually carrying (POK-237).
      // Held rather than deducted: the ROM says which of them it used when the fight
      // is over, and one that ends on the first turn spends nothing.
      const items = battleItems(walker.bag);
      const card: Msg = { t: 'trainer', seat: walker.bot.seat, name, mons };
      if (items.length > 0) (card as { items?: number[] }).items = items;
      if (this.opts.sendTo) this.opts.sendTo(player.seat, card);
      else this.opts.send(card);
      this.nonce = (this.nonce + 1) & 0xffff;
      this.opts.send({
        t: 'challenge',
        seat: walker.bot.seat,
        opponent: player.seat,
        nonce: this.nonce,
      });
      this.note(walker, 'engage', `seat ${player.seat}`);
      this.opts.onEngage?.(walker.bot.seat, player.seat);
      this.hold(walker, player.seat, now);
      walker.engageAfter = now + cooldownFor(walker.bot);
      return true;
    }
    // Nobody to fight but each other. A bot that can see another bot settles it
    // (POK-238's resolver; the proxy emulator replaces this with a real battle).
    return this.tryDuel(walker, now, mine);
  }

  /** Two bots in each other's eyeline. The loser is out and drops what it carried;
   *  the winner walks on hurt, which is what makes the next fight interesting. */
  private tryDuel(walker: Walker, now: number, mine: Look): boolean {
    if (this.opts.seed === undefined || walker.party.length === 0) return false;
    // One meeting at a time, room-wide, which is Kanto's rule (`BR:tickBotDuels`
    // starts one approach and returns). Ours ran the whole pair list every tick, so
    // the elimination rate went up with the SQUARE of the field: every pair that could
    // see each other fought, and a full room was decided before the first ring moved.
    if (now < this.duelAfter) return false;
    for (const other of this.walkers) {
      if (other === walker || now < other.engageAfter) continue;
      if (this.fighting.has(other.bot.seat) || other.party.length === 0) continue;
      const theirs: Look = { map: other.at.map, x: other.at.x, y: other.at.y, dir: other.facing };
      if (!eitherSees(this.opts.world, mine, theirs)) continue;
      this.nonce = (this.nonce + 1) & 0xffff;
      this.duelAfter = now + DUEL_COOLDOWN_MS;
      // For real, in the hidden instance, when the host has one (POK-238). Both bots
      // stand where they are while it runs -- the same thing that happens to one
      // fighting a player -- and the seeded resolver is the answer if it cannot.
      if (this.opts.settle) {
        this.startProxyDuel(walker, other, now);
        return true;
      }
      const result = duel(
        this.opts.seed,
        { seat: walker.bot.seat, party: walker.party },
        { seat: other.bot.seat, party: other.party },
        this.nonce,
      );
      return this.applyDuel(walker, other, result, now);
    }
    return false;
  }

  /** One duel's outcome, whoever worked it out: the winner keeps what it has left, the
   *  loser goes. TRUE when the bot whose step this was is the one that went. */
  private applyDuel(walker: Walker, other: Walker, result: DuelResult, now: number): boolean {
    const won = result.winner === walker.bot.seat ? walker : other;
    const lost = won === walker ? other : walker;

    won.party = result.winnerParty;
    // A winner that turns straight round is how a queue of fights starts: Kanto gives
    // it twelve seconds, whatever its grade says about appetite (POK-273).
    won.engageAfter = now + Math.max(cooldownFor(won.bot), DUEL_COOLDOWN_MS);
    this.note(walker, 'duel', `${result.winner} beat ${result.loser}`);
    this.opts.onDuel?.(result.winner, result.loser);
    this.eliminate(lost);
    return lost === walker;
  }

  /** Hands the pair to the proxy and waits. Both are held as fighting meanwhile, so
   *  nothing engages them and the room sees them busy -- a bot strolling off while its
   *  own battle runs somewhere else is the bug POK-238's bot-vs-player half already
   *  had to fix. */
  private startProxyDuel(walker: Walker, other: Walker, now: number): void {
    const settle = this.opts.settle;
    const seed = this.opts.seed ?? 0;
    const nonce = this.nonce;
    if (!settle) return;

    const resolve = () =>
      duel(seed, { seat: walker.bot.seat, party: walker.party }, { seat: other.bot.seat, party: other.party }, nonce);
    // Lets the pair go, and says whether this duel is still theirs to settle. Not when
    // the backstop has already settled it, and not when the room has been told one of
    // them is out meanwhile -- the one still standing just walks on. The fog is not
    // one of those: it leaves a fight alone (bleed), so a duel it used to cancel by
    // taking a bot out of the instance's hands now runs to its end.
    const finish = (): boolean => {
      const live = held.filter(([w, fight]) => this.fighting.get(w.bot.seat) === fight);
      for (const [w] of live) this.release(w.bot.seat);
      return live.length === 2 && this.walkers.includes(walker) && this.walkers.includes(other);
    };
    // An instance that never answers -- crashed, stalled, a tab that stopped drawing --
    // costs the room a real fight, not two bots frozen for the rest of the match.
    const expire = () => {
      if (finish()) this.applyDuel(walker, other, resolve(), this.now);
    };
    const held = [walker, other].map(
      (w) => [w, this.hold(w, (w === walker ? other : walker).bot.seat, now, expire)] as const,
    );
    // Both bags go in with them (POK-237): what a bot spends in here is gone from the
    // bag it will take into its next fight, the same as a fight against a player.
    void settle(
      { seat: walker.bot.seat, party: walker.party, items: battleItems(walker.bag) },
      { seat: other.bot.seat, party: other.party, items: battleItems(other.bag) },
    )
      .catch(() => null)
      .then((out) => {
        const then = this.now;
        if (!finish()) return;
        if (out) {
          const wonIsWalker = out.winner === walker.bot.seat;
          const left = wonIsWalker ? out.a : out.b;
          const winner = wonIsWalker ? walker : other;

          spend(walker.bag, out.usedA ?? []);
          spend(other.bag, out.usedB ?? []);

          this.applyDuel(walker, other, {
            winner: out.winner,
            loser: out.loser,
            // What the fight actually left, mon for mon, in the order it was sent.
            winnerParty: winner.party.map((mon, i) =>
              left[i] ? { ...mon, hp: Math.min(mon.maxHp, left[i].hp), status: left[i].status } : mon,
            ),
          }, then);
          return;
        }
        this.applyDuel(walker, other, resolve(), then);
      });
  }

  /** Standing at a nurse's counter with something to heal. The page is the bot's
   *  whole world, so this is the heal -- there is no ROM to run the script in. */
  private healHere(walker: Walker): boolean {
    const centres = this.opts.centres?.();
    if (!centres || health(walker.party) >= 1) return false;
    // A Centre in the fog is shut -- that is the ROM's own rule (the nurse says so;
    // see tools/br/drivers/nurse.txt), and without it here a bot in the late ring
    // heals faster than the fog bleeds and the match can never end.
    if (this.opts.inside && !this.opts.inside(walker.at.map)) return false;
    if (!centres.some((c) => c.mapId === walker.at.map && c.x === walker.at.x && c.y === walker.at.y))
      return false;
    walker.party = walker.party.map((mon) => ({ ...mon, hp: mon.maxHp, status: 0 }));
    walker.path = null;
    this.note(walker, 'heal');
    return true;
  }

  /** A drink from its own bag (POK-237, Kanto's Bots.quaff). Silent -- there is no
   *  animation for a bot doing this and nobody is watching it happen -- but it is
   *  spent out of the same inventory the fight draws on, so a bot that drank its way
   *  across Hoenn arrives at the buzzer with nothing to pop. */
  private tryQuaff(walker: Walker, now: number): boolean {
    if (walker.bag.length === 0 || walker.party.length === 0) return false;
    if (now < walker.quaffAfter) return false;
    // Not in the fog -- the same rule that shuts the nurse out there (healHere). The
    // fog is not damage a potion is an answer to, it is the thing that ends the match,
    // and a bot sipping its way through it outlives the ring: the replay had one
    // wander the burning half of Hoenn for six extra minutes on a bag of POTIONs.
    if (this.opts.inside && !this.opts.inside(walker.at.map)) return false;
    const drunk = quaff(walker.party, walker.bag);

    if (drunk === null) return false;
    walker.quaffAfter = now + QUAFF_COOLDOWN_MS;
    this.note(walker, 'quaff', `item ${drunk}`);
    return true;
  }

  /** Under half health, with a Centre in reach. Returns a route to the counter, or
   *  null to leave the bot to the rest of the list. */
  private centreRoute(walker: Walker): Path | null {
    const centres = (this.opts.centres?.() ?? []).filter(
      (c) => !this.opts.inside || this.opts.inside(c.mapId),
    );
    if (centres.length === 0 || health(walker.party) >= HURT) return null;
    // The one you are standing in first -- that is the door you just walked through --
    // then the one belonging to this town. A Centre three sections away is not worth
    // the match it would take to reach, and A* would pay for the search to find out.
    const section = this.opts.world.map(walker.at.map)?.section;
    const here = centres.filter((c) => c.mapId === walker.at.map);
    const town = centres.filter(
      (c) => c.mapId !== walker.at.map && this.opts.world.map(c.mapId)?.section === section,
    );
    for (const c of [...here, ...town]) {
      const path = this.route(walker, { map: c.mapId, x: c.x, y: c.y }, CENTRE_BUDGET);
      if (path.found) return path;
    }
    return null;
  }

  /** The flight (POK-267, Kanto v0.46.0/v0.49.0). A bird that knows FLY does not walk
   *  out of the fog -- it goes, the way a player would, and appears where it landed.
   *
   *  It is deliberately only ever used to get INSIDE the ring. Flying to loot or to a
   *  fight would make a bot that owns a Taillow a different game from one that does
   *  not; flying out of the fog is the thing the move is for, and the thing a player
   *  with FLY would do at exactly that moment.
   */
  private tryFly(walker: Walker, now: number): boolean {
    const inside = this.opts.inside;

    if (!inside || inside(walker.at.map)) return false; // not in the fog: nothing to flee
    if (now < walker.flyAfter || !canFly(walker.party)) return false;
    const home = this.opts.targets.filter((t) => inside(t.mapId));
    if (home.length === 0) return false;
    const to = home[Math.floor(this.opts.rng() * home.length)];

    walker.flyAfter = now + FLY_COOLDOWN_MS;
    walker.at = { map: to.mapId, x: to.x, y: to.y };
    walker.path = null;
    walker.stepIndex = 0;
    this.place(walker);
    this.note(walker, 'fly', `${to.mapId} ${to.x},${to.y}`);
    return true;
  }

  private chooseTarget(walker: Walker, now: number): void {
    const inside = this.opts.inside;
    // Out of the fog the fast way, if this one can (POK-267).
    if (this.tryFly(walker, now)) return;
    if (now < walker.retryAfter) {
      this.wanderOneStep(walker);
      return;
    }
    // Somebody else already did the thinking this tick. Take a step and ask again --
    // standing still would be visible, and so would eight A* runs in one frame.
    if (this.budget <= 0) {
      this.wanderOneStep(walker, 'wait');
      return;
    }
    // Centre when hurt, third on Kanto's list -- after the fog and the ball at your
    // feet, before going anywhere else. A bot walks in, gets healed, walks out.
    const centre = this.centreRoute(walker);
    if (centre) {
      walker.path = centre;
      walker.stepIndex = 0;
      this.note(walker, 'centre', `${Math.round(health(walker.party) * 100)}% hp`);
      return;
    }
    // No nurse in reach, so the bag (POK-237, Kanto's rule at main.lua's goal pick):
    // one sip when it stops to think, and only where the nurse is not an option --
    // she is free and heals everything, and the potions keep for the road. It is not
    // the errand itself: the bot drinks and then goes wherever it was going.
    this.tryQuaff(walker, now);
    // What it can walk to without leaving this map (POK-331 #27). A lake or a wood cuts
    // Route 104 and Route 103 in two, and a piece or a cell on the far side was a search
    // that settled all of this side before it gave up -- every time the bot stopped to
    // think, and out of the whole roster's budget.
    const reach = this.opts.world.reachOnMap(walker.at, canSurf(walker.party), canCut(walker.party));
    // Fog first. Aiming only at cells inside the ring is the whole rule: a bot already
    // inside wanders inside, and a bot caught outside walks in, because the route to
    // anywhere it may aim at crosses the edge on the way.
    // Loot in the ring beats wandering: a bot goes and gets it. Nearest first only
    // among the pieces on its own map -- distances across a seam are not comparable,
    // and a bot that crosses one will see that map's loot when it gets there.
    const loot = (this.opts.loot?.all() ?? [])
      .filter((l) => (!inside || inside(l.mapId)) && l.mapId === walker.at.map && reach.cell(l.x, l.y))
      .sort(
        (a, b) =>
          Math.abs(a.x - walker.at.x) + Math.abs(a.y - walker.at.y) -
          (Math.abs(b.x - walker.at.x) + Math.abs(b.y - walker.at.y)),
      );
    for (const piece of loot.slice(0, 2)) {
      const path = this.route(walker, { map: piece.mapId, x: piece.x, y: piece.y }, WANDER_BUDGET);
      if (path.found && path.steps.length > 0) {
        walker.path = path;
        walker.stepIndex = 0;
        this.note(walker, 'loot', `key ${piece.key}`);
        return;
      }
    }
    // Hunt when the field is down to a few. A player's own cell is the target, so
    // the route ends in somebody's eyeline whether or not they are looking.
    if ((this.opts.alive?.() ?? 99) <= HUNT_AT) {
      for (const player of this.opts.engage?.players() ?? []) {
        if (player.busy) continue;
        const path = this.route(walker, { map: player.mapId, x: player.x, y: player.y }, WANDER_BUDGET);
        if (path.found && path.steps.length > 0) {
          walker.path = path;
          walker.stepIndex = 0;
          this.note(walker, 'hunt', `seat ${player.seat}`);
          return;
        }
      }
    }
    const targets = inside ? this.opts.targets.filter((t) => inside(t.mapId)) : this.opts.targets;
    if (targets.length === 0) return;
    // Somewhere else on the map is a cell search. Somewhere else in HOENN is not
    // (POK-302): a single A* to a cell on Verdanturf from Littleroot settles about
    // 8,800 nodes against a budget of 1,500, so it fails -- every time, for 90% of the
    // drop cells -- and the bot falls through to a random step it then repeats for the
    // rest of the match. Four bots alive and none of them able to compute a step toward
    // the last ring is what a live play-test looked like.
    //
    // So the route is two questions, which is how Kanto has always done it (lib/bots.lua
    // exits/homeward for the maps, then a BFS bounded to the current one). Pick the map
    // to head for, then walk over the edge, or through the door, that leads there: a
    // search that never leaves this map but for that last step, and never costs more
    // than a few hundred nodes.
    //
    // Somewhere else, on foot -- and somewhere else NEAR, first. Hoenn is 500 maps
    // wide and the landing pool spans all of it, so a target drawn uniformly is
    // almost always past the A* budget: the replay tool had bots failing to route
    // 94% of the time, standing still while they did it. Own map, then the next map
    // over, then own section, then anywhere, so the cheap pick is also the one a
    // trainer would make.
    //
    // The next map over comes after this map's own pick, when it has one (POK-330 #49
    // review). It came first while its route stopped short on the edge, which only ever
    // walked a bot to the edge and back; a route that crosses, asked first, sends a bot
    // to the next map and straight back, a seam apart, all match.
    //
    // "Anywhere" mostly fails, at its full budget, but not always: the ones that land
    // are a map or two over, found when this map's pick and the ladder both came up
    // empty. Without them the fog takes more bots (POK-330 #49: 10 fog outs against 7
    // over six thirty-bot replays, and 2,784 stuck steps against 1,763), so they stay,
    // paid for out of the tick's node budget like everything else.
    //
    // This map's own cells are the ones it can walk to without leaving it (POK-331 #27):
    // a bot with none on its side of the water goes to the ladder first, which is how it
    // gets round.
    const section = this.opts.world.map(walker.at.map)?.section;
    const mine = (t: { mapId: string }) => t.mapId === walker.at.map;
    const pools = [
      targets.filter((t) => mine(t) && reach.cell(t.x, t.y)),
      targets.filter((t) => !mine(t) && this.opts.world.map(t.mapId)?.section === section),
      targets.filter((t) => !mine(t) || reach.cell(t.x, t.y)),
    ].filter((pool) => pool.length > 0);
    // The ladder's turn: after this map's own pick, when there is one to make.
    const crossAt = pools.length > 0 && mine(pools[0][0]) ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      if (i === crossAt && this.aimAcrossMaps(walker, targets, now)) return;
      if (pools.length === 0) break;
      const pool = pools[Math.min(i, pools.length - 1)];
      const pick = pool[Math.floor(this.opts.rng() * pool.length)];
      const to: Spot = { map: pick.mapId, x: pick.x, y: pick.y };
      if (sameSpot(to, walker.at)) continue;
      const path = this.route(walker, to, WANDER_BUDGET);
      if (path.found && path.steps.length > 0) {
        walker.path = path;
        walker.stepIndex = 0;
        walker.retryAfter = 0;
        this.note(walker, 'wander', `${pick.mapId} ${pick.x},${pick.y}`);
        return;
      }
    }
    // Nowhere it can route to. A bot that stands perfectly still for the rest of the
    // match reads as broken, so it takes one step somewhere legal -- which is usually
    // enough to get off whatever cell was the problem -- and holds off searching again
    // until the backoff is up.
    walker.retryAfter = now + RETRY_MS;
    this.wanderOneStep(walker);
  }

  /** findPath from where the bot stands, paid for out of the tick's budget. */
  private route(walker: Walker, to: Spot, cap: number): Path {
    const path = findPath(this.opts.world, walker.at, to, cap, canSurf(walker.party), canCut(walker.party));
    this.budget -= path.visited;
    return path;
  }

  /** Head for a target on ANOTHER map by walking over the edge, or through the door,
   *  that leads towards it. True when it set a path. The goal map is the one the most
   *  targets are on, which for a closing ring is the ring's own section -- so the whole
   *  roster converges without anybody searching across Hoenn. */
  private aimAcrossMaps(walker: Walker, targets: { mapId: string; x: number; y: number }[], now: number): boolean {
    const world = this.opts.world;
    const surf = canSurf(walker.party);
    const cut = canCut(walker.party);
    // The most-wanted map that is not this one, and that we can actually get to.
    const wanted = new Map<string, number>();
    for (const t of targets) {
      if (t.mapId === walker.at.map) continue;
      wanted.set(t.mapId, (wanted.get(t.mapId) ?? 0) + 1);
    }
    const goals = [...wanted.entries()]
      .map(([mapId, n]) => ({ mapId, n, hops: world.hops(walker.at.map, mapId, surf, cut) }))
      .filter((g) => g.hops !== undefined && g.hops > 0)
      .sort((a, b) => a.hops! - b.hops! || b.n - a.n);
    if (goals.length === 0) return false;

    // Kanto's ladder (main.lua:3380): the best next map, then the next best, then any --
    // "any seam beats standing still". Only when every one of them is unreachable from
    // where we stand does this give up and let the caller take its one random step.
    // Goal maps in one direction share their crossing, and a crossing that failed for
    // the first fails the same way for the rest -- same start, same goals, same budget --
    // so it is searched once (POK-330 #49): a stuck bot paid for it three times.
    //
    // The crossing is the first of the way there region by region (POK-331 #27): the
    // plan's next map when this side of the water can get to it, and the way round when
    // it cannot -- Route 104's north half to Petalburg is through the wood. It is not paid
    // for out of the node budget: each region is flooded once for the tab, and the search
    // over them settles a few dozen -- a couple of hundred at the most, the long way round.
    const tried = new Set<string>();
    for (const goal of goals.slice(0, GOAL_TRIES)) {
      // Where the crossing comes out, not the edge or door it starts from, so the route
      // takes the step over: a door is never a cell a route can end on, and a bot already
      // on the edge would be "there" with nowhere to walk (POK-330 #49 review).
      // ...and ends in a part of the goal map with a target in reach: a pocket off its
      // edge is on the map, and nowhere to arrive.
      const there = targets.filter((t) => t.mapId === goal.mapId);
      const over = world.firstCrossing(walker.at, goal.mapId, surf, cut, (reach) => there.some((t) => reach.cell(t.x, t.y)));
      if (!over || over.length === 0) continue;
      const asked = spotKey(over[0]);
      if (tried.has(asked)) continue;
      tried.add(asked);
      const path = findPathToAny(world, walker.at, over, HOP_BUDGET, surf, cut);
      this.budget -= path.visited;
      if (!path.found || path.steps.length === 0) continue;
      walker.path = path;
      walker.stepIndex = 0;
      walker.retryAfter = 0;
      this.note(walker, 'wander', `-> ${over[0].map} (for ${goal.mapId})`);
      return true;
    }
    return false;
  }

  /** One legal step. The fallback when there is nothing to route to -- or, as 'wait',
   *  when the tick's thinking budget went to another bot.
   *
   *  Greedy rather than uniform: among the legal steps, prefer one that does not take us
   *  further from where the targets are. A uniformly random step repeated every two
   *  seconds is a random walk, and a random walk does not cross Hoenn -- it is what the
   *  bots were doing for the whole back half of a match (POK-302). */
  private wanderOneStep(walker: Walker, why: 'stuck' | 'wait' = 'stuck'): void {
    const surf = canSurf(walker.party);
    const cut = canCut(walker.party);
    const open = this.opts.world.neighbours(walker.at, surf, cut);
    if (open.length === 0) {
      this.note(walker, why);
      walker.path = null;
      return;
    }
    const goal = this.driftGoal(walker, surf, cut);
    const closer = goal === undefined ? [] : open.filter((o) => {
      const here = this.opts.world.hops(walker.at.map, goal, surf, cut);
      const there = this.opts.world.hops(o.to.map, goal, surf, cut);
      return there !== undefined && (here === undefined || there <= here);
    });
    const pick = closer.length > 0 ? closer : open;
    const step = pick[Math.floor(this.opts.rng() * pick.length)];
    walker.path = { steps: [step], found: true, visited: 0 };
    walker.stepIndex = 0;
    this.note(walker, why, step.dir);
  }

  /** The map a stuck bot should drift towards: whichever target INSIDE the ring is
   *  fewest map crossings away -- the same targets chooseTarget aims at. Undefined when
   *  there are none, none reachable, or one is on this very map.
   *
   *  It used to read the whole landing pool, ring or no ring (POK-330 #41): a stuck
   *  bot on any map with a landing cell took uniform random steps even in the fog,
   *  and anywhere else drifted towards the nearest landing map whichever side of the
   *  ring it was on. */
  private driftGoal(walker: Walker, surf: boolean, cut: boolean): string | undefined {
    const inside = this.opts.inside;
    const seen = new Set<string>();
    let best: string | undefined;
    let bestHops = Infinity;
    for (const t of this.opts.targets) {
      // One question a map, not one a cell: the pool is hundreds of cells on a couple
      // of dozen maps, and this runs for every bot waiting its turn to think.
      if (seen.has(t.mapId)) continue;
      seen.add(t.mapId);
      if (inside && !inside(t.mapId)) continue;
      if (t.mapId === walker.at.map) return undefined; // already where the targets are
      const h = this.opts.world.hops(walker.at.map, t.mapId, surf, cut);
      if (h !== undefined && h < bestHops) {
        bestHops = h;
        best = t.mapId;
      }
    }
    return best;
  }

  /** Is another bot standing here? */
  private taken(spot: Spot, self: Walker): boolean {
    return this.walkers.some((w) => w !== self && sameSpot(w.at, spot));
  }

  /** Would this step trade places with a bot walking the other way? Neither of them
   *  has moved yet this tick, so the cell it wants is still the other one's. */
  private swapping(self: Walker, to: Spot): boolean {
    for (const other of this.walkers) {
      if (other === self || !sameSpot(other.at, to)) continue;
      const next = other.path?.steps[other.stepIndex]?.to;
      if (next && sameSpot(next, self.at)) return true;
    }
    return false;
  }

  private note(walker: Walker, rule: Decision['rule'], detail?: string): void {
    this.opts.onDecision?.({ at: this.now, seat: walker.bot.seat, rule, spot: walker.at, detail });
  }

  private place(walker: Walker): void {
    const map = this.opts.mapRef(walker.at.map);
    if (!map) return;
    this.opts.send({
      t: 'place',
      v: PROTOCOL,
      seat: walker.bot.seat,
      map,
      x: walker.at.x,
      y: walker.at.y,
      f: walker.facing,
      st: 'alive',
      sprite: String(walker.bot.skin),
    });
  }
}
