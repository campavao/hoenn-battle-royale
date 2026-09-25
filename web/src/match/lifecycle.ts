// A room's matches, start to finish, as rules a test can hold (POK-330).
//
// app.ts's wireRoom wires a match to the relay, the ROM and the room screen; the decisions
// in that wiring -- who is still here, who a match is dealt to, what a promotion or the
// host's `again` means -- lived inside its closure, where nothing could pin them, and the
// room's worst bugs were those decisions going wrong. They are pure functions here, which
// is also the first step of pulling the match out of that closure (#42).

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
