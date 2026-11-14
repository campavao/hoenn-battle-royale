// A room's matches, start to finish, as rules a test can hold (POK-330).
//
// app.ts's wireRoom wires a match to the relay, the ROM and the room screen; the decisions
// in that wiring -- who is still here, who a match is dealt to, what a promotion or the
// host's `again` means -- lived inside its closure, where nothing could pin them, and the
// room's worst bugs were those decisions going wrong. They are pure functions here, which
// is also the first step of pulling the match out of that closure (#42).
import type { RosterEvent } from '../net/relay';
import type { EventMsg, MapRef, Msg, NpcOutMsg, PickupMsg, SpillMsg } from '../net/wire';
import { dealBots, MAX_SEATS } from '../bots/roster';
import type { DirectorState } from './director';
import { isFinalRingPhase } from './clock';
import { isEventKey } from './events';

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

/** A match this page is in but never heard dealt: a watcher who walked in on it, or a seat
 *  whose socket was down for the `start`. A `ring` or a `clock` says it is on, and only
 *  the `start` carries the seed it is picked up from (the bots are dealt from it). */
export function unheardMatch(match: Pick<MatchSnapshot, 'active' | 'ended' | 'seed'>): boolean {
  return match.active && !match.ended && match.seed === 0;
}

/** Whether this page offers to run the room if its host goes (POK-252's `can_host`). Not a
 *  trainer who is out: the authority stays with somebody who has a reason to stay (Kanto's
 *  POK-116). Nor a page in a match it never heard dealt, which, made host, could only hand
 *  it on (POK-331 #13): off the heir list from the start, as Kanto's late start is, it
 *  leaves the relay to wait for the host or close the room when nobody else can run it,
 *  rather than to promote a page that runs nothing. Between matches everybody offers. */
export function offersToHost(match: Pick<MatchSnapshot, 'active' | 'ended' | 'seed' | 'out'>, seat: number): boolean {
  return !match.out.has(seat) && !unheardMatch(match);
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

/** Seconds to the next ring move once a `ring` lands: the whole phase, or none once the
 *  fog is everywhere -- what the director counts on the host. It was kept as 0, and
 *  nothing sends a `clock` during the ring, so a page picking the match up (an heir, or
 *  a host back from its own drop) read the phase as spent and moved the fog on the
 *  moment it resumed (POK-330 #47 review). */
export function ringClockLeft(phase: number, fogSecs: number): number {
  return isFinalRingPhase(phase - 1) ? 0 : fogSecs;
}

/** A deal, or a takeover, worked out from the match as this page has heard it: the bots
 *  and who has gone are arithmetic on the `start` every page heard. Where each bot stands
 *  now needs the roster, which the caller adds to `resume`. */
export interface DealPlan {
  takeOver: boolean;
  seed: number;
  /** The run of seats at the top of the field the match was dealt with: its bots. */
  botSeats: number[];
  /** The seats below that run: the people. */
  humanSeats: number[];
  /** On a takeover, the people in the match who are no longer in the room. */
  gone: number[];
  /** On a takeover of a match with a seed: what its bots are dealt again from. */
  resume?: { botSeats: number[]; humanSeats: number[]; out: Set<number> };
}

/** What the host hands a seat that walks in on a running match: where the fog is and how
 *  long it has (POK-260's late start, for a watcher), and one `out` for every seat already
 *  gone, in the order they went. A player back from a socket blip is a late arrival too
 *  (POK-330 #25): the relay held its seat, but everything said while it was away went to
 *  nobody -- its own elimination above all, which its page cannot hear from itself and
 *  nobody had ever told it, so it walked on as a ghost the room had already buried. And
 *  the trainers beaten meanwhile (POK-331 #4), still standing on its screen to be beaten
 *  again: `beaten` is the session's, the newest a ROM remembers. And the events dropped
 *  meanwhile: each `event` for its mark on the MAP, what of them is still lying anywhere
 *  (the loot owed below is only the map it stands on), and a `pickup` for each legendary
 *  already gone, so that mark arrives gray. And what each house's and floor's trader holds
 *  now (HBR-34): each ROM keeps it from the trade's `pickup` and nowhere else, so a seat
 *  that missed one saw his seed Pokemon until the next. */
export function catchUp(
  hostSeat: number,
  state: Pick<DirectorState, 'ring' | 'clockLeft' | 'placements'>,
  beaten: readonly NpcOutMsg[] = [],
  events: readonly EventMsg[] = [],
  loot?: { matching(want: (key: number) => boolean): SpillMsg[]; has(key: number): boolean },
  homes: readonly PickupMsg[] = [],
  /** Who took an event's piece, when the host knows (legends.ts): the late joiner's chip
   *  names them, where the host's own seat named the host as holding the legendary. */
  takenBy: (key: number) => number | undefined = () => undefined,
): Msg[] {
  const out: Msg[] = [];
  if (state.ring) {
    const { phase, sx, sy, r, next, place } = state.ring;
    out.push({ t: 'ring', seat: hostSeat, phase, sx, sy, r, next, place });
    out.push({ t: 'clock', seat: hostSeat, left: state.clockLeft });
  }
  for (const seat of state.placements) out.push({ t: 'out', seat });
  out.push(...beaten);
  out.push(...events);
  if (loot && events.length > 0) {
    out.push(...loot.matching(isEventKey));
    for (const e of events) if (!loot.has(e.key)) out.push({ t: 'pickup', seat: takenBy(e.key) ?? hostSeat, key: e.key });
  }
  out.push(...homes);
  return out;
}

