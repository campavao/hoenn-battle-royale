// When a match is over: the relay ends it there (service.ts), and the page shows the
// standings once the frames that ended it have played on its own copy (main.ts).
import type { Room } from './room';

/** One left standing, or the fog lifting on the round after. A trainer who is out
 *  watches the bots play it out, as live (HBR-96): the results wait for the end. */
export function over(room: Room): boolean {
  if (room.results.winner) return true;
  return room.ring().round > room.results.round;
}
