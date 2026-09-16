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
