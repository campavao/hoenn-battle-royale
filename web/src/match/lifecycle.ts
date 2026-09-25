// A room's matches, start to finish, as rules a test can hold (POK-330).
//
// app.ts's wireRoom wires a match to the relay, the ROM and the room screen; the decisions
// in that wiring -- who is still here, who a match is dealt to, what a promotion or the
// host's `again` means -- lived inside its closure, where nothing could pin them, and the
// room's worst bugs were those decisions going wrong. They are pure functions here, which
// is also the first step of pulling the match out of that closure (#42).
import type { RosterEvent } from '../net/relay';
import type { MapRef, Msg, SpillMsg } from '../net/wire';
import { dealBots, MAX_SEATS } from '../bots/roster';
import type { DirectorState } from './director';

/** The match as any page in the room can see it (POK-252): everything a promoted client
 *  needs to pick it up arrives in messages every client hears, so a guest is always ready
 *  to take over without anybody having sent it anything special. */
export interface MatchSnapshot {
  seed: number;
  seats: number[];
  /** Where `start` dealt everybody, so a takeover does not deal those cells again. */
  spawns: { map: MapRef; x: number; y: number }[];
  /** The seats in `seats` that are bots, which no relay roster will ever list. */
  botSeats: Set<number>;
  ringPhase: number;
  centre?: { sx: number; sy: number; place?: string };
  /** The ring's radius, for the strip a guest draws for itself (POK-268). */
  ringR: number;
  clockLeft: number;
  /** When that clockLeft arrived, so the seconds between the five-second CLOCKs can be
   *  counted off locally rather than standing still. */
  clockAt: number;
  out: Set<number>;
  /** A match is on: a `start` was heard, or -- for a watcher who walked in on one and
   *  never hears its start -- a `ring` or `clock` (POK-260). */
  active: boolean;
  /** ...and it has been decided: its `win` has been heard. */
  ended: boolean;
}

/** No match at all: what a room is before START, and what PLAY AGAIN puts back. A match
 *  that outlived its own ending is how the host's room screen lost START a second after
 *  coming back, and how an heir promoted between matches resumed the finished one
 *  (POK-330 #22). */
export function freshMatch(): MatchSnapshot {
  return {
    seed: 0,
    seats: [],
    spawns: [],
    botSeats: new Set(),
    ringPhase: 0,
    centre: undefined,
    ringR: 0,
    clockLeft: 0,
    clockAt: 0,
    out: new Set(),
    active: false,
    ended: false,
  };
}

/** Who a match is dealt to: the relay's members, watchers excepted (POK-260). Never the
 *  page's own roster, which also holds whoever it has merely heard from -- last match's
 *  bots above all, which PLAY AGAIN then seated as people: FILL came out at zero and the
 *  match waited for seven seats that would never move (POK-330 #22). `members` is the
 *  roster event in hand, when there is one. */
export function seatsFor(roster: RosterEvent | null, members?: readonly number[]): number[] {
  const watching = new Set((roster?.members ?? []).filter((m) => m.spectate).map((m) => m.id));
  const ids = members ?? (roster?.members ?? []).map((m) => m.id);
  return [...new Set(ids)].filter((seat) => !watching.has(seat));
}

/** What a client the relay has just made host does about the match (POK-252):
 *  `take-over` one that is running; `room` when there is none, inheriting the room and
 *  its START and nothing else (c981dd910); `none` when the last one has been decided and
 *  is only waiting for its grace to bring everybody back to the room -- which gives the
 *  heir START there. Resuming a finished match restarted its clock and its bots on ROMs
 *  that had rebooted into Littleroot (POK-330 #22). */
export function onPromotion(match: Pick<MatchSnapshot, 'active' | 'ended'>): 'take-over' | 'room' | 'none' {
  if (!match.active) return 'room';
  return match.ended ? 'none' : 'take-over';
}

/** What a page does with the host's `again` (POK-258). The host sends it with the `win`,
 *  for a page whose socket blinked over that and would otherwise sit in a finished match
 *  for ever: recovery, not the way out. The way out is each page's own grace, and a page
 *  that took `again` as the exit rebooted on arrival, cutting its results short and a
 *  guest champion's Hall of Fame with them (POK-330 #9). So only a page still in a match
 *  it never heard end starts that grace; everybody else has one running already, or no
 *  match to leave. */
export function onAgain(page: {
  /** This page runs the director: it sent the `again`. */
  running: boolean;
  match: Pick<MatchSnapshot, 'active' | 'ended'>;
  graceArmed: boolean;
}): 'grace' | 'ignore' {
  if (page.running || page.graceArmed || !page.match.active || page.match.ended) return 'ignore';
  return 'grace';
}

/** The names and skins a match's bots were dealt (POK-330 #51), for any page that knows
 *  the seed and which seats are bots. dealBots walks down from the top seat past the
 *  taken ones, drawing a name, a cell and a skin for each: offered every seat but these
 *  as taken, it lands on exactly these, in the host's order, with the host's draws. The
 *  cell it deals is thrown away -- which cell does not change what is drawn. */
export function botRows(seed: number, botSeats: Iterable<number>): { seat: number; name: string; skin: number }[] {
  const bots = new Set(botSeats);
  const taken: number[] = [];
  for (let seat = 0; seat < MAX_SEATS; seat++) if (!bots.has(seat)) taken.push(seat);
  const anywhere = [{ mapId: '', map: { group: 0, num: 0 }, x: 0, y: 0 }];
  return dealBots(seed, bots.size, taken, anywhere).map((b) => ({ seat: b.seat, name: b.name, skin: b.skin }));
}

/** A guest's reading of which seats in a `start` are bots: the ones no player in the room
 *  holds. The host knows its own for certain; everybody else has the relay's roster, and
 *  the room is locked by the time a `start` arrives. */
export function botSeatsOf(startSeats: readonly number[], roster: RosterEvent | null): number[] {
  const players = new Set((roster?.members ?? []).filter((m) => !m.spectate).map((m) => m.id));
  return startSeats.filter((seat) => !players.has(seat));
}

/** Seats in a running match that the relay has stopped listing: the ones a departure timer
 *  is for (POK-271). Bots are never relay members -- they walk on the host's page, not on a
 *  socket -- so they are skipped, or every roster event mid-match (a watcher arriving, a
 *  stand-down, anybody leaving) would count every bot still standing as gone. */
export function departedSeats(
  matchSeats: readonly number[],
  bots: ReadonlySet<number>,
  members: readonly number[],
  out: ReadonlySet<number>,
): number[] {
  const here = new Set(members);
  return matchSeats.filter((seat) => !bots.has(seat) && !here.has(seat) && !out.has(seat));
}

/** What the host hands a seat that walks in on a running match: where the fog is and how
 *  long it has (POK-260's late start, for a watcher), and one `out` for every seat already
 *  gone, in the order they went. A player back from a socket blip is a late arrival too
 *  (POK-330 #25): the relay held its seat, but everything said while it was away went to
 *  nobody -- its own elimination above all, which its page cannot hear from itself and
 *  nobody had ever told it, so it walked on as a ghost the room had already buried. */
export function catchUp(hostSeat: number, state: Pick<DirectorState, 'ring' | 'clockLeft' | 'placements'>): Msg[] {
  const out: Msg[] = [];
  if (state.ring) {
    const { phase, sx, sy, r, place } = state.ring;
    out.push({ t: 'ring', seat: hostSeat, phase, sx, sy, r, place });
    out.push({ t: 'clock', seat: hostSeat, left: state.clockLeft });
  }
  for (const seat of state.placements) out.push({ t: 'out', seat });
  return out;
}

/** The loot a seat caught up by catchUp() is owed, once (POK-330 #25): what is lying on the
 *  map its own message says it is on. A `step` says so as well as a `place`, and it is all
 *  a seat walking one route ever sends -- the ROM sends a `place` only on a map change, a
 *  warp, a ledge or the first frame after a menu or a battle (br_ghosts.c) -- so waiting
 *  for a `place` left a player back from a blip without the loot on the route it kept
 *  walking, and then handed it the next map's, which its own page already had. */
export function lootOwed(
  owed: Set<number>,
  m: Msg,
  from: number,
  forMap: (map: MapRef) => SpillMsg | null,
): SpillMsg | null {
  if (m.t !== 'place' && m.t !== 'step') return null;
  if (!m.map || m.seat !== from || !owed.delete(from)) return null;
  return forMap(m.map);
}
