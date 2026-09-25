// The host's bots (POK-236): the page that runs the match deals them, walks them and
// speaks for them. Out of app.ts (POK-330 #42) so solo and the room start them one way
// and a test can drive them: nothing here touches the page or keeps module state -- the
// World they walk is bots/hoenn.ts's, built once for the tab -- and the clock and the
// pump are the caller's to hand in.
import { Bots, type BotsOptions } from './brain';
import { lootView, resumeAt } from './adapt';
import type { RomCell } from './space';
import { dealBots, type Bot } from './roster';
import { dealParty } from './party';
import { dealBag } from './bag';
import type { World } from './world';
import { HOENN, type WorldIndex } from './hoenn';
import type { DirectorWorld } from '../match/director';
import type { Loot } from '../match/loot';
import type { RosterEntry } from '../match/roster';
import * as Ticker from '../match/ticker';
import { NpcFog } from '../match/npcfog';
import { sectionInside } from '../match/ring';
import { mulberry32 } from '../match/clock';
import { LANDING } from '../match/landing';
import { SAFARI_CELLS } from '../match/safari';
import { MAP_OFFSET } from '../net/cells';
import { PARTY_BAG_MAX, type MapRef, type Msg } from '../net/wire';
import TRAINERS from '../data/trainers.json';

/** The bots' own pump. Faster than one step, so the pace comes out of `Bots.tick`
 *  rather than out of whatever interval the browser felt like giving us. */
export const BOT_TICK_MS = 100;

/** Picking up somebody else's bots (POK-252). The deal is a pure function of the
 *  match seed and the seats that were taken, so the promoted host can re-run it and
 *  get the same bots -- same seats, same names, same skins -- without anybody having
 *  sent it a thing. What the seed cannot say is where they have walked to since, so
 *  the roster supplies that: every bot's `place` has been passing this client all
 *  match. */
export interface BotResume {
  /** Every bot seat the match was dealt, the dead ones included -- the deal has to be
   *  re-run whole or the survivors come back under the wrong names. */
  botSeats: number[];
  /** The seats taken when it was dealt, so the allocator lands on the same seats. */
  humanSeats: number[];
  /** Seats that are not coming back: eliminated, or gone from the room. */
  out: Set<number>;
  /** Where the room last saw it -- a roster row, so the wire's space. */
  where: (seat: number) => ({ map: MapRef } & RomCell) | undefined;
}

type Cell = { mapId: string; x: number; y: number };

/** What the bots walk on, off world.json: the graph, both names for a map, and the
 *  cells a bot is dealt onto and walks to. One function, so the offline tools
 *  (tools/br/bots-replay.ts, zone-occupancy.ts) walk the ground the host's bots do.
 *  The graph is the index's own (POK-331 #20): every match walks the one World the tab
 *  built, rather than decoding Hoenn again each time bots are dealt. */
export interface BotGround {
  world: World;
  refById: Map<string, MapRef>;
  idOf: (map: MapRef) => string | undefined;
  sectionOf: Map<string, string>;
  /** Hoenn's landing cells: where the drop deals a bot and where it wanders. */
  targets: Cell[];
  /** The Zone's, for the opening. */
  safariTargets: Cell[];
  /** `targets` with each cell's wire map, which is what `dealBots` deals from. */
  spawns: (Cell & { map: MapRef })[];
}

export function botGround(index: WorldIndex = HOENN): BotGround {
  const { maps, world } = index;
  const refById = new Map(maps.map((m) => [m.id, { group: m.group, num: m.num }]));
  const outdoor = new Set(maps.filter((m) => m.outdoor).map((m) => m.id));
  // The same pool the drop deals from: known-walkable, outdoor, already in the bundle.
  const targets = LANDING
    .filter((c) => outdoor.has(c.map) && refById.has(c.map))
    .map((c) => ({ mapId: c.map, x: c.x, y: c.y }));
  // The opening is two minutes long and the bots used to spend all of it out in Hoenn,
  // so a room of one human and fifteen bots was a single-player Safari trip with a
  // countdown. They start in the Zone now, on the cells the ROM deals its own players
  // from, and the drop is what sends everybody out (POK-257).
  // All six areas of the Zone, not just the south one (POK-261): they are joined by
  // seams, so bots walk between them the same way a trainer does.
  const safariTargets = SAFARI_CELLS.filter((c) => refById.has(c.map)).map((c) => ({
    mapId: c.map,
    x: c.x,
    y: c.y,
  }));
  const sectionOf = new Map(maps.map((m) => [m.id, m.section]));
  const idOf = (map: MapRef) => index.idOf(map);
  const spawns = targets.map((t) => ({ mapId: t.mapId, map: refById.get(t.mapId)!, x: t.x, y: t.y }));
  return { world, refById, idOf, sectionOf, targets, safariTargets, spawns };
}

export interface HostBotsOptions {
  /** To everybody, on the page's grid: the caller turns it into the wire's (net/cells.ts). */
  send: (msg: Msg) => void;
  /** To one seat: a trainer card is for the player it challenges. */
  sendTo: (seat: number, msg: Msg) => void;
  /** The seats already taken when the bots are dealt. */
  takenSeats: number[];
  seed: number;
  /** How many bots to deal. */
  fill: number;
  loot: Loot;
  /** The whole field, bots included: the eyeline's players and the hunt's count. */
  players: () => RosterEntry[];
  /** In a battle or a menu, so not somebody a bot challenges (POK-230). */
  busy: (seat: number) => boolean;
  /** regionmap.json's sections: which maps the ring holds. */
  sections: DirectorWorld['sections'];
  /** The hidden instance's real fight, when there is one (POK-238). */
  settle?: BotsOptions['settle'];
  onDuel?: (winner: number, loser: number) => void;
  onEngage?: (seat: number, target: number) => void;
  onDecision?: BotsOptions['onDecision'];
  resume?: BotResume;
  /** Seconds of Safari opening. Above zero the bots start in the Zone with everybody
   *  else (POK-257) and only go out into Hoenn when the fog does. */
  safariSecs?: number;
  /** This match's Zone pool, read out of the ROM (match/zone.ts). Asked for at every deal
   *  rather than once: the first deal can come before the ROM has dealt the pool. */
  zonePool?: () => number[];
  /** The clock and the pump, for a test to drive: performance.now and setInterval. */
  now?: () => number;
  every?: (fn: () => void, ms: number) => () => void;
}

export interface HostBots {
  readonly bots: Bots;
  readonly seats: number[];
  /** The buzzer: the bots leave the Zone for the cells the seed dealt them. */
  drop: () => void;
  setRing: (ring: { sx: number; sy: number; r: number }, phase: number) => void;
  /** A bot's team, for answering a peek about it. Null for a seat we do not own. */
  partyFor: (seat: number) => Msg | null;
  /** One beat of the pump. */
  tick: (now: number) => void;
  dispose: () => void;
}

/** Fills the room with bots the host walks around. They reach every other client as
 *  ordinary `place`/`step` -- a ghost, which is all a bot ever is on the wire -- so
 *  nothing downstream of here has to know they are not people. */
export function createHostBots(opts: HostBotsOptions): HostBots {
  const { send, sendTo, takenSeats, seed, fill, loot, players, resume, safariSecs = 0, zonePool = () => [] } = opts;
  const clock = opts.now ?? (() => performance.now());
  const every =
    opts.every ??
    ((fn: () => void, ms: number) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    });
  const { world, refById, idOf, sectionOf, targets, safariTargets, spawns } = botGround();
  const opening = safariSecs > 0 && safariTargets.length > 0 && resume === undefined;
  const safariSpawns = safariTargets.map((t) => ({ ...t, map: refById.get(t.mapId)! }));
  let inOpening = opening;
  let ring: { sx: number; sy: number; r: number } | undefined;
  const bots = new Bots({
    world,
    targets: opening ? safariTargets : targets,
    mapRef: (id) => refById.get(id),
    send,
    rng: mulberry32(seed ^ 0x51ce),
    sendTo,
    // No ring yet means no fog anywhere, not fog everywhere. Before this, a bot was
    // counted as outside a ring that did not exist and bled through the whole opening:
    // eight bots went into the Zone and two came out of it (POK-257).
    inside: (id) => ring === undefined || sectionInside(opts.sections[sectionOf.get(id) ?? ''], ring),
    // The table holds what the wire said, which is the ROM's space; the brain asks
    // about the grid it walks (bots/space.ts).
    loot: lootView(loot, (mapId) => refById.get(mapId), idOf),
    // The eyeline (POK-238). A bot fights a player the same way a player fights one:
    // whoever sees the other starts it. The team goes over as a `trainer` card first,
    // because the ROM has to build a party before the challenge lands.
    engage: {
      // ...and back out of it on the way in. A player's cell on the roster came from
      // their own ROM, so it is seven tiles out from the grid the brain walks -- and an
      // eyeline measured between the two spaces is an eyeline measured wrong.
      players: () =>
        players()
          .filter((e) => e.alive && !seatsDealt.has(e.seat) && e.map && e.x !== undefined && e.y !== undefined)
          .map((e) => ({
            seat: e.seat,
            mapId: idOf(e.map!) ?? '',
            x: e.x! - MAP_OFFSET,
            y: e.y! - MAP_OFFSET,
            dir: e.dir as 1 | 2 | 3 | 4,
            busy: opts.busy(e.seat),
          }))
          .filter((p) => p.mapId !== ''),
    },
    // Two bots meeting is fought for real in the hidden instance when there is one
    // (POK-238); `duel.ts`'s seeded resolver is what answers when there is not.
    settle: opts.settle,
    // Where the bot is standing is where its mons came from (POK-237): the drop put
    // it on a route, and that route's own table is what a trainer there would have.
    deal: (bot, atPhase, mapId) => dealParty(seed, bot.seat, atPhase, mapId, bot.grade, zonePool()),
    // And the bag it spends from (POK-237): the potions it drinks between fights, the
    // X ATTACKs its opponent's ROM pops on its behalf, and what a player finds on it.
    bagFor: (bot, atPhase) => dealBag(seed, bot.seat, atPhase, bot.grade),
    seed,
    onDuel: opts.onDuel ?? (() => {}),
    // Nobody fights in the Zone -- not a player, not another bot.
    fights: () => !inOpening,
    onEngage: opts.onEngage ?? (() => {}),
    onDecision: opts.onDecision,
    centres: () => world.centres(),
    // Bots are on this roster too -- the host applies its own bots' `place` to it --
    // so this is the whole field, which is what the hunt rule wants.
    alive: () => players().filter((e) => e.alive).length,
  });
  // Re-deal the whole field so the names line up, drop whoever is out of the match,
  // and stand the rest where the room last saw them rather than back on their drop.
  const resumed = (r: BotResume): Bot[] =>
    dealBots(seed, r.botSeats.length, r.humanSeats, spawns)
      .filter((b) => !r.out.has(b.seat))
      .map((b) => resumeAt(b, r.where(b.seat), idOf));
  const dealt = resume
    ? resumed(resume)
    : dealBots(seed, fill, takenSeats, opening ? safariSpawns : spawns);
  // Where they will be when the fog comes. The deal draws the same seats, names and
  // skins whichever pool it is handed -- only the cell differs -- so this is the same
  // sixteen bots, standing where the drop would have put them.
  const landing = new Map(dealBots(seed, fill, takenSeats, spawns).map((b) => [b.seat, b]));
  const seatsDealt = new Set(dealt.map((b) => b.seat));
  let phase = 0;
  bots.start(dealt, clock());
  // The fog clears Hoenn's own trainers off a map it has taken (POK-299): the host runs
  // the per-map clock, and each trainer leaves every ROM as `npcout`, the way a beaten
  // one does. The seat on it is only a seat; `fog` says nobody beat them.
  const npcFog = new NpcFog(TRAINERS as Record<string, number[]>, (id) => opts.sections[sectionOf.get(id) ?? '']);
  const fogSeat = takenSeats[0] ?? 0;
  const tick = (now: number): void => {
    bots.tick(now);
    if (inOpening) return;
    const died = npcFog.tick(now, ring);
    let cleared = 0;
    for (const mapId of died) {
      const map = refById.get(mapId);

      if (!map) continue;
      for (const localId of TRAINERS[mapId as keyof typeof TRAINERS] ?? []) {
        send({ t: 'npcout', seat: fogSeat, map, localId, fog: true });
        cleared++;
      }
    }
    if (cleared > 0) {
      const line = Ticker.cleared(fogSeat, cleared, died.length);

      if (line) send(line);
    }
  };
  const stop = every(() => tick(clock()), BOT_TICK_MS);
  return {
    bots,
    seats: dealt.map((b) => b.seat),
    drop: () => {
      if (!inOpening) return;
      inOpening = false;
      bots.setTargets(targets);
      for (const bot of dealt) {
        const to = landing.get(bot.seat);

        if (to) bots.placeAt(bot.seat, { map: to.mapId, x: to.x, y: to.y });
      }
    },
    // The host hands its own `ring` straight over: the bots read the fog off the same
    // message every ROM in the room does.
    setRing: (next: { sx: number; sy: number; r: number }, nextPhase: number) => {
      ring = next;
      phase = nextPhase;
      bots.ringMoved(nextPhase);
    },
    // Pull, not push: a bot's team only goes on the wire when somebody asks to see
    // it, the same way a player's does (POK-227's peek) -- and what it answers with
    // is the team the bot is actually carrying, fights it has had and all.
    partyFor: (seat: number) => {
      const mons = bots.partyOf(seat);
      if (!seatsDealt.has(seat) || mons.length === 0) return null;
      // ...and what it is carrying (POK-297): a bot's bag lives here and nowhere else.
      const items = bots.bagOf(seat).slice(0, PARTY_BAG_MAX).map((s) => ({ id: s.id, n: Math.min(99, s.n) }));
      return { t: 'party', seat, mons, bag: { money: bots.moneyOf(seat), items: items.filter((s) => s.n > 0) } };
    },
    tick,
    dispose: stop,
  };
}
