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
import type { Bot } from './roster';
import { sameSpot, type SeamDir, type Spot, type World } from './world';
import { PROTOCOL, type MapRef, type Msg } from '../net/wire';

/** Kanto's pace: four tiles a second, whatever the host's tab is doing. */
export const STEP_MS = 250;
/** How far a bot will look for its next wander target before settling for less. */
const WANDER_BUDGET = 1500;

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
  facing: 1 | 2 | 3 | 4;
}

export interface BotsOptions {
  world: World;
  /** Every cell a bot may wander to -- the same landing pool the drop deals from. */
  targets: { mapId: string; x: number; y: number }[];
  /** Is this map inside the fog? Bots only ever aim at somewhere that is -- the first
   *  rule of Kanto's decision list, and the one that decides whether a match ends with
   *  a fight or with everybody quietly bleeding out in the corners. */
  inside?: (mapId: string) => boolean;
  /** world.json id -> the wire's group/num. */
  mapRef: (mapId: string) => MapRef | undefined;
  send: (msg: Msg) => void;
  /** 0..1, the same shape as `Math.random`; seeded by the caller so a match replays. */
  rng: () => number;
}

export class Bots {
  private readonly walkers: Walker[] = [];

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
    const i = this.walkers.findIndex((w) => w.bot.seat === seat);
    if (i >= 0) this.walkers.splice(i, 1);
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

  private chooseTarget(walker: Walker, _now: number): void {
    const inside = this.opts.inside;
    // Fog first. Aiming only at cells inside the ring is the whole rule: a bot already
    // inside wanders inside, and a bot caught outside walks in, because the route to
    // anywhere it may aim at crosses the edge on the way.
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
