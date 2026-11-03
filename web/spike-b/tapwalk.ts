// The route a tap on the map walks (main.ts tapTo): a breadth-first walk over the room's own
// step function, so it is only ever what a thumb on the pad could walk.
import type { Spot } from '../src/bots/world';
import type { Actor, Room } from './shared/room';

export type TapRoom = Pick<Room, 'stepFor' | 'actors' | 'patchesOn' | 'isTaken'>;

const spotKey = (p: Spot) => `${p.map}:${p.x}:${p.y}`;

/** A route: a direction for each step, and the cell (`map:x:y`) each one lands on, which is
 *  how the walk knows where along it the trainer is. A ledge's hop is one step but puts the
 *  trainer on two cells (the ledge at its start, the far side at its halfway frame, sim.ts),
 *  so counting the cells the trainer passes through counted that step twice and the walk
 *  stopped a step short. The last cell of a press (A) route is the goal, never stood on. */
export interface Route {
  dirs: number[];
  cells: string[];
  press: boolean;
}

/** The trainer is on `here`: the steps of the walk up to the one that lands there are done.
 *  A cell the route does not land on (a hop's ledge, a push off it) finishes none. */
export function arrived(walk: { dirs: number[]; cells: string[] }, here: string): void {
  const i = walk.cells.indexOf(here);
  if (i < 0) return;
  walk.dirs.splice(0, i + 1);
  walk.cells.splice(0, i + 1);
}

/** The steps to `goal`, or to beside it and one more toward it (a bump: face it, then A)
 *  when it cannot be stood on. A marked spot nobody has taken is a battle the moment it is
 *  stepped on, so the route goes round one when it can (a tap far off is not "fight whatever
 *  lies between"): only when every way there crosses one, or the goal is one, does it walk
 *  over it. */
export function routeTo(room: TapRoom, me: Actor, goal: Spot): Route | null {
  const marked = new Map<string, Set<string>>();
  const isMarked = (p: Spot): boolean => {
    let s = marked.get(p.map);
    if (!s) marked.set(p.map, s = new Set(room.patchesOn(p.map).filter((q) => !room.isTaken(q.key)).map((q) => `${q.x}:${q.y}`)));
    return s.has(`${p.x}:${p.y}`);
  };
  return search(room, me, goal, isMarked) ?? search(room, me, goal, () => false);
}

function search(room: TapRoom, me: Actor, goal: Spot, avoid: (p: Spot) => boolean): Route | null {
  const step = room.stepFor(me);
  const want = spotKey(goal);
  // A trainer on it: walk up and talk (the step function knows the ground, not who stands on it).
  const taken = room.actors.some((a) => a.id !== me.id && spotKey(a.m.spot) === want);
  const from = new Map<string, [string, number] | null>([[spotKey(me.m.spot), null]]);
  const q: Spot[] = [me.m.spot];
  const back = (k: string) => {
    const dirs: number[] = [], cells: string[] = [];
    for (let c = k; from.get(c); c = from.get(c)![0]) { dirs.unshift(from.get(c)![1]); cells.unshift(c); }
    return { dirs, cells };
  };
  let beside: { k: string; d: number } | null = null;
  for (let i = 0; i < q.length && i < 4000; i++) {
    const at = q[i];
    const k = spotKey(at);
    if (k === want && !taken) return { ...back(k), press: false };
    for (const d of [1, 2, 3, 4]) {
      const r = step(at, d);
      // The goal one step off, and not to be stood on: beside it is where to go.
      const dx = d === 3 ? -1 : d === 4 ? 1 : 0, dy = d === 1 ? 1 : d === 2 ? -1 : 0;
      if (!beside && at.map === goal.map && at.x + dx === goal.x && at.y + dy === goal.y && (!r || spotKey(r.to) !== want || taken)) beside = { k, d };
      if (!r || r.warp || from.has(spotKey(r.to)) || (taken && spotKey(r.to) === want)) continue;
      if (spotKey(r.to) !== want && avoid(r.to)) continue;
      from.set(spotKey(r.to), [k, d]);
      q.push(r.to);
    }
    if (beside) {
      const b = back(beside.k);
      return { dirs: [...b.dirs, beside.d], cells: [...b.cells, want], press: true };
    }
  }
  return null;
}
