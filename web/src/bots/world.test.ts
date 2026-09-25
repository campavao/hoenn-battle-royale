import { describe, expect, it } from 'vitest';
import { DIRS, World, decodeGrid, type Reach, type Spot, type WorldMap } from './world';
import { findPath, findPathToAny } from './path';
import { HOENN } from './hoenn';
import { LANDING } from '../match/landing';
import worldData from '../data/world.json';

// A hand-built pair of maps, so the rules are readable and a failure points at one of
// them rather than at Hoenn. Classes: 0 ground, 1 wall, 2 water, 3 a south-facing
// ledge, 7 grass. Heights are one hex digit a cell (radix 16), 15 an F.
function grid(rows: string[], radix = 10): string {
  const cells = rows.join('').split('').map((c) => parseInt(c, radix));
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

// POK-330 #49: the search walks cell numbers, not spots. It is only as right as
// `stepKey` is the same rule as `step`, so that is checked on every cell there is.
describe('the cell graph', () => {
  const maps = (worldData as { maps: WorldMap[] }).maps;
  const hoenn = new World(maps);

  it('numbers every cell of Hoenn once, map after map, and reads each one back', () => {
    const bad: string[] = [];
    let n = 0;
    for (const m of maps) {
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const k = hoenn.key({ map: m.id, x, y });
          const back = hoenn.spotAt(k);
          if (k !== n++ || back.map !== m.id || back.x !== x || back.y !== y) bad.push(`${m.id} ${x},${y}`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    // Past the last cell, the bridges' levels (POK-331 #2): each a height-15 cell again,
    // once for every height its edges step off at, and it reads back as that level.
    expect(hoenn.cellCount - n).toBeGreaterThan(400);
    for (let k = n; k < hoenn.cellCount; k++) {
      const at = hoenn.spotAt(k);
      const cell = hoenn.key({ map: at.map, x: at.x, y: at.y });
      if (at.z === undefined || hoenn.height(at.map, at.x, at.y) !== 15 || hoenn.key(at) !== k || hoenn.cellOf(k) !== cell) {
        bad.push(`level ${k}: ${at.map} ${at.x},${at.y}@${at.z}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(hoenn.key({ map: maps[0].id, x: -1, y: 0 })).toBe(-1);
    expect(hoenn.key({ map: 'MAP_NOWHERE_AT_ALL', x: 0, y: 0 })).toBe(-1);
  });

  it('steps on the numbers exactly as it steps on spots, everywhere, with and without HMs', () => {
    const bad: string[] = [];
    const kit: [boolean, boolean][] = [[false, false], [true, false], [false, true], [true, true]];
    // Every node: each cell, and each level of a bridge.
    for (let k = 0; k < hoenn.cellCount; k++) {
      const spot = hoenn.spotAt(k);
      const at = `${spot.map} ${spot.x},${spot.y}${spot.z === undefined ? '' : `@${spot.z}`}`;
      for (const [surf, cut] of kit) {
        for (let d = 0; d < 4; d++) {
          const landed = hoenn.step(spot, DIRS[d], surf, cut);
          // A step to somewhere with no number would be one the search cannot take.
          if (landed && hoenn.key(landed) < 0) bad.push(`${at} ${DIRS[d]} lands off the grid`);
          const want = landed ? hoenn.key(landed) : -1;
          if (hoenn.stepKey(k, d, surf, cut) !== want) bad.push(`${at} ${DIRS[d]} surf=${surf} cut=${cut}`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('works out the exits between two maps once, and again only for a different kit', () => {
    const from = 'MAP_LITTLEROOT_TOWN';
    const hop = hoenn.nextHops(from, 'MAP_VERDANTURF_TOWN')[0];
    const cells = hoenn.exitCells(from, hop, false, true);
    expect(cells.length).toBeGreaterThan(0);
    expect(hoenn.exitCells(from, hop, false, true)).toBe(cells);
    expect(hoenn.exitCells(from, hop, true, true)).not.toBe(cells);
    const over = hoenn.entryCells(from, hop, false, true);
    expect(hoenn.entryCells(from, hop, false, true)).toBe(over);
    expect(hoenn.entryCells(from, hop, true, true)).not.toBe(over);
  });

  it('finds every cell a step off one map lands on of the next, and nothing else', () => {
    // POK-330 #49 review: what a route to the next map aims at, checked the long way --
    // every standable cell of `from`, every direction -- over a seam, a door-only hop
    // (Route 116's cave mouths), and a Centre's door, with and without SURF.
    const pairs: [string, string][] = [
      ['MAP_LITTLEROOT_TOWN', 'MAP_ROUTE101'],
      ['MAP_ROUTE116', 'MAP_RUSTURF_TUNNEL'],
      ['MAP_RUSTURF_TUNNEL', 'MAP_ROUTE116'],
      ['MAP_OLDALE_TOWN_POKEMON_CENTER_1F', 'MAP_OLDALE_TOWN'],
      ['MAP_ROUTE104', 'MAP_PETALBURG_WOODS'],
    ];
    for (const [from, to] of pairs) {
      const m = maps.find((x) => x.id === from)!;
      for (const surf of [false, true]) {
        const want = new Set<number>();
        for (let y = 0; y < m.h; y++) {
          for (let x = 0; x < m.w; x++) {
            if (!hoenn.standable(from, x, y, surf, true)) continue;
            for (let d = 0; d < 4; d++) {
              const k = hoenn.stepKey(hoenn.key({ map: from, x, y }), d, surf, true);
              if (k >= 0 && hoenn.spotAt(k).map === to) want.add(k);
            }
          }
        }
        const got = hoenn.entryCells(from, to, surf, true).map((s) => hoenn.key(s));
        expect(want.size, `${from} -> ${to}`).toBeGreaterThan(0);
        expect(new Set(got), `${from} -> ${to} surf=${surf}`).toEqual(want);
        expect(got.length).toBe(want.size);
      }
    }
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

  it('says where a crossing comes out: the far end of the door, not the door', () => {
    // The door tile is the exit, and no route can end on it (POK-330 #49 review).
    expect(world.exitCells('LAKE', 'HUT')).toEqual([{ map: 'LAKE', x: 4, y: 0 }]);
    expect(world.entryCells('LAKE', 'HUT')).toEqual([{ map: 'HUT', x: 0, y: 0 }]);
    expect(world.entryCells('HUT', 'LAKE')).toEqual([{ map: 'LAKE', x: 3, y: 0 }]);
    expect(world.entryCells('LAKE', 'NOWHERE')).toEqual([]);
  });
});

// POK-331 #2: Emerald keeps you off a cliff by height, not by the collision bit, and
// world.json had no heights -- so a bot walked straight up the Safari Zone's cliffs.
// pret's rule is IsElevationMismatchAt (event_object_movement.c): a step between two
// heights is refused unless one is 0 (a transition) or the cell is 15 (a bridge).
describe('heights', () => {
  // Ground at 3 on the left, a plateau at 4 on the right, a stair (0) at the top
  // between them, and the sea (1) along the bottom.
  const CLIFF: WorldMap = {
    id: 'CLIFF', group: 0, num: 11, w: 4, h: 3, section: 'S', outdoor: true,
    grid: grid(['0000', '0000', '2222']),
    elev: grid(['3044', '3344', '1111'], 16),
    seams: [],
  };
  const w = new World([CLIFF]);
  const at = (x: number, y: number) => ({ map: 'CLIFF', x, y });

  it('will not step up or down a cliff face', () => {
    expect(w.step(at(1, 1), 'east')).toBeNull();
    expect(w.step(at(2, 1), 'west')).toBeNull();
    expect(w.step(at(1, 1), 'east', true, true)).toBeNull();
  });

  it('takes the stairs: a transition meets every height', () => {
    expect(w.step(at(1, 1), 'north')).toEqual(at(1, 0));
    expect(w.step(at(1, 0), 'east')).toEqual(at(2, 0));
    expect(w.step(at(2, 0), 'west')).toEqual(at(1, 0));
    const path = findPath(w, at(1, 1), at(2, 1));
    expect(path.steps.map((s) => s.to)).toEqual([at(1, 0), at(2, 0), at(2, 1)]);
  });

  it('surfs off the ground and back onto it -- but not off the plateau, a cliff over the sea', () => {
    expect(w.step(at(0, 1), 'south')).toBeNull();
    expect(w.step(at(0, 1), 'south', true)).toEqual(at(0, 2));
    expect(w.step(at(0, 2), 'north', true)).toEqual(at(0, 1));
    expect(w.step(at(3, 1), 'south', true)).toBeNull();
    expect(w.step(at(3, 2), 'north', true)).toBeNull();
  });

  it('never asks a door or a ledge', () => {
    // A door is pressed into, not climbed onto, and pret tries a ledge before the height.
    const DOOR: WorldMap = {
      ...CLIFF, id: 'DOOR', w: 2, h: 3,
      grid: grid(['00', '03', '00']),
      elev: grid(['55', '35', '33'], 16),
      warps: [{ x: 0, y: 0, to: 'DOOR', toX: 1, toY: 2, kind: 'door' }],
    };
    const d = new World([DOOR]);
    expect(d.step({ map: 'DOOR', x: 0, y: 1 }, 'north')).toEqual({ map: 'DOOR', x: 1, y: 2 });
    expect(d.step({ map: 'DOOR', x: 1, y: 0 }, 'south')).toEqual({ map: 'DOOR', x: 1, y: 2 });
  });

  it('holds across a seam', () => {
    const LOW: WorldMap = {
      ...CLIFF, id: 'LOW', w: 2, h: 1, grid: grid(['00']), elev: grid(['33'], 16),
      seams: [{ dir: 'north', to: 'HIGH', offset: 0 }],
    };
    const HIGH: WorldMap = {
      ...CLIFF, id: 'HIGH', w: 2, h: 1, grid: grid(['00']), elev: grid(['30'], 16),
      seams: [{ dir: 'south', to: 'LOW', offset: 0 }],
    };
    expect(new World([LOW, HIGH]).step({ map: 'LOW', x: 0, y: 0 }, 'north')).toEqual({ map: 'HIGH', x: 0, y: 0 });
    const cliff = new World([LOW, { ...HIGH, elev: grid(['40'], 16) }]);
    expect(cliff.step({ map: 'LOW', x: 0, y: 0 }, 'north')).toBeNull();
    expect(cliff.step({ map: 'LOW', x: 1, y: 0 }, 'north')).toEqual({ map: 'HIGH', x: 1, y: 0 });
  });

  // A bridge remembers: a trainer on a height-15 cell keeps the height they came on at
  // (ObjectEventUpdateElevation), so a road at 4 over a path at 3 cross without meeting.
  describe('a bridge', () => {
    const CROSS: WorldMap = {
      ...CLIFF, id: 'CROSS', w: 3, h: 3,
      grid: grid(['101', '000', '101']),
      elev: grid(['040', '3F3', '040'], 16),
    };
    const b = new World([CROSS]);
    const c = (x: number, y: number, z?: number) => (z === undefined ? { map: 'CROSS', x, y } : { map: 'CROSS', x, y, z });

    it('is two places, one a level', () => {
      expect(b.cellCount).toBe(9 + 2);
      expect(b.step(c(0, 1), 'east')).toEqual(c(1, 1, 3));
      expect(b.step(c(1, 0), 'south')).toEqual(c(1, 1, 4));
    });

    it('lets each level off only at its own height', () => {
      expect(b.step(c(1, 1, 3), 'east')).toEqual(c(2, 1));
      expect(b.step(c(1, 1, 3), 'north')).toBeNull();
      expect(b.step(c(1, 1, 4), 'south')).toEqual(c(1, 2));
      expect(b.step(c(1, 1, 4), 'west')).toBeNull();
      expect(findPath(b, c(0, 1), c(1, 0)).found).toBe(false);
      expect(findPath(b, c(1, 0), c(1, 2)).steps.map((s) => s.to)).toEqual([c(1, 1, 4), c(1, 2)]);
    });

    it('lets a trainer on it at no level off at any height: dropped there, pret starts them at 0', () => {
      expect(b.neighbours(c(1, 1)).map((n) => n.dir).sort()).toEqual(['east', 'north', 'south', 'west']);
    });
  });

  describe('in Hoenn', () => {
    const hoenn = new World((worldData as { maps: WorldMap[] }).maps);
    const north = (x: number, y: number) => ({ map: 'MAP_SAFARI_ZONE_NORTH', x, y });

    it('keeps the Safari Zone North plateau off the ground below it', () => {
      // The case the ticket names: one step apart, and a cliff between.
      expect(hoenn.height('MAP_SAFARI_ZONE_NORTH', 22, 29)).toBe(5);
      expect(hoenn.height('MAP_SAFARI_ZONE_NORTH', 22, 28)).toBe(3);
      expect(hoenn.standable('MAP_SAFARI_ZONE_NORTH', 22, 28)).toBe(true);
      expect(hoenn.step(north(22, 29), 'north', true, true)).toBeNull();
      expect(hoenn.step(north(22, 28), 'south', true, true)).toBeNull();
      // The way down is the stairs at (22,23), and the route takes them.
      const path = findPath(hoenn, north(22, 29), north(22, 28), 4000, false, true);
      expect(path.found).toBe(true);
      expect(path.steps.length).toBeGreaterThan(10);
      expect(path.steps.some((s) => s.to.x === 22 && s.to.y === 23)).toBe(true);
    });

    it('leaves the stairs open', () => {
      expect(hoenn.height('MAP_SAFARI_ZONE_NORTH', 22, 23)).toBe(0);
      expect(hoenn.step(north(22, 24), 'north')).toEqual(north(22, 23));
      expect(hoenn.step(north(22, 23), 'north')).toEqual(north(22, 22));
      expect(hoenn.step(north(22, 22), 'south')).toEqual(north(22, 23));
      expect(hoenn.step(north(22, 23), 'south')).toEqual(north(22, 24));
    });

    it('runs the cycling road over the Route 110 path without the two meeting', () => {
      const r110 = (x: number, y: number, z?: number) =>
        z === undefined ? { map: 'MAP_ROUTE110', x, y } : { map: 'MAP_ROUTE110', x, y, z };
      expect(hoenn.height('MAP_ROUTE110', 26, 15)).toBe(15);
      const under = hoenn.step(r110(25, 15), 'east');
      expect(under).toEqual(r110(26, 15, 3));
      expect(hoenn.step(under!, 'north')).toBeNull();
      expect(hoenn.step(under!, 'east')).toEqual(r110(27, 15, 3));
      const over = hoenn.step(r110(26, 14), 'south');
      expect(over).toEqual(r110(26, 15, 4));
      expect(hoenn.step(over!, 'south')).toEqual(r110(26, 16));
      expect(hoenn.step(over!, 'west')).toBeNull();
    });
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

  // POK-331 #27: an edge is only an edge if a step crosses it, with the kit in hand.
  it('counts no hop over a seam no step crosses: Route 114 to 115 is through Meteor Falls', () => {
    expect(w.entryCells('MAP_ROUTE114', 'MAP_ROUTE115', true, true)).toEqual([]);
    expect(w.hops('MAP_ROUTE114', 'MAP_ROUTE115')).toBe(2);
    expect(w.nextHops('MAP_ROUTE114', 'MAP_ROUTE115')).toEqual(['MAP_METEOR_FALLS_1F_1R']);
    expect(w.hops('MAP_ROUTE114', 'MAP_ROUTE115', true, true)).toBe(2);
  });

  it('counts a hop over the water only for a trainer who can SURF', () => {
    const SHORE: WorldMap = {
      id: 'SHORE', group: 0, num: 40, w: 2, h: 1, section: 'S', outdoor: true,
      grid: grid(['00']), seams: [{ dir: 'east', to: 'SEA', offset: 0 }],
    };
    const SEA: WorldMap = { ...SHORE, id: 'SEA', num: 41, grid: grid(['22']), seams: [{ dir: 'west', to: 'SHORE', offset: 0 }] };
    const sea = new World([SHORE, SEA]);
    expect(sea.hops('SHORE', 'SEA')).toBeUndefined();
    expect(sea.nextHops('SHORE', 'SEA')).toEqual([]);
    expect(sea.hops('SHORE', 'SEA', true)).toBe(1);
    expect(sea.nextHops('SHORE', 'SEA', true)).toEqual(['SEA']);
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

// POK-331 #27: a lake or a wood can cut a map in two, and a bot drawing a cell of its own
// map to wander to drew one on the far side about half the time on Route 104.
describe('what a trainer can walk to without leaving the map', () => {
  // A lake down the middle, a south-facing ledge (3) on the west bank, and a seam off the
  // east bank onto a strip that joins back onto the west bank's north row.
  //   0 0 2 0 0
  //   0 3 2 0 0
  //   0 0 2 0 0
  const SPLIT: WorldMap = {
    id: 'SPLIT', group: 0, num: 30, w: 5, h: 3, section: 'S', outdoor: true,
    grid: grid(['00200', '03200', '00200']),
    seams: [{ dir: 'south', to: 'STRIP', offset: 0 }],
  };
  const STRIP: WorldMap = {
    id: 'STRIP', group: 0, num: 31, w: 5, h: 1, section: 'S', outdoor: true,
    grid: grid(['00000']),
    seams: [{ dir: 'north', to: 'SPLIT', offset: 0 }],
  };
  const w = new World([SPLIT, STRIP]);
  const at = (x: number, y: number) => ({ map: 'SPLIT', x, y });

  it('is this side of the water, and the far side too with SURF', () => {
    const west = w.reachOnMap(at(0, 0));
    expect(west.cell(0, 2)).toBe(true);
    expect(west.cell(1, 2)).toBe(true);
    expect(west.cell(3, 0)).toBe(false);
    expect(west.cell(2, 0)).toBe(false);
    expect(w.reachOnMap(at(0, 0), true).cell(4, 2)).toBe(true);
  });

  it('is not the far side just because another map joins them', () => {
    // The strip below joins both banks: the far bank is a route away, not a walk on this map.
    expect(findPath(w, at(0, 2), at(4, 2)).found).toBe(true);
    const west = w.reachOnMap(at(0, 2));
    expect(west.cell(4, 2)).toBe(false);
    expect(west.across({ map: 'STRIP', x: 0, y: 0 })).toBe(true);
    expect(west.across({ map: 'STRIP', x: 4, y: 0 })).toBe(false);
  });

  it('goes through a one-way step only the way it goes', () => {
    // A door on the west side lands on the east, with no way back: the one step here
    // that does not go both ways, so the two sides reach differently.
    const DROP: WorldMap = {
      ...SPLIT, id: 'DROP', w: 3, seams: [], grid: grid(['010', '010', '010']),
      warps: [{ x: 0, y: 0, to: 'DROP', toX: 2, toY: 2, kind: 'door' }],
    };
    const d = new World([DROP]);
    const west = d.reachOnMap({ map: 'DROP', x: 0, y: 2 });
    expect(west.cell(2, 0)).toBe(true);
    expect(west.cell(0, 0)).toBe(false); // the door: stood on, you are somewhere else
    const east = d.reachOnMap({ map: 'DROP', x: 2, y: 0 });
    expect(east.cell(2, 2)).toBe(true);
    expect(east.cell(0, 2)).toBe(false);
  });

  it('is nothing from off the map, or from a map the world does not have', () => {
    expect(w.reachOnMap(at(9, 9)).cell(0, 0)).toBe(false);
    expect(w.reachOnMap({ map: 'NOWHERE', x: 0, y: 0 }).cell(0, 0)).toBe(false);
  });

  it('agrees with a search on every pair of cells of a map, both banks and the ledge', () => {
    for (let fy = 0; fy < 3; fy++) {
      for (let fx = 0; fx < 5; fx++) {
        if (!w.standable('SPLIT', fx, fy)) continue;
        const reach = w.reachOnMap(at(fx, fy));
        for (let y = 0; y < 3; y++) {
          for (let x = 0; x < 5; x++) {
            if (!w.standable('SPLIT', x, y) || (x === fx && y === fy)) continue;
            // A search that may not leave the map: the goal is any cell but this one, so
            // the start's map is the only one it walks.
            const onMap = findPathToAny(w, at(fx, fy), [at(x, y)]).found;
            expect(reach.cell(x, y), `${fx},${fy} -> ${x},${y}`).toBe(onMap);
          }
        }
      }
    }
  });

  describe('the first crossing on the way', () => {
    // LAKE's halves are joined only by WOOD, west of it; GOAL is off the south half's
    // east edge, so the map-level plan calls it one hop from all of LAKE.
    const LAKE: WorldMap = {
      id: 'LAKE', group: 0, num: 32, w: 5, h: 5, section: 'S', outdoor: true,
      grid: grid(['00000', '00000', '22222', '00000', '00000']),
      seams: [{ dir: 'west', to: 'WOOD', offset: 0 }, { dir: 'east', to: 'GOAL', offset: 3 }],
    };
    const WOOD: WorldMap = { ...LAKE, id: 'WOOD', num: 33, w: 1, grid: grid(['0', '0', '0', '0', '0']), seams: [{ dir: 'east', to: 'LAKE', offset: 0 }] };
    const GOAL: WorldMap = { ...LAKE, id: 'GOAL', num: 34, w: 2, h: 2, grid: grid(['00', '00']), seams: [{ dir: 'west', to: 'LAKE', offset: -3 }] };
    const lw = new World([LAKE, WOOD, GOAL]);
    const lake = (x: number, y: number) => ({ map: 'LAKE', x, y });
    const inOrder = (spots: Spot[] | undefined) => spots && [...spots].sort((a, b) => a.y - b.y || a.x - b.x);

    it('is the plan where this side can get to it', () => {
      expect(lw.nextHops('LAKE', 'GOAL')).toEqual(['GOAL']);
      expect(inOrder(lw.firstCrossing(lake(2, 4), 'GOAL'))).toEqual([{ map: 'GOAL', x: 0, y: 0 }, { map: 'GOAL', x: 0, y: 1 }]);
    });

    it('goes round where it cannot', () => {
      const over = lw.firstCrossing(lake(2, 0), 'GOAL')!;
      expect(over.map((s) => s.map)).toEqual(['WOOD', 'WOOD']);
      // ...and from the wood, back onto the half that gets there, not the one it left.
      expect(inOrder(lw.firstCrossing({ map: 'WOOD', x: 0, y: 0 }, 'GOAL'))).toEqual([lake(0, 3), lake(0, 4)]);
    });

    it('arrives only where it is asked to: not in a pocket off the edge of the goal map', () => {
      // START's east edge lands in HUB's west pocket; HUB's main part, where the target is,
      // is reached round by SIDE.
      const START: WorldMap = { ...LAKE, id: 'START', num: 35, w: 3, h: 1, grid: grid(['000']), seams: [
        { dir: 'east', to: 'HUB', offset: 0 }, { dir: 'south', to: 'SIDE', offset: 0 },
      ] };
      const HUB: WorldMap = { ...LAKE, id: 'HUB', num: 36, w: 3, h: 2, grid: grid(['010', '110']), seams: [
        { dir: 'west', to: 'START', offset: 0 }, { dir: 'south', to: 'SIDE', offset: 0 },
      ] };
      const SIDE: WorldMap = { ...LAKE, id: 'SIDE', num: 37, w: 3, h: 1, grid: grid(['000']), seams: [
        { dir: 'north', to: 'HUB', offset: 0 },
      ] };
      const hw = new World([START, HUB, SIDE]);
      const at = { map: 'START', x: 0, y: 0 };
      expect(hw.firstCrossing(at, 'HUB')).toEqual([{ map: 'HUB', x: 0, y: 0 }]);
      const target = (reach: Reach) => reach.cell(2, 0);
      expect(inOrder(hw.firstCrossing(at, 'HUB', false, false, target))).toEqual([0, 1, 2].map((x) => ({ map: 'SIDE', x, y: 0 })));
    });

    it('is nothing from the goal itself, from nowhere, towards nowhere, or past its limit', () => {
      expect(lw.firstCrossing({ map: 'GOAL', x: 0, y: 0 }, 'GOAL')).toBeUndefined();
      expect(lw.firstCrossing(lake(9, 9), 'GOAL')).toBeUndefined();
      expect(lw.firstCrossing(lake(2, 0), 'NOWHERE')).toBeUndefined();
      expect(lw.firstCrossing(lake(2, 0), 'GOAL', false, false, undefined, 2)).toBeUndefined();
    });
  });

  describe('in Hoenn', () => {
    const hoenn = HOENN.world;
    const r104 = (x: number, y: number) => ({ map: 'MAP_ROUTE104', x, y });

    it('takes the north half of Route 104 to Petalburg through the woods, and the beach straight there', () => {
      expect(hoenn.nextHops('MAP_ROUTE104', 'MAP_PETALBURG_CITY')).toEqual(['MAP_PETALBURG_CITY']);
      const north = hoenn.firstCrossing(r104(10, 29), 'MAP_PETALBURG_CITY')!;
      expect(new Set(north.map((s) => s.map))).toEqual(new Set(['MAP_PETALBURG_WOODS']));
      const south = hoenn.firstCrossing(r104(15, 41), 'MAP_PETALBURG_CITY')!;
      expect(new Set(south.map((s) => s.map))).toEqual(new Set(['MAP_PETALBURG_CITY']));
    });


    it('keeps the north half, the woods and Rustboro apart from the beach and Petalburg', () => {
      const north = hoenn.reachOnMap(r104(10, 29));
      expect(north.cell(12, 2)).toBe(true);
      expect(north.cell(15, 41)).toBe(false);
      const south = hoenn.reachOnMap(r104(15, 41));
      expect(south.cell(15, 41)).toBe(true);
      expect(south.cell(12, 2)).toBe(false);
      for (const to of hoenn.entryCells('MAP_ROUTE104', 'MAP_PETALBURG_CITY')) {
        expect(north.across(to)).toBe(false);
      }
      expect(hoenn.entryCells('MAP_ROUTE104', 'MAP_PETALBURG_CITY').some((to) => south.across(to))).toBe(true);
      expect(hoenn.entryCells('MAP_ROUTE104', 'MAP_RUSTBORO_CITY').some((to) => north.across(to))).toBe(true);
    });

    it('says what a search that may not leave the map finds, from the drop cells of the split maps', () => {
      for (const map of ['MAP_ROUTE103', 'MAP_ROUTE104', 'MAP_ROUTE114']) {
        const cells = LANDING.filter((c) => c.map === map);
        for (const from of [cells[0], cells[cells.length - 1]]) {
          for (const kit of [[false, false], [false, true], [true, true]] as const) {
            const reach = hoenn.reachOnMap(from, ...kit);
            for (const to of cells) {
              if (to === from) continue;
              const walked = findPathToAny(hoenn, from, [to], 20_000, ...kit).found;
              expect(reach.cell(to.x, to.y), `${map} ${from.x},${from.y} -> ${to.x},${to.y} ${kit}`).toBe(walked);
            }
          }
        }
      }
    });

    it('floods a region once, whichever of its cells asks', () => {
      expect(hoenn.reachOnMap(r104(10, 29))).toBe(hoenn.reachOnMap(r104(12, 2)));
      expect(hoenn.reachOnMap(r104(10, 29))).not.toBe(hoenn.reachOnMap(r104(15, 41)));
      expect(hoenn.reachOnMap(r104(10, 29))).not.toBe(hoenn.reachOnMap(r104(10, 29), true));
    });
  });
});
