import { describe, expect, it } from 'vitest';
import { World, decodeGrid, type WorldMap } from './world';
import { findPath } from './path';
import worldData from '../data/world.json';

// A hand-built pair of maps, so the rules are readable and a failure points at one of
// them rather than at Hoenn. Classes: 0 ground, 1 wall, 2 water, 3 a south-facing
// ledge, 7 grass.
function grid(rows: string[]): string {
  const cells = rows.join('').split('').map(Number);
  const tokens: string[] = [];
  for (let i = 0; i < cells.length; ) {
    let n = 1;
    while (i + n < cells.length && cells[i + n] === cells[i]) n++;
    tokens.push(`${n}x${cells[i]}`);
    i += n;
  }
  return tokens.join(';');
}

const ROOM: WorldMap = {
  id: 'ROOM',
  group: 0,
  num: 1,
  w: 5,
  h: 4,
  section: 'S',
  outdoor: true,
  // . . . # .
  // . # . # .
  // . # . . .
  // . . . . .   (bottom row leaves ROOM south into FIELD)
  grid: grid(['00010', '01010', '01000', '00000']),
  seams: [{ dir: 'south', to: 'FIELD', offset: 0 }],
};

const FIELD: WorldMap = {
  id: 'FIELD',
  group: 0,
  num: 2,
  w: 5,
  h: 2,
  section: 'S',
  outdoor: true,
  grid: grid(['00700', '22222']),
  seams: [{ dir: 'north', to: 'ROOM', offset: 0 }],
};

const world = new World([ROOM, FIELD]);

describe('the grid', () => {
  it('decodes to exactly w*h cells', () => {
    expect(decodeGrid(ROOM.grid, ROOM.w * ROOM.h).length).toBe(20);
  });

  it('reads walls, water and the void as places you cannot stand', () => {
    expect(world.standable('ROOM', 0, 0)).toBe(true);
    expect(world.standable('ROOM', 3, 0)).toBe(false); // wall
    expect(world.standable('FIELD', 0, 1)).toBe(false); // water
    expect(world.standable('ROOM', 99, 0)).toBe(false); // off the map
    expect(world.standable('NOWHERE', 0, 0)).toBe(false);
  });

  it('counts tall grass as ground', () => {
    expect(world.standable('FIELD', 2, 0)).toBe(true);
  });

  // The ROM's collision test, which is not the same question as "can I stand here":
  // water is somewhere you cannot walk and nothing is in the way (POK-330 #67).
  it('reads only walls and the void as in the way', () => {
    expect(world.clear('FIELD', 0, 1)).toBe(true); // water
    expect(world.clear('FIELD', 2, 0)).toBe(true); // grass
    expect(world.clear('ROOM', 3, 0)).toBe(false); // wall
    expect(world.clear('ROOM', 99, 0)).toBe(false); // off the map
  });
});

describe('one step', () => {
  it('walks onto the next cell and refuses a wall', () => {
    expect(world.step({ map: 'ROOM', x: 0, y: 0 }, 'east')).toEqual({ map: 'ROOM', x: 1, y: 0 });
    expect(world.step({ map: 'ROOM', x: 2, y: 0 }, 'east')).toBeNull();
  });

  it('crosses a seam onto the neighbour map', () => {
    expect(world.step({ map: 'ROOM', x: 2, y: 3 }, 'south')).toEqual({ map: 'FIELD', x: 2, y: 0 });
    expect(world.step({ map: 'FIELD', x: 2, y: 0 }, 'north')).toEqual({ map: 'ROOM', x: 2, y: 3 });
  });

  it('stops at an edge with no seam', () => {
    expect(world.step({ map: 'ROOM', x: 0, y: 0 }, 'north')).toBeNull();
    expect(world.step({ map: 'ROOM', x: 0, y: 1 }, 'west')).toBeNull();
  });

  it('jumps a ledge the way it faces and walks past it any other way', () => {
    const ledge = new World([
      { ...ROOM, id: 'L', seams: [], grid: grid(['00000', '03000', '00000', '00000']) },
    ]);
    // Facing south (class 3): stepping south onto it lands two cells on.
    expect(ledge.step({ map: 'L', x: 1, y: 0 }, 'south')).toEqual({ map: 'L', x: 1, y: 2 });
    // From below, the same tile is just a tile you can stand on.
    expect(ledge.step({ map: 'L', x: 1, y: 2 }, 'north')).toEqual({ map: 'L', x: 1, y: 1 });
  });

  it('offers every direction that goes somewhere', () => {
    expect(world.neighbours({ map: 'ROOM', x: 0, y: 0 }).map((n) => n.dir).sort()).toEqual([
      'east',
      'south',
    ]);
  });
});

describe('finding a way', () => {
  it('is already there', () => {
    const path = findPath(world, { map: 'ROOM', x: 0, y: 0 }, { map: 'ROOM', x: 0, y: 0 });
    expect(path).toEqual({ steps: [], found: true, visited: 0 });
  });

  it('walks around a wall, and every step is one tile from the last', () => {
    const from = { map: 'ROOM', x: 0, y: 0 };
    const to = { map: 'ROOM', x: 4, y: 0 };
    const path = findPath(world, from, to);
    expect(path.found).toBe(true);
    expect(path.steps[path.steps.length - 1].to).toEqual(to);
    let at = from;
    for (const step of path.steps) {
      expect(world.step(at, step.dir)).toEqual(step.to);
      at = step.to;
    }
  });

  it('crosses maps to get there', () => {
    const path = findPath(world, { map: 'ROOM', x: 0, y: 0 }, { map: 'FIELD', x: 4, y: 0 });
    expect(path.found).toBe(true);
    expect(path.steps.some((s) => s.to.map === 'FIELD')).toBe(true);
  });

  it('gives up on somewhere it cannot reach, without walking the whole world', () => {
    const path = findPath(world, { map: 'ROOM', x: 0, y: 0 }, { map: 'FIELD', x: 0, y: 1 });
    expect(path.found).toBe(false);
    expect(path.steps).toEqual([]);
    expect(path.visited).toBeLessThanOrEqual(ROOM.w * ROOM.h + FIELD.w * FIELD.h);
  });

  it('honours its budget', () => {
    const path = findPath(world, { map: 'ROOM', x: 0, y: 0 }, { map: 'FIELD', x: 4, y: 0 }, 2);
    expect(path.found).toBe(false);
    expect(path.visited).toBeLessThanOrEqual(2);
  });
});

describe('against the real Hoenn', () => {
  const hoenn = new World((worldData as { maps: WorldMap[] }).maps);
  const maps = (worldData as { maps: WorldMap[] }).maps;

  it('decodes every exported map', () => {
    for (const m of maps) expect(decodeGrid(m.grid, m.w * m.h).length).toBe(m.w * m.h);
  });

  it('every seam lands somewhere a trainer could have walked from', () => {
    // Not every seam cell is standable -- a cliff edge is a wall on both sides -- but a
    // seam that never lands anywhere means the offsets are wrong, and that is worth
    // knowing before thirty bots try to use them.
    let landed = 0;
    for (const m of maps) {
      for (const seam of m.seams) {
        const to = hoenn.map(seam.to);
        if (!to) continue;
        const along = seam.dir === 'north' || seam.dir === 'south' ? m.w : m.h;
        for (let i = 0; i < along; i++) {
          const spot =
            seam.dir === 'north'
              ? { map: m.id, x: i, y: 0 }
              : seam.dir === 'south'
                ? { map: m.id, x: i, y: m.h - 1 }
                : seam.dir === 'west'
                  ? { map: m.id, x: 0, y: i }
                  : { map: m.id, x: m.w - 1, y: i };
          if (hoenn.step(spot, seam.dir)) {
            landed++;
            break;
          }
        }
      }
    }
    expect(landed).toBeGreaterThan(0);
  });
});

describe('water and doors', () => {
  // A 5x1 strip with water in the middle: the only way across is SURF.
  const LAKE: WorldMap = {
    id: 'LAKE', group: 0, num: 9, w: 5, h: 1, section: 'S', outdoor: true,
    grid: grid(['00220']),
    seams: [],
    warps: [{ x: 4, y: 0, to: 'HUT', toX: 0, toY: 0, kind: 'door' }],
  };
  const HUT: WorldMap = {
    id: 'HUT', group: 0, num: 10, w: 2, h: 1, section: 'S', outdoor: false,
    grid: grid(['00']),
    seams: [],
    warps: [{ x: 0, y: 0, to: 'LAKE', toX: 3, toY: 0, kind: 'door' }],
  };
  const world = new World([LAKE, HUT]);

  it('will not step into water on foot, and will while surfing', () => {
    expect(world.step({ map: 'LAKE', x: 1, y: 0 }, 'east')).toBeNull();
    expect(world.step({ map: 'LAKE', x: 1, y: 0 }, 'east', true)).toEqual({ map: 'LAKE', x: 2, y: 0 });
  });

  it('routes across the water only with SURF', () => {
    // (3,0) is the far bank, not the door tile at (4,0) -- you cannot route TO a door,
    // only through it, because stepping onto one lands you on the other side.
    const from = { map: 'LAKE', x: 0, y: 0 };
    const to = { map: 'LAKE', x: 3, y: 0 };
    expect(findPath(world, from, to).found).toBe(false);
    expect(findPath(world, from, to, 500, true).found).toBe(true);
  });

  it('a door is a step that lands on the other side', () => {
    // (4,0) is the door tile; stepping onto it from (3,0) comes out inside the hut.
    expect(world.step({ map: 'LAKE', x: 3, y: 0 }, 'east')).toEqual({ map: 'HUT', x: 0, y: 0 });
    // And back out again, because Emerald's warps come in pairs.
    expect(world.step({ map: 'HUT', x: 1, y: 0 }, 'west')).toEqual({ map: 'LAKE', x: 3, y: 0 });
  });
});

// POK-302: a route across Hoenn is two questions -- which maps, then which cells on
// this one. These are the coarse half.
describe('the map-level plan', () => {
  const w = new World((worldData as { maps: WorldMap[] }).maps);
  const all = (worldData as { maps: WorldMap[] }).maps;
  it('counts map crossings, and says when there are none', () => {
    const first = all[0].id;
    expect(w.hops(first, first)).toBe(0);
    expect(w.hops(first, 'MAP_NOWHERE_AT_ALL')).toBeUndefined();
  });

  it('reaches Verdanturf from Littleroot in a handful of hops, not a search', () => {
    // The case Cam watched fail: four bots alive, the last ring on Verdanturf, and a
    // cell-level A* needing ~8,800 settled nodes against a budget of 1,500.
    const hops = w.hops('MAP_LITTLEROOT_TOWN', 'MAP_VERDANTURF_TOWN');
    expect(hops).toBeDefined();
    expect(hops).toBeLessThan(30);
  });

  it('every next hop is strictly closer', () => {
    const goal = 'MAP_VERDANTURF_TOWN';
    const from = 'MAP_LITTLEROOT_TOWN';
    const here = w.hops(from, goal)!;
    const next = w.nextHops(from, goal);
    expect(next.length).toBeGreaterThan(0);
    for (const n of next) expect(w.hops(n, goal)).toBeLessThan(here);
  });

  it('has nowhere to go once it is there', () => {
    expect(w.nextHops('MAP_VERDANTURF_TOWN', 'MAP_VERDANTURF_TOWN')).toEqual([]);
  });

  it('exit cells really cross onto the map they name', () => {
    const goal = 'MAP_VERDANTURF_TOWN';
    const from = 'MAP_LITTLEROOT_TOWN';
    const hop = w.nextHops(from, goal)[0];
    const cells = w.exitCells(from, hop, false, true);
    expect(cells.length).toBeGreaterThan(0);
    // Each one is a cell on `from` whose step lands on `hop`.
    for (const c of cells.slice(0, 8)) {
      expect(c.map).toBe(from);
      const landed = (['north', 'south', 'east', 'west'] as const)
        .map((d) => w.step(c, d, false, true))
        .filter((s) => s && s.map === hop);
      expect(landed.length).toBeGreaterThan(0);
    }
  });

  // Two maps carry two connections on one edge, and `seams.find()` took the first --
  // which resolved Route 111's whole west edge to Route 113 and dropped Route 112 and
  // everything behind it (Lavaridge, Jagged Pass, Mt Chimney) out of the world.
  it('sees both maps on an edge that has two', () => {
    const r111 = all.find((m) => m.id === 'MAP_ROUTE111');
    if (!r111) return; // not in this export
    const west = r111.seams.filter((s) => s.dir === 'west').map((s) => s.to);
    if (west.length < 2) return; // nothing to prove on this export
    for (const to of west) expect(w.exitCells('MAP_ROUTE111', to, false, true).length).toBeGreaterThan(0);
  });
});
