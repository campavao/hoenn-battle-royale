import { describe, expect, it } from 'vitest';
import { SAFARI_CELLS, SAFARI_MAPS, SAFARI_MAP_ID } from './safari';
import { World, type WorldMap } from '../bots/world';
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

  it('is a Zone a trainer can walk across: every area is joined to another', () => {
    for (const id of SAFARI_MAPS) {
      const m = byId.get(id)!;
      expect(m.seams.some((s) => SAFARI_MAPS.includes(s.to as (typeof SAFARI_MAPS)[number])), id).toBe(true);
    }
  });
});
