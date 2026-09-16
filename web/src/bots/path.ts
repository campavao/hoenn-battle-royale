// Getting a bot from here to there (POK-236).
//
// A* over the world graph `world.ts` exposes, with two things that matter more than
// the algorithm:
//
//  - **A budget.** Hoenn is a few hundred maps. A bot asking for a route to somewhere
//    unreachable must not spend the frame finding that out, and thirty bots asking at
//    once must not spend the match. The search stops at `maxVisited` and says so.
//  - **A heuristic that survives leaving the map.** Manhattan distance is only
//    meaningful inside one map; across a seam the coordinates restart. So the estimate
//    is zero once the goal is on another map, which turns A* into Dijkstra out there --
//    slower per node, but correct, and the budget keeps it honest.
import { sameSpot, spotKey, type SeamDir, type Spot, type World } from './world';

export interface Path {
  /** The steps to walk, in order. Empty when we are already there. */
  steps: { dir: SeamDir; to: Spot }[];
  /** False when the budget ran out before the goal was found. */
  found: boolean;
  /** Nodes the search settled -- for tuning, and for tests that care it stayed cheap. */
  visited: number;
}

interface Node {
  spot: Spot;
  cost: number;
  estimate: number;
  from?: { key: string; dir: SeamDir };
}

function heuristic(a: Spot, b: Spot): number {
  if (a.map !== b.map) return 0;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export const DEFAULT_BUDGET = 4000;

export function findPath(world: World, from: Spot, to: Spot, maxVisited = DEFAULT_BUDGET): Path {
  if (sameSpot(from, to)) return { steps: [], found: true, visited: 0 };

  const open: Node[] = [{ spot: from, cost: 0, estimate: heuristic(from, to) }];
  const seen = new Map<string, Node>([[spotKey(from), open[0]]]);
  const closed = new Set<string>();
  let visited = 0;

  while (open.length > 0 && visited < maxVisited) {
    // A linear scan for the cheapest node. A heap is faster in principle; at this
    // budget it is not the cost that matters, and this is one obviously-correct line.
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].cost + open[i].estimate < open[best].cost + open[best].estimate) best = i;
    }
    const node = open.splice(best, 1)[0];
    const key = spotKey(node.spot);
    if (closed.has(key)) continue;
    closed.add(key);
    visited++;

    if (sameSpot(node.spot, to)) {
      const steps: { dir: SeamDir; to: Spot }[] = [];
      let at: Node | undefined = node;
      while (at && at.from) {
        steps.push({ dir: at.from.dir, to: at.spot });
        at = seen.get(at.from.key);
      }
      steps.reverse();
      return { steps, found: true, visited };
    }

    for (const { dir, to: next } of world.neighbours(node.spot)) {
      const nextKey = spotKey(next);
      if (closed.has(nextKey)) continue;
      const cost = node.cost + 1;
      const known = seen.get(nextKey);
      if (known && known.cost <= cost) continue;
      const entry: Node = { spot: next, cost, estimate: heuristic(next, to), from: { key, dir } };
      seen.set(nextKey, entry);
      open.push(entry);
    }
  }
  return { steps: [], found: false, visited };
}
