// The host's match with no page (POK-331 #25): its bots and its director, with the clock
// in a loop instead of two timers. What tools/br/bots-replay.ts and zone-occupancy.ts run.
//
// Each tool used to build a Bots of its own, and each had drifted from the one a match
// walks: a ring of its own (12, 9, 7, 5, 4, 3, 2 round the first section on the region
// map, a rung every sixth of the replay) where the director's is 28, 15, 9, 7, 5, 3, 2,
// 0 and then everywhere, round a centre the seed picks, a rung every fogSecs after the
// opening; no opening in the Zone; a team dealt with no map, grade or rung to match; no
// loot table, so a fallen bot's team was never there to take; and a search budget every
// 267 ms instead of every 100. A number the tools printed was a number about some other
// match. So this is match/host.ts's wiring of createHostBots and the Director, minus the
// room, the ROM and the ticker.
import { BOT_TICK_MS, botGround, createHostBots, type BotGround, type HostBots } from './host';
import type { BotsOptions } from './brain';
import { HOENN } from './hoenn';
import { DEFAULT_FOG_SECS, DEFAULT_SAFARI_SECS, Director, type DirectorWorld } from '../match/director';
import { botRows } from '../match/lifecycle';
import { DOORSTEPS, HAND, LANDING } from '../match/landing';
import { Loot } from '../match/loot';
import { sectionInside, type RingCircle } from '../match/ring';
import { Roster } from '../match/roster';
import { toRomCells } from '../net/cells';
import type { Msg } from '../net/wire';
import regionmapData from '../data/regionmap.json';

/** One beat of the loop: the host's own pump. */
export const BEAT_MS = BOT_TICK_MS;

/** The director's world, built the way app.ts builds it. */
const WORLD: DirectorWorld = {
  maps: HOENN.maps,
  landing: LANDING,
  doorsteps: DOORSTEPS,
  hand: HAND,
  sections: regionmapData.sections as DirectorWorld['sections'],
};

export interface OfflineOptions {
  seed: number;
  /** How many bots. Every contestant is one: there is no player in here. */
  bots: number;
  /** The opening and each ring, in seconds: the director's own defaults when left out. */
  safariSecs?: number;
  fogSecs?: number;
  /** Deal every bot onto this map's own landing cells, to watch a start there. With an
   *  opening that is where the drop puts them; with none, where they begin. */
  onMap?: string;
  onDecision?: BotsOptions['onDecision'];
  /** Two bots settled it: the only moment both sides of a fight are known at once. */
  onDuel?: (winner: number, loser: number) => void;
  /** Everything the match says -- the bots' messages in the wire's space, as the room
   *  would hear them, and the director's -- with the loop's time. */
  onMsg?: (msg: Msg, at: number) => void;
}

export interface OfflineMatch {
  readonly host: HostBots;
  readonly director: Director;
  /** Who is where and who is still in, off the bots' own messages. */
  readonly roster: Roster;
  readonly ground: BotGround;
  /** The loop's clock: everything that has come due by `now` happens, one beat of the
   *  host's pump. Call it every BEAT_MS. */
  tick(now: number): void;
  /** Is this map inside the ring -- the current one unless another is named? The same
   *  question the bots ask, and true while there is no ring yet. */
  inside(mapId: string, ring?: RingCircle): boolean;
  /** The seat that won, once the director has said; null for a draw. */
  readonly winner: number | null | undefined;
}

export function offlineMatch(opts: OfflineOptions): OfflineMatch {
  const { seed, onMsg } = opts;
  const safariSecs = opts.safariSecs ?? DEFAULT_SAFARI_SECS;
  const fogSecs = opts.fogSecs ?? DEFAULT_FOG_SECS;
  let now = 0;
  const all = botGround();
  const ground =
    opts.onMap === undefined ? all : { ...all, spawns: all.spawns.filter((s) => s.mapId === opts.onMap) };
  if (ground.spawns.length === 0) throw new Error(`no landing cells on ${opts.onMap}`);
  const roster = new Roster();
  const loot = new Loot();
  let hearOut: ((seat: number) => void) | null = null;
  let winner: number | null | undefined;
  const host = createHostBots({
    // What HostRole's hostSays does with it, less the room and the ROM: the wire's space,
    // then the roster and the loot table -- a fallen bot's team is what the next one picks up.
    send: (msg) => {
      const wire = toRomCells(msg);
      roster.applyMsg(wire);
      loot.note(wire);
      onMsg?.(wire, now);
      if (wire.t === 'out') hearOut?.(wire.seat);
    },
    sendTo: () => {}, // a trainer card is for a player, and there is none
    takenSeats: [],
    seed,
    fill: opts.bots,
    loot,
    players: () => roster.all(),
    busy: () => false,
    sections: WORLD.sections,
    onDecision: opts.onDecision,
    onDuel: opts.onDuel,
    safariSecs,
    ground,
    // No ROM, so no Zone pool: the fallback a patch with no gBrZone gets.
    now: () => now,
    every: () => () => {}, // the loop is the pump
  });
  roster.seatBots(botRows(seed, host.seats));
  const director = new Director({
    seats: host.seats,
    seed,
    options: { safariSecs, fogSecs },
    world: WORLD,
    send: (msg) => {
      onMsg?.(msg, now);
      // HostRole.directorSends: the first ring is the buzzer, and every one is the bots' fog.
      if (msg.t === 'ring') {
        host.drop();
        host.setRing({ sx: msg.sx, sy: msg.sy, r: msg.r }, msg.phase);
      } else if (msg.t === 'win') {
        winner = msg.seat ?? null;
        host.bots.decide(); // HostRole.directorSends: nobody goes out after the verdict
      }
    },
    now: () => now,
    onOut: (handler) => {
      hearOut = handler;
      return () => {
        hearOut = null;
      };
    },
  });
  director.start();
  const current = (): RingCircle | undefined => director.state.ring;
  return {
    host,
    director,
    roster,
    ground,
    tick: (at: number) => {
      now = at;
      director.tick();
      host.tick(at);
    },
    inside: (mapId, ring = current()) =>
      ring === undefined || sectionInside(WORLD.sections[ground.sectionOf.get(mapId) ?? ''], ring),
    get winner() {
      return winner;
    },
  };
}
