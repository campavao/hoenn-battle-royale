// A room's match, ended, as this page's results screen says it (main.ts results). Everybody
// in the room gets that screen, a trainer who played and a watcher who only came in to look
// alike (Cam, 11-21: watching SINBAD, the Hall of Fame played and then the field came back,
// not the menu). What differs is what is theirs on it: a place and a time only for somebody
// who was in the match.
import type { Results } from './shared/room';
import { standings } from './shared/over';

export interface MatchEnd {
  /** I was one of the match's entrants; false for a watcher who came in after it locked
   *  (the bench) or a page the relay let back in under another id. */
  played: boolean;
  /** My place; none for a watcher. */
  placement?: number;
  /** Seconds I lasted; none for a watcher. */
  survived?: number;
  /** Everybody's place, best first. */
  placed: { seat: number; placement: number }[];
}

/** Where the match ends for this page: the drawn results in a room (lobby), whether or not
 *  I played; the old panel over the field only in ?solo, which has no lobby to end on. */
export function endsOn(inLobby: boolean): 'results' | 'panel' {
  return inLobby ? 'results' : 'panel';
}

/** What the results say of `me` and of everybody, from the room's results at its end. */
export function matchEnd(res: Results, me: number, tick: number, epoch: number): MatchEnd {
  const place = standings(res);
  const placed = [...place].map(([seat, placement]) => ({ seat, placement })).sort((p, q) => p.placement - q.placement);
  const played = res.entrants.some(([id]) => id === me);
  if (!played) return { played, placed };
  const mine = res.fallen.find((f) => f.id === me);
  const end = mine?.at ?? res.wonAt ?? tick;
  return { played, placement: place.get(me), survived: Math.max(0, Math.round((end - epoch) / 60)), placed };
}
