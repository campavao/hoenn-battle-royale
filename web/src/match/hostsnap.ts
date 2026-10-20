// The host's half of a reload (HBR-20, Cam 2026-10-20: a match against bots should wait a
// minute for its host "before reseting the game completely"). The director and the bots
// written down as the tab goes, and put back as they were when it comes back, rather than
// the takeover's guesses (Director.resume, BotResume): the same clock, the same draws, and
// every bot with the team and bag it had.
//
// It reaches into the director and the brain for what they keep private, which nothing
// else should: it is here, in the chunk only a match loads (match/resume.ts), rather than
// as their own methods, because main.js has no room for it.
import { PROXY_TIMEOUT_MS, STEP_MS, type Bots, type Fight, type Walker } from '../bots/brain';
import { duel } from '../bots/duel';
import { botGround, type HostBots } from '../bots/host';
import { mulberry32, type Rng } from './clock';
import type { Director, DirectorPhase } from './director';
import type { HostRole } from './host';
import { STORIES } from './story';

/** What a host's tab writes down as it goes. */
export interface HostSnap {
  seed: number;
  /** Date.now() at the snapshot. */
  wall: number;
  director: DirectorSnap;
  bots: HostBotsSnap;
  /** Who got each trader (TraderClaims). */
  claims: [number, number][];
}

/** The host's bots: unlike a takeover's BotResume, nothing dealt again, so every bot comes
 *  back with the team and bag it had. */
export interface HostBotsSnap {
  bots: BotsSnap;
  rng: number;
  inOpening: boolean;
  ring?: { sx: number; sy: number; r: number };
  phase: number;
  /** NpcFog's clocks: each map's ticks, how long ago the last, and whether it is dead. */
  fog: [mapId: string, ticks: number, ago: number, dead: boolean][];
  /** Where the drop sends each bot, while it is still to come. */
  landing: [seat: number, mapId: string, x: number, y: number][];
}

export function snapHost(role: HostRole, now = performance.now(), wall = Date.now()): HostSnap {
  return {
    seed: role.seed,
    wall,
    director: snapDirector(role.director, now),
    bots: snapHostBots(role.bots, now),
    claims: [...role['claims']['won']],
  };
}

export function snapHostBots(hb: HostBots, now: number): HostBotsSnap {
  const b = hb.bots;
  return {
    bots: snapBots(b, now),
    rng: (b['opts'].rng as Rng).state(),
    ...hb.st,
    fog: [...hb.fog['clocks']].map(([id, c]) => [id, c.ticks, now - c.last, c.dead]),
    landing: hb.st.inOpening ? [...hb.landing].map(([seat, to]) => [seat, to.mapId, to.x, to.y]) : [],
  };
}

/** Our own match back from a reload: the take-over has picked it up the way an heir would
 *  (HostRole.begin), and this lays the match as it stood over that. False when the snapshot
 *  is another match's. */
export function restoreHost(role: HostRole, snap: HostSnap, now = performance.now(), wall = Date.now()): boolean {
  if (snap.seed !== role.seed) return false;
  const d = role.director;
  // Whoever the take-over counted out (gone from the room meanwhile) stays out.
  const out = d['opts'].seats.filter((seat) => !d['aliveSeats'].has(seat));
  restoreDirector(d, snap.director, wall - snap.wall);
  for (const seat of out) d['aliveSeats'].delete(seat);
  restoreHostBots(role.bots, snap.bots, now);
  for (const [key, seat] of snap.claims) role['claims']['won'].set(key, seat);
  for (const seat of snap.director.placements) role['seen'].add(seat);
  return true;
}

/** The bots as they stood, over the ones the take-over dealt again off the seed. */
export function restoreHostBots(hb: HostBots, snap: HostBotsSnap, now: number): void {
  const b = hb.bots;
  b['walkers'].length = 0;
  b['fighting'].clear();
  b['opts'].rng = mulberry32(0, snap.rng);
  // The take-over never deals into an opening; a reload in one is still in it.
  if (snap.inOpening) b['opts'].targets = botGround().safariTargets;
  hb.st.inOpening = snap.inOpening;
  hb.st.ring = snap.ring;
  hb.st.phase = snap.phase;
  hb.landing.clear();
  for (const [seat, mapId, x, y] of snap.landing) hb.landing.set(seat, { mapId, x, y });
  for (const [id, ticks, ago, dead] of snap.fog) hb.fog['clocks'].set(id, { ticks, last: now - ago, dead });
  restoreBots(b, snap.bots, now);
}

export interface DirectorSnap {
  phase: DirectorPhase;
  /** How long before the snapshot each began. */
  started: number;
  ringStarted: number;
  ticks: number;
  ringIndex: number;
  centre?: { sx: number; sy: number; place?: string };
  section?: string;
  told: string[];
  final?: string;
  alive: number[];
  placements: number[];
  winner?: number;
  dealt: string[];
  rng: number;
}

export function snapDirector(d: Director, now: number): DirectorSnap {
  return {
    phase: d['phase'],
    started: now - d['startedAt'],
    ringStarted: now - d['ringStartedAt'],
    ticks: d['clockTicksSent'],
    ringIndex: d['ringIndex'],
    centre: d['ringCentre'],
    section: d['ringSection']?.id,
    told: [...d['told']],
    final: d['finalStory']?.id,
    alive: [...d['aliveSeats']],
    placements: [...d['placements']],
    winner: d['winner'],
    dealt: [...d['dealtCells']],
    rng: (d['rng'] as Rng).state(),
  };
}

/** Over what resume() re-derived (and the ear on the room's outs it opened): the match as
 *  it stood. `gone` is how long the tab was away, which every ROM in the room spent counting
 *  down, so the next tick says whatever fell due meanwhile. */
export function restoreDirector(d: Director, snap: DirectorSnap, gone: number): void {
  const at = d['opts'].now() - Math.max(0, gone);
  d['phase'] = snap.phase;
  d['startedAt'] = at - snap.started;
  d['ringStartedAt'] = at - snap.ringStarted;
  d['clockTicksSent'] = snap.ticks;
  d['ringIndex'] = snap.ringIndex;
  d['ringCentre'] = snap.centre;
  d['ringSection'] = d['sections'].find((s) => s.id === snap.section);
  d['finalStory'] = STORIES.find((s) => s.id === snap.final);
  d['winner'] = snap.winner;
  d['rng'] = mulberry32(0, snap.rng);
  for (const id of snap.told) d['told'].add(id);
  d['aliveSeats'].clear();
  for (const seat of snap.alive) d['aliveSeats'].add(seat);
  d['placements'].push(...snap.placements);
  for (const key of snap.dealt) d['dealtCells'].add(key);
}

/** A walker's moments, which a snapshot keeps as how far from it they were. */
const TIMES = ['engageAfter', 'flyAfter', 'retryAfter', 'bleedAt', 'quaffAfter', 'wildUntil'] as const;

function shift<T extends Partial<Record<(typeof TIMES)[number], number>>>(w: T, by: number): T {
  const out = { ...w };
  for (const k of TIMES) if (out[k] !== undefined) (out as Record<string, number>)[k] = out[k]! + by;
  return out;
}

/** A bot as a reload leaves it: its route dropped, which its next step plans again, and
 *  its sets as lists. */
export interface WalkerSnap extends Omit<Walker, 'path' | 'stepIndex' | 'nextStepAt' | 'chasing' | 'traded' | 'foughtLegends'> {
  traded?: [number, number][];
  foughtLegends?: number[];
}

export interface BotsSnap {
  walkers: WalkerSnap[];
  /** Each held bot: who it is fighting, how long ago that began, and a proxy duel's draw. */
  fights: [seat: number, opponent: number, ago: number, started: boolean, nonce?: number][];
  nonce: number;
  traded: number[];
  duelAfter: number;
  phase: number;
  decided: boolean;
  patchTaken: number[];
  patchPhase: number;
}

export function snapBots(b: Bots, now: number): BotsSnap {
  return {
    walkers: b['walkers'].map(({ path: _p, stepIndex: _i, nextStepAt: _n, chasing: _c, traded, foughtLegends, ...w }) => ({
      ...shift(w, -now),
      traded: traded && [...traded],
      foughtLegends: foughtLegends && [...foughtLegends],
    })),
    fights: [...b['fighting']].map(([seat, f]) => [seat, f.opponent, now - f.since, f.started, f.nonce]),
    nonce: b['nonce'],
    traded: [...b['tradedKeys']],
    duelAfter: b['duelAfter'] - now,
    phase: b['phase'],
    decided: b['decided'],
    patchTaken: [...b['patchTaken']],
    patchPhase: b['patchPhase'],
  };
}

/** start() for the bots a snapshot left, standing and carrying what they were, each said
 *  to the room. A duel in the hidden instance went with the tab, so the seeded resolver
 *  settles it on the next tick, as it settles one the instance never answered. */
export function restoreBots(b: Bots, snap: BotsSnap, now: number): void {
  b['nonce'] = snap.nonce;
  b['duelAfter'] = now + snap.duelAfter;
  b['phase'] = snap.phase;
  b['decided'] = snap.decided;
  b['patchPhase'] = snap.patchPhase;
  for (const key of snap.traded) b['tradedKeys'].add(key);
  for (const key of snap.patchTaken) b['patchTaken'].add(key);
  for (const { traded, foughtLegends, ...w } of snap.walkers) {
    const walker: Walker = {
      ...shift(w, now),
      path: null,
      stepIndex: 0,
      nextStepAt: now + STEP_MS,
      traded: traded && new Map(traded),
      foughtLegends: foughtLegends && new Set(foughtLegends),
    };
    b['walkers'].push(walker);
    b['place'](walker);
  }
  const find = (seat: number) => b['walkers'].find((w) => w.bot.seat === seat);
  for (const [seat, opponent, ago, started, nonce] of snap.fights) {
    const walker = find(seat);
    const other = find(opponent);
    if (!walker || b['fighting'].has(seat)) continue;
    if (nonce === undefined) b['fighting'].set(seat, { opponent, since: now - ago, started });
    else if (other) reproxy(b, walker, other, nonce, now);
  }
}

/** A proxy duel the instance will never answer now, held past its time so the next tick's
 *  expireFights settles it off the seed. */
function reproxy(b: Bots, x: Walker, y: Walker, nonce: number, now: number): void {
  const pair = [x, y];
  const fights = pair.map((w, i): Fight => ({
    opponent: pair[1 - i].bot.seat,
    since: now - PROXY_TIMEOUT_MS - 1,
    started: true,
    proxy: () => {
      const live = pair.filter((p, j) => b['fighting'].get(p.bot.seat) === fights[j]);
      for (const p of live) b['release'](p.bot.seat);
      if (live.length < 2 || !b['walkers'].includes(x) || !b['walkers'].includes(y)) return;
      const side = (p: Walker) => ({ seat: p.bot.seat, party: p.party });
      b['applyDuel'](x, y, duel(b['opts'].seed ?? 0, side(x), side(y), nonce), b['now']);
    },
    nonce,
  }));
  pair.forEach((w, i) => {
    b['fighting'].set(w.bot.seat, fights[i]);
    w.foe = pair[1 - i].bot.seat;
  });
}

/** What the host's role hands these to, so it never loads them itself. */
export const HOST_SNAP = { snapHost, restoreHost };
export type HostSnapKit = typeof HOST_SNAP;
