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
import { isFinalRingPhase } from './clock';

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

/** Seconds to the next ring move once a `ring` lands: the whole phase, or none once the
 *  fog is everywhere -- what the director counts on the host. It was kept as 0, and
 *  nothing sends a `clock` during the ring, so a page picking the match up (an heir, or
 *  a host back from its own drop) read the phase as spent and moved the fog on the
 *  moment it resumed (POK-330 #47 review). */
export function ringClockLeft(phase: number, fogSecs: number): number {
  return isFinalRingPhase(phase - 1) ? 0 : fogSecs;
}

/** The match as this page hears it: what each message any page sees says about the match
 *  in progress. `match` changes in place and is never replaced, because it is the one
 *  object the page keeps (and the e2e reads) for its whole life. `fog` is the match's fog
 *  phase, from its `start`; what comes back is the one to keep. */
export function noteMatch(
  match: MatchSnapshot,
  fog: number,
  msg: Msg,
  now: number,
  page: {
    /** This page dealt the match, and set its bot seats as it did. */
    dealing: boolean;
    /** The relay's last roster, which a guest reads the bots off. */
    roster: RosterEvent | null;
    /** The fog for a `start` that names none. */
    defaultFog: number;
  },
): number {
  if (msg.t === 'start') {
    // A new match, whatever the last one left here: its eliminations, its ring, its end.
    Object.assign(match, freshMatch(), {
      seed: msg.seed,
      seats: msg.spawns.map((s) => s.seat),
      spawns: msg.spawns.map((s) => ({ map: s.map, x: s.x, y: s.y })),
      // The host set its own bot seats when it dealt them; a guest reads them off the
      // room. Read before the assign, which would otherwise hand back freshMatch's.
      botSeats: page.dealing ? match.botSeats : new Set(botSeatsOf(msg.spawns.map((s) => s.seat), page.roster)),
      active: true,
    });
    fog = msg.fog ?? page.defaultFog;
  } else if (msg.t === 'ring') {
    match.ringPhase = msg.phase;
    match.centre = { sx: msg.sx, sy: msg.sy, place: msg.place };
    match.ringR = msg.r;
    match.clockLeft = ringClockLeft(msg.phase, fog); // nothing sends a `clock` in the ring
    match.clockAt = now;
    match.active = true; // a watcher's late start: it never heard the `start`
  } else if (msg.t === 'clock') {
    match.clockLeft = msg.left;
    match.clockAt = now;
    match.active = true;
  } else if (msg.t === 'win') {
    match.ended = true;
  } else if (msg.t === 'out') {
    match.out.add(msg.seat);
  }
  return fog;
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

/** `seats` is who the match is dealt to now (seatsFor); `freshSeed` is called only when
 *  the match's own seed is not kept. */
export function dealPlan(
  match: Pick<MatchSnapshot, 'seed' | 'seats' | 'out'>,
  seats: readonly number[],
  hostSeat: number,
  takeOver: boolean,
  freshSeed: () => number,
): DealPlan {
  // A takeover keeps the match's own seed: the bots are dealt from it, and dealing
  // them again from a new one would rename everybody mid-match.
  const seed = takeOver && match.seed !== 0 ? match.seed : freshSeed();
  // Bots count down from the top seat and people count up from zero (bots/roster.ts),
  // so the bots are the run at the top of the field the match was dealt with.
  const dealtField = new Set(match.seats);
  const botSeats: number[] = [];
  for (let seat = MAX_SEATS - 1; dealtField.has(seat); seat--) botSeats.push(seat);
  const humanSeats = match.seats.filter((seat) => !dealtField.has(seat) || seat < MAX_SEATS - botSeats.length);
  // Whoever was in the match and is no longer in the room is not coming back --
  // the old host above all. Left alive they would hold the match open forever.
  const gone = takeOver
    ? humanSeats.filter((seat) => !seats.includes(seat) && seat !== hostSeat)
    : [];
  const resume = takeOver && match.seed !== 0
    ? { botSeats, humanSeats, out: new Set([...match.out, ...gone]) }
    : undefined;
  return { takeOver, seed, botSeats, humanSeats, gone, resume };
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
