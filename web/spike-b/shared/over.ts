// When a match is over: the relay ends it there (service.ts), and the page shows the
// standings once the frames that ended it have played on its own copy (main.ts).
import type { Room } from './room';

/** One left standing; or every trainer in it out (the bots would only play it out among
 *  themselves, and everybody out on one frame leaves nobody). The fog everywhere holds
 *  until then. */
export function over(room: Room): boolean {
  const r = room.results;
  if (r.winner) return true;
  // A trainer still in it is on the map: out or gone, they are among the fallen.
  return r.entrants.length > 0 && !r.entrants.some(([id]) => room.actor(id) && !room.actor(id)!.bot && !r.fallen.some((f) => f.id === id));
}
