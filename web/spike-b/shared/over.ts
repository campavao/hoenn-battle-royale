// When a match is over: the relay ends it there (service.ts), and the page shows the
// standings once the frames that ended it have played on its own copy (main.ts).
import type { Results, Room } from './room';

/** One left standing, or nobody (the last two out on one frame). A trainer who is out
 *  watches the bots play it out, as live (HBR-96), and the fog everywhere holds until
 *  then: the results wait for the end. */
export function over(room: Room): boolean {
  const r = room.results;
  if (r.winner) return true;
  return r.entrants.length > 0 && r.entrants.every(([id]) => r.fallen.some((f) => f.id === id));
}

/** Each entrant's place, as the results screen gives it (main.ts results): the winner first,
 *  the last out second and so on back, and everybody still standing with nobody crowned (the
 *  last two out on one frame) first together. */
export function standings(r: Results): Map<number, number> {
  const n = r.entrants.length;
  const place = new Map<number, number>();
  if (r.winner) place.set(r.winner, 1);
  for (const [id] of r.entrants) if (!r.winner && !r.fallen.some((f) => f.id === id)) place.set(id, 1);
  r.fallen.forEach((f, i) => { if (!place.has(f.id)) place.set(f.id, n - i); });
  return place;
}
