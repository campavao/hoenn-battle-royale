// When a match is over: the relay ends it there (service.ts), and the page shows the
// standings once the frames that ended it have played on its own copy (main.ts).
import type { Room } from './room';

/** One left standing, or nobody (the last two out on one frame). A trainer who is out
 *  watches the bots play it out, as live (HBR-96), and the fog everywhere holds until
 *  then: the results wait for the end. */
export function over(room: Room): boolean {
  const r = room.results;
  if (r.winner) return true;
  return r.entrants.length > 0 && r.entrants.every(([id]) => r.fallen.some((f) => f.id === id));
}
