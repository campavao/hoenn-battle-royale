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
import { findPath, type Path } from './path';
import { eitherSees, type Facing, type Look } from './sight';
import { Grade, type Bot } from './roster';
import { MOVE_CUT, MOVE_FLY, MOVE_SURF } from './party';
import { battleItems, merge as mergeBag, purse, quaff, restock, spend, type Stack } from './bag';
import { duel, type DuelResult } from './duel';
import { sameSpot, type SeamDir, type Spot, type World } from './world';
import { PROTOCOL, type MapRef, type Msg, type PackedMon, type SpillMsg } from '../net/wire';

/** Kanto's pace: four tiles a second, whatever the host's tab is doing. */
export const STEP_MS = 250;
/** How far a bot will look for its next wander target before settling for less. */
const WANDER_BUDGET = 1500;
/** BR_ENGAGE_GRACE in src/br/br_engage.c: 120 frames, and a frame is a sixtieth. */
const ENGAGE_COOLDOWN_MS = 2000;
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
/** How many route searches the whole roster may do in one tick. A* over Hoenn is the
 *  expensive thing here, and eight bots deciding at once is eight of them in one main
 *  thread task -- measured at 159 ms on a CPU throttled to phone speed, which is a
 *  visible hitch in a game running at 60. Whoever misses out keeps walking the route
 *  they had, or waits a tick: at four tiles a second nobody can see the difference. */
const SEARCHES_PER_TICK = 2;
/** BR_FOG_TICK_FRAMES in include/br/br_ring.h: 240 frames, four seconds. The ROM takes
 *  a tenth of each mon's max HP off the player on this beat while they are outside the
 *  ring; a bot standing in the same fog has to lose the same thing on the same beat, or
 *  the fog is a rule that only applies to people and a match with bots in it can never
 *  end. */
const FOG_TICK_MS = 4000;
const FOG_BITE = 10; // a tenth, as `Bleed` in src/br/br_ring.c

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
    all: () => { key: number; mapId: string; x: number; y: number }[];
    at: (mapId: string, x: number, y: number) => number | undefined;
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
   *  where it is standing, which is where a trainer's mons come from (POK-237). */
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
    a: { seat: number; party: PackedMon[] },
    b: { seat: number; party: PackedMon[] },
  ) => Promise<{ winner: number; loser: number; a: { hp: number; status: number }[]; b: { hp: number; status: number }[] } | null>;
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

/** The team at the new rung. A mon that is already there keeps its place and the
 *  share of its health it had -- a bot does not get healed by the fog closing -- and
 *  the rest of the roster is whatever the deal added at this phase. */
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

function climb(held: PackedMon[], fresh: PackedMon[]): PackedMon[] {
  return fresh.map((next, i) => {
    const mine = held[i];
    if (!mine || mine.species !== next.species) return next;
    const share = mine.maxHp > 0 ? mine.hp / mine.maxHp : 1;
    return { ...next, hp: Math.max(1, Math.round(next.maxHp * share)), status: mine.status };
  });
}

export class Bots {
  private readonly walkers: Walker[] = [];
  /** Seats whose fight is running in somebody else's ROM. They stand where they were
   *  challenged until the `result` comes back: a bot that strolled off mid-battle is
   *  a ghost walking around while a spectator watches it lose. */
  private readonly fighting = new Set<number>();
  private nonce = 0;
  private now = 0;
  /** Route searches left in this tick (SEARCHES_PER_TICK). */
  private budget = 0;
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
   *  bot's own seat, because it is the only thing that watched the fight happen. */
  setParty(seat: number, mons: PackedMon[]): void {
    const walker = this.walkers.find((w) => w.bot.seat === seat);
    if (walker && mons.length > 0) walker.party = mons;
  }

  /** What the ROM that fought this bot spent out of its bag (POK-237). The units were
   *  handed over on the `trainer` card and are still in the bag until this says
   *  otherwise -- a fight that ended on the first turn spends nothing. */
  noteSpent(seat: number, items: number[]): void {
    const walker = this.walkers.find((w) => w.bot.seat === seat);

    if (!walker) return;
    spend(walker.bag, items);
  }

  /** What a bot has left to spend -- for a test, and for anyone who wants to look. */
  bagOf(seat: number): Stack[] {
    return this.walkers.find((w) => w.bot.seat === seat)?.bag ?? [];
  }

  /** The ring moved. Every route was chosen against the old one, so they are all
   *  suspect: dropping them makes each bot re-aim on its next step. The rung moved
   *  with it (POK-225: the ring phase IS the level), so the teams climb too. */
  ringMoved(phase = 0): void {
    this.phase = phase;
    for (const walker of this.walkers) {
      walker.path = null;
      const fresh = this.opts.deal?.(walker.bot, phase, walker.at.map);
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

  /** A fight this bot was in has ended -- it is back on the map and walking again.
   *  The `result` that says so comes from the ROM that fought it. */
  noteResult(seat: number): void {
    if (!this.fighting.delete(seat)) return;
    this.opts.send({ t: 'busy', seat });
  }

  /** Runs every bot up to `now`. Called as often as the host likes -- the pace is in
   *  here, not in the caller, so a slow frame makes bots catch up rather than crawl. */
  tick(now: number): void {
    this.now = now;
    this.budget = SEARCHES_PER_TICK;
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
    if (inside(walker.at.map)) {
      walker.bleedAt = now + FOG_TICK_MS;
      return;
    }
    if (now < walker.bleedAt) return;
    walker.bleedAt = now + FOG_TICK_MS;
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
      const spill: SpillMsg = {
        t: 'spill',
        seat: walker.bot.seat,
        map,
        // The ROM's key convention: the dropper's seat in the high byte, so keys never
        // collide between trainers (br_loot.c).
        mons: walker.party.slice(0, 6).map((mon, i) => ({
          key: ((walker.bot.seat & 0xff) << 8) | i,
          x: walker.at.x,
          y: walker.at.y,
          species: mon.species,
          level: mon.level,
        })),
      };
      // And its bag, which is the point of it having had one (POK-237): the X ATTACKs
      // it did not get to pop are lying there for whoever beat it. Key 6 is the slot
      // after the six mons, which is what the ROM's own whiteout uses.
      if (walker.bag.length > 0) {
        spill.bag = {
          key: ((walker.bot.seat & 0xff) << 8) | 6,
          x: walker.at.x,
          y: walker.at.y,
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
    const here = this.opts.loot?.at(walker.at.map, walker.at.x, walker.at.y);
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
      this.fighting.add(walker.bot.seat);
      this.opts.send({ t: 'busy', seat: walker.bot.seat, kind: 'battle' });
      walker.engageAfter = now + cooldownFor(walker.bot);
      walker.path = null;
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
    for (const other of this.walkers) {
      if (other === walker || now < other.engageAfter) continue;
      if (this.fighting.has(other.bot.seat) || other.party.length === 0) continue;
      const theirs: Look = { map: other.at.map, x: other.at.x, y: other.at.y, dir: other.facing };
      if (!eitherSees(this.opts.world, mine, theirs)) continue;
      this.nonce = (this.nonce + 1) & 0xffff;
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
    won.engageAfter = now + cooldownFor(won.bot);
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

    for (const w of [walker, other]) {
      this.fighting.add(w.bot.seat);
      this.opts.send({ t: 'busy', seat: w.bot.seat, kind: 'battle' });
      w.path = null;
    }
    void settle(
      { seat: walker.bot.seat, party: walker.party },
      { seat: other.bot.seat, party: other.party },
    )
      .catch(() => null)
      .then((out) => {
        const then = this.now;
        for (const w of [walker, other]) {
          this.fighting.delete(w.bot.seat);
          this.opts.send({ t: 'busy', seat: w.bot.seat });
        }
        // The fog may have taken one of them while the instance was fighting: that
        // elimination stands, and this duel never happened.
        if (!this.walkers.includes(walker) || !this.walkers.includes(other)) return;
        if (out) {
          const wonIsWalker = out.winner === walker.bot.seat;
          const left = wonIsWalker ? out.a : out.b;
          const winner = wonIsWalker ? walker : other;

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
        this.applyDuel(
          walker,
          other,
          duel(
            seed,
            { seat: walker.bot.seat, party: walker.party },
            { seat: other.bot.seat, party: other.party },
            nonce,
          ),
          then,
        );
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
      const path = findPath(this.opts.world, walker.at, { map: c.mapId, x: c.x, y: c.y }, CENTRE_BUDGET, canSurf(walker.party), canCut(walker.party));
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
    this.budget--;
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
    // Fog first. Aiming only at cells inside the ring is the whole rule: a bot already
    // inside wanders inside, and a bot caught outside walks in, because the route to
    // anywhere it may aim at crosses the edge on the way.
    // Loot in the ring beats wandering: a bot goes and gets it. Nearest first only
    // among the pieces on its own map -- distances across a seam are not comparable,
    // and a bot that crosses one will see that map's loot when it gets there.
    const loot = (this.opts.loot?.all() ?? [])
      .filter((l) => (!inside || inside(l.mapId)) && l.mapId === walker.at.map)
      .sort(
        (a, b) =>
          Math.abs(a.x - walker.at.x) + Math.abs(a.y - walker.at.y) -
          (Math.abs(b.x - walker.at.x) + Math.abs(b.y - walker.at.y)),
      );
    for (const piece of loot.slice(0, 2)) {
      const path = findPath(this.opts.world, walker.at, { map: piece.mapId, x: piece.x, y: piece.y }, WANDER_BUDGET, canSurf(walker.party), canCut(walker.party));
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
        const path = findPath(
          this.opts.world,
          walker.at,
          { map: player.mapId, x: player.x, y: player.y },
          WANDER_BUDGET,
          canSurf(walker.party),
          canCut(walker.party),
        );
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
    // Somewhere else, on foot -- and somewhere else NEAR, first. Hoenn is 500 maps
    // wide and the landing pool spans all of it, so a target drawn uniformly is
    // almost always past the A* budget: the replay tool had bots failing to route
    // 94% of the time, standing still while they did it. Own map, then own section,
    // then anywhere, so the cheap pick is also the one a trainer would make.
    const section = this.opts.world.map(walker.at.map)?.section;
    const pools = [
      targets.filter((t) => t.mapId === walker.at.map),
      targets.filter((t) => t.mapId !== walker.at.map && this.opts.world.map(t.mapId)?.section === section),
      targets,
    ].filter((pool) => pool.length > 0);
    for (let i = 0; i < 4; i++) {
      const pool = pools[Math.min(i, pools.length - 1)];
      const pick = pool[Math.floor(this.opts.rng() * pool.length)];
      const to: Spot = { map: pick.mapId, x: pick.x, y: pick.y };
      if (sameSpot(to, walker.at)) continue;
      const path = findPath(this.opts.world, walker.at, to, WANDER_BUDGET, canSurf(walker.party), canCut(walker.party));
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

  /** One legal step, any direction. The fallback when there is nothing to route to --
   *  or, as 'wait', when the tick's thinking budget went to another bot. */
  private wanderOneStep(walker: Walker, why: 'stuck' | 'wait' = 'stuck'): void {
    const open = this.opts.world.neighbours(walker.at, canSurf(walker.party), canCut(walker.party));
    if (open.length === 0) {
      this.note(walker, why);
      walker.path = null;
      return;
    }
    const step = open[Math.floor(this.opts.rng() * open.length)];
    walker.path = { steps: [step], found: true, visited: 0 };
    walker.stepIndex = 0;
    this.note(walker, why, step.dir);
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
