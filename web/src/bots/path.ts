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
//
// And then the algorithm did matter (POK-330 #49): at thirty bots a failing search cost
// the host's tab several milliseconds, most of it a linear scan of the open list, a
// string key built and hashed for every neighbour, and a Spot and an array allocated
// for each one. The search now runs on the world's cell numbers, with a binary heap and
// flat arrays reused from one search to the next. It settles the same nodes in the same
// order as the list it replaced -- path.test.ts runs that one beside it on Hoenn -- so
// every route, and every `visited`, is the one it always was.
import { DIRS, sameSpot, type SeamDir, type Spot, type World } from './world';

export interface Path {
  /** The steps to walk, in order. Empty when we are already there. */
  steps: { dir: SeamDir; to: Spot }[];
  /** False when the budget ran out before the goal was found. */
  found: boolean;
  /** Nodes the search settled -- for tuning, and for tests that care it stayed cheap. */
  visited: number;
}

export const DEFAULT_BUDGET = 4000;

/** One search's bookkeeping, a slot per cell of the world, kept between searches. A
 *  slot counts as written only when its stamp is this search's: bumping `gen` clears
 *  all of them at once, which is what lets a search that settles forty nodes not pay
 *  for the three hundred thousand it never touched. */
interface Scratch {
  gen: number;
  /** gen * 2 while a cell is open, gen * 2 + 1 once it is settled. */
  state: Int32Array;
  cost: Int32Array;
  /** The cell this one was reached from, times four, plus the direction taken. */
  from: Int32Array;
  heap: Heap;
}

const scratches = new WeakMap<World, Scratch>();

function scratchFor(world: World): Scratch {
  let s = scratches.get(world);
  if (!s) {
    const n = world.cellCount;
    s = { gen: 0, state: new Int32Array(n), cost: new Int32Array(n), from: new Int32Array(n), heap: new Heap() };
    scratches.set(world, s);
  }
  // Stamps are gen * 2 (+1): wrap long before that leaves an int32.
  if (s.gen >= 0x3ffffff0) {
    s.gen = 0;
    s.state.fill(0);
  }
  s.gen++;
  s.heap.clear();
  return s;
}

/** A binary min-heap of cells. The priority is the estimate first and then the order
 *  the cells were pushed in -- exactly what the linear scan it replaced picked (the
 *  first cheapest in insertion order), so ties break the same way and the route is the
 *  same route. Both fit in one double: f * 2^32 + push number. */
class Heap {
  private prio = new Float64Array(1024);
  private keys = new Int32Array(1024);
  size = 0;
  private pushed = 0;

  clear(): void {
    this.size = 0;
    this.pushed = 0;
  }

  push(key: number, f: number): void {
    if (this.size === this.keys.length) {
      const prio = new Float64Array(this.size * 2);
      prio.set(this.prio);
      this.prio = prio;
      const keys = new Int32Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
    }
    const p = f * 4294967296 + this.pushed++;
    let i = this.size++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.prio[up] <= p) break;
      this.prio[i] = this.prio[up];
      this.keys[i] = this.keys[up];
      i = up;
    }
    this.prio[i] = p;
    this.keys[i] = key;
  }

  pop(): number {
    const top = this.keys[0];
    const last = --this.size;
    const p = this.prio[last];
    const key = this.keys[last];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= last) break;
      if (child + 1 < last && this.prio[child + 1] < this.prio[child]) child++;
      if (this.prio[child] >= p) break;
      this.prio[i] = this.prio[child];
      this.keys[i] = this.keys[child];
      i = child;
    }
    this.prio[i] = p;
    this.keys[i] = key;
    return top;
  }
}

/** What a search is looking for, and where it may look. */
interface Goal {
  /** The one cell wanted, or -1 (then `any`, or nothing reachable at all). */
  cell: number;
  any: Set<number> | null;
  /** Estimate towards (x, y) on this map number; -1 for none, which is Dijkstra. */
  map: number;
  x: number;
  y: number;
  /** Never step off this map number except onto a wanted cell; -1 for anywhere. */
  stayOn: number;
}

function search(world: World, start: number, goal: Goal, maxVisited: number, surf: boolean, cut: boolean): Path {
  const s = scratchFor(world);
  const { state, cost, from, heap } = s;
  const open = s.gen * 2;
  const settled = open + 1;
  const estimate = goal.map >= 0;
  state[start] = open;
  cost[start] = 0;
  from[start] = -1;
  heap.push(start, estimate ? world.estimate(start, goal.map, goal.x, goal.y) : 0);
  let visited = 0;

  while (heap.size > 0 && visited < maxVisited) {
    const at = heap.pop();
    // A cell reached again more cheaply is in the heap twice; the dearer copy comes out
    // after the cell is settled and is nothing.
    if (state[at] === settled) continue;
    state[at] = settled;
    visited++;

    if (at === goal.cell || (goal.any !== null && goal.any.has(at))) {
      const steps: { dir: SeamDir; to: Spot }[] = [];
      for (let k = at; from[k] >= 0; k = from[k] >> 2) steps.push({ dir: DIRS[from[k] & 3], to: world.spotAt(k) });
      steps.reverse();
      return { steps, found: true, visited };
    }

    const next = cost[at] + 1;
    for (let d = 0; d < 4; d++) {
      const to = world.stepKey(at, d, surf, cut);
      if (to < 0) continue;
      // findPathToAny stays on its map, stepping off it only onto a goal: the goals are
      // where this map's exits come out, and wandering onto the neighbour mid-search is
      // how a "route to the next map" becomes a route across Hoenn.
      if (goal.stayOn >= 0 && world.mapOf(to) !== goal.stayOn && !goal.any?.has(to)) continue;
      const was = state[to];
      if (was === settled) continue;
      if (was === open && cost[to] <= next) continue;
      state[to] = open;
      cost[to] = next;
      from[to] = at * 4 + d;
      heap.push(to, estimate ? next + world.estimate(to, goal.map, goal.x, goal.y) : next);
    }
  }
  return { steps: [], found: false, visited };
}

/** A start with no cell -- a map the world does not have, or the void off one. The
 *  search it replaced settled it and found no way out, and said so. */
function nowhere(maxVisited: number): Path {
  return { steps: [], found: false, visited: maxVisited > 0 ? 1 : 0 };
}

export function findPath(world: World, from: Spot, to: Spot, maxVisited = DEFAULT_BUDGET, surf = false, cut = false): Path {
  if (sameSpot(from, to)) return { steps: [], found: true, visited: 0 };
  const start = world.key(from);
  if (start < 0) return nowhere(maxVisited);
  // A goal with no cell is never found; the search spends its budget finding that out,
  // as it always did.
  return search(
    world,
    start,
    { cell: world.key(to), any: null, map: world.mapNumber(to.map), x: to.x, y: to.y, stayOn: -1 },
    maxVisited,
    surf,
    cut,
  );
}

/** The nearest of several goals, in one search (POK-302).
 *
 *  This is what a cross-map route is actually made of: the goals are every cell on the
 *  next map that a step off this one lands on (`World.entryCells`), and any of them will
 *  do -- so the route ends with the crossing, through a door as well as over a seam.
 *  Running `findPath` once per candidate would settle the same nodes over and over -- an
 *  edge can be forty cells wide -- and stop at the budget forty times.
 *
 *  Kanto's `Bots.pathToAny` (lib/bots.lua:826) is the same idea for the same reason. The
 *  estimate is zero throughout: with several goals on one map there is no admissible
 *  Manhattan target, so this is Dijkstra, which is correct and -- bounded to one map --
 *  cheap. That bound is the point: the searches this replaces were unbounded across
 *  Hoenn and cost about 8,800 nodes against a budget of 1,500.
 */
export function findPathToAny(world: World, from: Spot, goals: readonly Spot[], maxVisited = DEFAULT_BUDGET, surf = false, cut = false): Path {
  if (goals.length === 0) return { steps: [], found: false, visited: 0 };
  const wanted = new Set<number>();
  for (const g of goals) {
    const k = world.key(g);
    if (k >= 0) wanted.add(k);
  }
  const start = world.key(from);
  if (start >= 0 ? wanted.has(start) : goals.some((g) => sameSpot(g, from))) return { steps: [], found: true, visited: 0 };
  if (start < 0) return nowhere(maxVisited);
  return search(world, start, { cell: -1, any: wanted, map: -1, x: 0, y: 0, stayOn: world.mapOf(start) }, maxVisited, surf, cut);
}
