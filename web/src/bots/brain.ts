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
import type { Bot } from './roster';
import { sameSpot, type SeamDir, type Spot, type World } from './world';
import { PROTOCOL, type MapRef, type Msg, type PackedMon } from '../net/wire';

/** Kanto's pace: four tiles a second, whatever the host's tab is doing. */
export const STEP_MS = 250;
/** How far a bot will look for its next wander target before settling for less. */
const WANDER_BUDGET = 1500;
/** BR_ENGAGE_GRACE in src/br/br_engage.c: 120 frames, and a frame is a sixtieth. */
const ENGAGE_COOLDOWN_MS = 2000;

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
  /** Nothing before this: the same grace the ROM keeps after a fight, so a bot that
   *  just fought does not re-challenge the player still standing in front of it. */
  engageAfter: number;
}

/** A player as the roster knows them -- where they are and which way they are looking.
 *  Exactly what the eyeline needs, and nothing a bot could not see. */
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
  };
  /** world.json id -> the wire's group/num. */
  mapRef: (mapId: string) => MapRef | undefined;
  /** The eyeline (POK-238). A bot has no ROM, so the fight against it is a trainer
   *  battle in the player's: `party` is what that battle is built from, staged over
   *  the wire the moment the pair see each other and immediately challenged. */
  engage?: {
    players: () => PlayerView[];
    party: (bot: Bot) => PackedMon[];
  };
  send: (msg: Msg) => void;
  /** To one seat only. A trainer card staged in every ROM in the room would sit in
   *  six `gEnemyParty`s waiting for a challenge five of them will never get, and the
   *  next real trainer any of them walks into would be wearing it. */
  sendTo?: (seat: number, msg: Msg) => void;
  /** 0..1, the same shape as `Math.random`; seeded by the caller so a match replays. */
  rng: () => number;
}

export class Bots {
  private readonly walkers: Walker[] = [];
  /** Seats whose fight is running in somebody else's ROM. They stand where they were
   *  challenged until the `result` comes back: a bot that strolled off mid-battle is
   *  a ghost walking around while a spectator watches it lose. */
  private readonly fighting = new Set<number>();
  private nonce = 0;

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
      };
      this.walkers.push(walker);
      this.place(walker);
    }
  }

  count(): number {
    return this.walkers.length;
  }

  /** Where a bot is standing right now -- for the engage, and for tests. */
  spotOf(seat: number): Spot | undefined {
    return this.walkers.find((w) => w.bot.seat === seat)?.at;
  }

  /** The ring moved. Every route was chosen against the old one, so they are all
   *  suspect: dropping them makes each bot re-aim on its next step. */
  ringMoved(): void {
    for (const walker of this.walkers) walker.path = null;
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
    for (const walker of this.walkers) {
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

  private stepOne(walker: Walker, now: number): void {
    if (this.fighting.has(walker.bot.seat)) return;
    // The eyeline outranks everything: a bot that can see a player fights them, the
    // same way walking into one in the ROM does. It is checked before the step, on
    // where the bot is standing, because that is the position the room was told.
    if (this.tryEngage(walker, now)) return;
    // Loot at your feet, before anything else: a bot standing on a ball takes it, and
    // that is the turn spent.
    const here = this.opts.loot?.at(walker.at.map, walker.at.x, walker.at.y);
    if (here !== undefined) {
      this.opts.send({ t: 'pickup', seat: walker.bot.seat, key: here });
      walker.path = null;
      return;
    }
    if (!walker.path || walker.stepIndex >= walker.path.steps.length) {
      this.chooseTarget(walker, now);
      if (!walker.path || walker.path.steps.length === 0) return;
    }
    const step = walker.path.steps[walker.stepIndex++];
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
    if (!engage || now < walker.engageAfter) return false;
    const map = this.opts.mapRef(walker.at.map);
    if (!map) return false;
    const mine: Look = { map: walker.at.map, x: walker.at.x, y: walker.at.y, dir: walker.facing };
    for (const player of engage.players()) {
      if (player.busy || player.mapId !== walker.at.map) continue;
      const theirs: Look = { map: player.mapId, x: player.x, y: player.y, dir: player.dir };
      if (!eitherSees(this.opts.world, mine, theirs)) continue;
      const mons = engage.party(walker.bot);
      if (mons.length === 0) return false;
      // PLAYER_NAME_LENGTH is 7: a HUD name may be longer, a trainer card may not.
      const name = walker.bot.name.slice(0, 7);
      const card: Msg = { t: 'trainer', seat: walker.bot.seat, name, mons };
      if (this.opts.sendTo) this.opts.sendTo(player.seat, card);
      else this.opts.send(card);
      this.nonce = (this.nonce + 1) & 0xffff;
      this.opts.send({
        t: 'challenge',
        seat: walker.bot.seat,
        opponent: player.seat,
        nonce: this.nonce,
      });
      this.fighting.add(walker.bot.seat);
      this.opts.send({ t: 'busy', seat: walker.bot.seat, kind: 'battle' });
      walker.engageAfter = now + ENGAGE_COOLDOWN_MS;
      walker.path = null;
      return true;
    }
    return false;
  }

  private chooseTarget(walker: Walker, _now: number): void {
    const inside = this.opts.inside;
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
      const path = findPath(this.opts.world, walker.at, { map: piece.mapId, x: piece.x, y: piece.y }, WANDER_BUDGET);
      if (path.found && path.steps.length > 0) {
        walker.path = path;
        walker.stepIndex = 0;
        return;
      }
    }
    const targets = inside ? this.opts.targets.filter((t) => inside(t.mapId)) : this.opts.targets;
    if (targets.length === 0) return;
    // Somewhere else, on foot. Three tries so an unreachable pick (an island, a cave
    // mouth behind a puzzle) costs a fraction of a second rather than the match.
    for (let i = 0; i < 3; i++) {
      const pick = targets[Math.floor(this.opts.rng() * targets.length)];
      const to: Spot = { map: pick.mapId, x: pick.x, y: pick.y };
      if (sameSpot(to, walker.at)) continue;
      const path = findPath(this.opts.world, walker.at, to, WANDER_BUDGET);
      if (path.found && path.steps.length > 0) {
        walker.path = path;
        walker.stepIndex = 0;
        return;
      }
    }
    walker.path = null;
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
