// The search, held to the one it replaced (POK-330 #49).
//
// findPath and findPathToAny now run on the world's cell numbers with a binary heap.
// That was for speed, and speed is all it may change: every route, every `found` and
// every `visited` has to be the one the linear-scan search gave, or a bot's decisions
// change under it. So the old search is kept here, line for line on the Spot API, and
// both are asked the same questions on the real Hoenn -- random ones, and every one a
// thirty-bot match actually asks.
import { describe, expect, it, vi } from 'vitest';
import { Bots, STEP_MS } from './brain';
import { dealBots } from './roster';
import { dealParty } from './party';
import { findPath, findPathToAny, type Path } from './path';
import { World, sameSpot, spotKey, type SeamDir, type Spot, type WorldMap } from './world';
import { mulberry32, RING_RADII } from '../match/clock';
import { sectionInside } from '../match/ring';
import { LANDING } from '../match/landing';
import worldData from '../data/world.json';
import regionData from '../data/regionmap.json';

// Every search the brain makes in this file, with what it got back.
const asked = vi.hoisted(() => ({
  on: false,
  calls: [] as { any: boolean; args: unknown[]; got: Path }[],
}));
vi.mock('./path', async (importOriginal) => {
  const real = await importOriginal<typeof import('./path')>();
  return {
    ...real,
    findPath: (...args: Parameters<typeof real.findPath>) => {
      const got = real.findPath(...args);
      if (asked.on) asked.calls.push({ any: false, args, got });
      return got;
    },
    findPathToAny: (...args: Parameters<typeof real.findPathToAny>) => {
      const got = real.findPathToAny(...args);
      if (asked.on) asked.calls.push({ any: true, args, got });
      return got;
    },
  };
});

// ---- the search this replaced, as it was ------------------------------------------

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

function oldFindPath(world: World, from: Spot, to: Spot, maxVisited = 4000, surf = false, cut = false): Path {
  if (sameSpot(from, to)) return { steps: [], found: true, visited: 0 };
  const open: Node[] = [{ spot: from, cost: 0, estimate: heuristic(from, to) }];
  const seen = new Map<string, Node>([[spotKey(from), open[0]]]);
  const closed = new Set<string>();
  let visited = 0;
  while (open.length > 0 && visited < maxVisited) {
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
    for (const { dir, to: next } of world.neighbours(node.spot, surf, cut)) {
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

function oldFindPathToAny(world: World, from: Spot, goals: readonly Spot[], maxVisited = 4000, surf = false, cut = false): Path {
  const wanted = new Set(goals.map(spotKey));
  if (wanted.size === 0) return { steps: [], found: false, visited: 0 };
  if (wanted.has(spotKey(from))) return { steps: [], found: true, visited: 0 };
  const open: Node[] = [{ spot: from, cost: 0, estimate: 0 }];
  const seen = new Map<string, Node>([[spotKey(from), open[0]]]);
  const closed = new Set<string>();
  let visited = 0;
  while (open.length > 0 && visited < maxVisited) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].cost < open[best].cost) best = i;
    }
    const node = open.splice(best, 1)[0];
    const key = spotKey(node.spot);
    if (closed.has(key)) continue;
    closed.add(key);
    visited++;
    if (wanted.has(key)) {
      const steps: { dir: SeamDir; to: Spot }[] = [];
      let at: Node | undefined = node;
      while (at && at.from) {
        steps.push({ dir: at.from.dir, to: at.spot });
        at = seen.get(at.from.key);
      }
      steps.reverse();
      return { steps, found: true, visited };
    }
    for (const { dir, to: next } of world.neighbours(node.spot, surf, cut)) {
      if (next.map !== from.map && !wanted.has(spotKey(next))) continue;
      const nextKey = spotKey(next);
      if (closed.has(nextKey)) continue;
      const cost = node.cost + 1;
      const known = seen.get(nextKey);
      if (known && known.cost <= cost) continue;
      const entry: Node = { spot: next, cost, estimate: 0, from: { key, dir } };
      seen.set(nextKey, entry);
      open.push(entry);
    }
  }
  return { steps: [], found: false, visited };
}

// ---- Hoenn ---------------------------------------------------------------------------

const MAPS = (worldData as { maps: WorldMap[] }).maps;
const SECTIONS = (regionData as { sections: Record<string, { x: number; y: number; w: number; h: number }> }).sections;
const world = new World(MAPS);
const refById = new Map(MAPS.map((m) => [m.id, { group: m.group, num: m.num }]));
const outdoor = new Set(MAPS.filter((m) => m.outdoor).map((m) => m.id));
const sectionOf = new Map(MAPS.map((m) => [m.id, m.section]));
const targets = LANDING.filter((c) => outdoor.has(c.map) && refById.has(c.map)).map((c) => ({ mapId: c.map, x: c.x, y: c.y }));
const cells: Spot[] = targets.map((t) => ({ map: t.mapId, x: t.x, y: t.y }));

describe('the search on cell numbers', () => {
  it('finds what the linear-scan search found, settling the same nodes, on Hoenn', () => {
    const rng = mulberry32(49);
    const pick = () => cells[Math.floor(rng() * cells.length)];
    let found = 0;
    let exhausted = 0;
    for (let i = 0; i < 240; i++) {
      const from = pick();
      // Half on the same map, where the estimate steers; half anywhere, where it is zero
      // and most of them run out of budget -- the case that cost the milliseconds.
      const sameMap = cells.filter((c) => c.map === from.map);
      const to = i % 2 === 0 ? sameMap[Math.floor(rng() * sameMap.length)] : pick();
      const budget = [1, 9, 150, 1500, 4000][i % 5];
      const surf = i % 3 === 0;
      const cut = i % 4 !== 0;
      const want = oldFindPath(world, from, to, budget, surf, cut);
      expect(findPath(world, from, to, budget, surf, cut), `${spotKey(from)} -> ${spotKey(to)} @${budget}`).toEqual(want);
      if (want.found) found++;
      else if (want.visited === budget) exhausted++;
    }
    // Both kinds really were asked.
    expect(found).toBeGreaterThan(40);
    expect(exhausted).toBeGreaterThan(40);
  }, 30_000);

  it('routes to the nearest exit the way the linear-scan search did', () => {
    const rng = mulberry32(302);
    let asked = 0;
    for (let i = 0; i < 400 && asked < 120; i++) {
      const from = cells[Math.floor(rng() * cells.length)];
      const goal = cells[Math.floor(rng() * cells.length)].map;
      for (const hop of world.nextHops(from.map, goal)) {
        const doors = world.exitCells(from.map, hop, i % 2 === 0, true);
        const budget = [3000, 40][i % 2];
        expect(findPathToAny(world, from, doors, budget, i % 2 === 0, true), `${spotKey(from)} -> ${hop}`).toEqual(
          oldFindPathToAny(world, from, doors, budget, i % 2 === 0, true),
        );
        asked++;
      }
    }
    expect(asked).toBeGreaterThan(60);
  });

  it('agrees on the edges: nowhere to start from, and nothing to find', () => {
    const at = cells[0];
    const nowhere = { map: 'MAP_NOWHERE_AT_ALL', x: 1, y: 1 };
    expect(findPath(world, nowhere, at, 50)).toEqual(oldFindPath(world, nowhere, at, 50));
    expect(findPath(world, at, nowhere, 50)).toEqual(oldFindPath(world, at, nowhere, 50));
    expect(findPath(world, at, at)).toEqual(oldFindPath(world, at, at));
    expect(findPathToAny(world, at, [], 50)).toEqual(oldFindPathToAny(world, at, [], 50));
    expect(findPathToAny(world, at, [at], 50)).toEqual(oldFindPathToAny(world, at, [at], 50));
    expect(findPathToAny(world, at, [nowhere], 50)).toEqual(oldFindPathToAny(world, at, [nowhere], 50));
  });

  it('gives every search a thirty-bot match makes the answer the old search gave', () => {
    // Two minutes of the real brain with the ring closing every twenty seconds, so the
    // stuck bots, the fog and the cross-Hoenn misses all come up -- then each question
    // it asked goes to the old search, and the answers have to match.
    const seed = 4242;
    let ring: { sx: number; sy: number; r: number } | undefined;
    const bots = new Bots({
      world,
      targets,
      mapRef: (id) => refById.get(id),
      send: () => {},
      rng: mulberry32(seed ^ 0x51ce),
      deal: (bot, phase, mapId) => dealParty(seed, bot.seat, phase, mapId, bot.grade, []),
      centres: () => world.centres(),
      inside: (id) => ring === undefined || sectionInside(SECTIONS[sectionOf.get(id) ?? ''], ring),
    });
    const spawns = targets.map((t) => ({ mapId: t.mapId, map: refById.get(t.mapId)!, x: t.x, y: t.y }));
    bots.start(dealBots(seed, 30, [], spawns), 0);
    asked.on = true;
    asked.calls.length = 0;
    try {
      let phase = 0;
      for (let t = 100; t <= 120_000; t += 100) {
        const next = Math.floor(t / 20_000);
        if (next !== phase) {
          phase = next;
          ring = { sx: 4, sy: 12, r: RING_RADII[phase - 1] };
          bots.ringMoved(phase);
        }
        bots.tick(t);
      }
    } finally {
      asked.on = false;
    }
    const calls = asked.calls.splice(0);
    // Near two thousand on this seed: most of them to a map's edge, and hundreds that
    // found nothing -- the searches that spend their whole budget.
    expect(calls.length).toBeGreaterThan(1000);
    expect(calls.filter((c) => c.any).length).toBeGreaterThan(500);
    expect(calls.filter((c) => !c.got.found).length).toBeGreaterThan(300);
    for (const { any, args, got } of calls) {
      const want = any
        ? oldFindPathToAny(...(args as Parameters<typeof oldFindPathToAny>))
        : oldFindPath(...(args as Parameters<typeof oldFindPath>));
      expect(got).toEqual(want);
    }
    // Slow on purpose: ~2,200 searches through the old one, which is the cost this
    // ticket took out. Seconds here, and more on a shared runner.
  }, 60_000);
});

describe('the pace', () => {
  it('settles a failing cross-Hoenn search several times faster than the list did', () => {
    // Not a benchmark -- a tripwire for the search going quadratic again. A failing
    // search is the expensive kind: it spends its whole budget. Measured 2026-09-25 on
    // desktop Node, this one: 0.26 ms against 4.4 ms.
    const from = cells.find((c) => c.map === 'MAP_LITTLEROOT_TOWN') ?? cells[0];
    const to = cells.find((c) => c.map === 'MAP_FORTREE_CITY') ?? cells[cells.length - 1];
    const time = (fn: () => void) => {
      let best = Infinity;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        fn();
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const now = time(() => findPath(world, from, to, 1500, false, true));
    const then = time(() => oldFindPath(world, from, to, 1500, false, true));
    expect(findPath(world, from, to, 1500, false, true).found).toBe(false);
    expect(now * 3).toBeLessThan(then);
  });
});
