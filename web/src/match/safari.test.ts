import { describe, expect, it } from 'vitest';
import { SAFARI_CELLS, SAFARI_MAP_ID } from './safari';
import { World, type WorldMap } from '../bots/world';
import worldData from '../data/world.json';

describe('the Safari opening cells', () => {
  const world = new World((worldData as { maps: WorldMap[] }).maps);

  it('are all on the opening map', () => {
    expect(world.map(SAFARI_MAP_ID)).toBeDefined();
    expect(SAFARI_CELLS.length).toBe(16);
  });

  it('are standable, with standable ground on all four sides', () => {
    for (const cell of SAFARI_CELLS) {
      expect(world.standable(SAFARI_MAP_ID, cell.x, cell.y), `${cell.x},${cell.y}`).toBe(true);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        expect(
          world.standable(SAFARI_MAP_ID, cell.x + dx, cell.y + dy),
          `${cell.x + dx},${cell.y + dy} beside ${cell.x},${cell.y}`,
        ).toBe(true);
      }
    }
  });

  it('are all distinct, and none of them are neighbours', () => {
    for (const a of SAFARI_CELLS) {
      for (const b of SAFARI_CELLS) {
        if (a === b) continue;
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(1);
      }
    }
  });
});
