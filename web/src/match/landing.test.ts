import { describe, expect, it, vi } from 'vitest';
import { decodeGrid, type WorldMap } from '../bots/world';
import worldData from '../data/world.json';
import { HAND } from './landing';

// A hand-painted cell is exempt from the reachability flood by definition, so this is
// the only thing standing between a painted cell and a wall: every one is a real,
// standable, outdoor cell in the world.json the drop is dealt from. A re-export that
// moves a map fails here rather than dropping somebody into a fence (POK-314).
const maps = new Map((worldData as { maps: WorldMap[] }).maps.map((m) => [m.id, m]));
const WALL = 1;
const WATER = 2;
const CUT = 9;

describe('the hand-painted drop cells', () => {
  it('are each a standable outdoor cell in the current world', () => {
    for (const cell of HAND) {
      const m = maps.get(cell.map);
      expect(m, cell.map).toBeDefined();
      expect(m!.outdoor, `${cell.map} is indoors`).toBe(true);
      expect(cell.x >= 0 && cell.x < m!.w && cell.y >= 0 && cell.y < m!.h, `${cell.map} ${cell.x},${cell.y} is off the map`).toBe(true);
      const cls = decodeGrid(m!.grid, m!.w * m!.h)[cell.y * m!.w + cell.x];
      expect([WALL, WATER, CUT].includes(cls), `${cell.map} ${cell.x},${cell.y} is class ${cls}`).toBe(false);
    }
  });

  it('are written once each', () => {
    const keys = HAND.map((c) => `${c.map}:${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// world.json and landing.json are a chunk of their own, fetched as the page starts (the
// audit's leftover e): a module fresh off the import has neither, says so when read,
// and has both once worldReady() is done.
describe('the world data', () => {
  it('is fetched on demand: read before worldReady() it throws, after it answers', async () => {
    vi.resetModules();
    const hoenn = await import('../bots/hoenn');
    const landing = await import('./landing');
    expect(() => hoenn.HOENN.maps).toThrow('HOENN was read before worldReady()');
    expect(() => landing.LANDING.length).toThrow('LANDING was read before worldReady()');
    expect(() => [...landing.DOORSTEPS]).toThrow('DOORSTEPS was read before worldReady()');
    expect(() => landing.LANDING_ALL.filter(Boolean)).toThrow('LANDING_ALL was read before worldReady()');

    const once = landing.worldReady();
    expect(landing.worldReady()).toBe(once);
    await once;
    expect(hoenn.HOENN.maps).toHaveLength(maps.size);
    expect(landing.LANDING_ALL.length).toBe(landing.LANDING.length + landing.DOORSTEPS.length + landing.LANDING_ALL.filter((c) => c.off && c.door === undefined).length);
    expect(landing.LANDING.every((c) => !c.off && c.door === undefined)).toBe(true);
    expect(landing.DOORSTEPS.length).toBeGreaterThan(0);
  });
});
