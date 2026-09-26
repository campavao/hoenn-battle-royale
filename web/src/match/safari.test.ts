import { describe, expect, it } from 'vitest';
import { SAFARI_CELLS, SAFARI_MAPS, SAFARI_MAP_ID } from './safari';
import { World, spotKey, type Spot, type WorldMap } from '../bots/world';
import worldData from '../data/world.json';

describe('the Safari opening cells', () => {
  const maps = (worldData as { maps: WorldMap[] }).maps;
  const world = new World(maps);
  const byId = new Map(maps.map((m) => [m.id, m]));

  it('cover all six areas of the Zone, four each', () => {
    expect(world.map(SAFARI_MAP_ID)).toBeDefined();
    expect(SAFARI_CELLS.length).toBe(24);
    for (const id of SAFARI_MAPS) {
      expect(SAFARI_CELLS.filter((c) => c.map === id)).toHaveLength(4);
    }
  });

  it('are standable, with standable ground all around them', () => {
    for (const cell of SAFARI_CELLS) {
      expect(world.standable(cell.map, cell.x, cell.y), `${cell.map} ${cell.x},${cell.y}`).toBe(true);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        expect(
          world.standable(cell.map, cell.x + dx, cell.y + dy),
          `${cell.x + dx},${cell.y + dy} beside ${cell.map} ${cell.x},${cell.y}`,
        ).toBe(true);
      }
    }
  });

  it('keep clear of the edges, so nobody spawns into a seam', () => {
    for (const cell of SAFARI_CELLS) {
      const m = byId.get(cell.map)!;
      expect(cell.x).toBeGreaterThanOrEqual(3);
      expect(cell.y).toBeGreaterThanOrEqual(3);
      expect(cell.x).toBeLessThan(m.w - 3);
      expect(cell.y).toBeLessThan(m.h - 3);
    }
  });

  it('are all distinct, and no two on a map are neighbours', () => {
    for (const a of SAFARI_CELLS) {
      for (const b of SAFARI_CELLS) {
        if (a === b || a.map !== b.map) continue;
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(1);
      }
    }
  });

  // POK-331: joined areas are not joined cells. NORTHEAST (3,3) was a 34-cell pocket
  // walled in by collision -- every other cell reached 4,146 -- and the test below it
  // passed, because its area has a seam. So each cell floods the Zone on foot, heights
  // and all (world.json's elevation, POK-331 #2), and has to reach every other one.
  it('are each a walk from every other one, on foot', () => {
    const zone = new Set<string>(SAFARI_MAPS);
    for (const from of SAFARI_CELLS) {
      const start: Spot = { map: from.map, x: from.x, y: from.y };
      const seen = new Set([spotKey(start)]);
      const queue = [start];
      while (queue.length) {
        for (const { to } of world.neighbours(queue.pop()!)) {
          if (!zone.has(to.map) || seen.has(spotKey(to))) continue;
          seen.add(spotKey(to));
          queue.push(to);
        }
      }
      const missed = SAFARI_CELLS.filter((c) => !seen.has(spotKey({ map: c.map, x: c.x, y: c.y })));
      expect(missed.map((c) => `${c.map} ${c.x},${c.y}`), `from ${from.map} ${from.x},${from.y} (${seen.size} cells)`).toEqual([]);
    }
  });

  it('is a Zone a trainer can walk across: every area is joined to another', () => {
    for (const id of SAFARI_MAPS) {
      const m = byId.get(id)!;
      expect(m.seams.some((s) => SAFARI_MAPS.includes(s.to as (typeof SAFARI_MAPS)[number])), id).toBe(true);
    }
  });
});
