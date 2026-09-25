// A room's matches, start to finish, as rules a test can hold (POK-330).
//
// app.ts's wireRoom wires a match to the relay, the ROM and the room screen; the decisions
// in that wiring -- who is still here, who a match is dealt to, what a promotion or the
// host's `again` means -- lived inside its closure, where nothing could pin them, and the
// room's worst bugs were those decisions going wrong. They are pure functions here, which
// is also the first step of pulling the match out of that closure (#42).
import type { RosterEvent } from '../net/relay';
import { dealBots, MAX_SEATS } from '../bots/roster';

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
