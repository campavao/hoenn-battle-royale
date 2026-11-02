// Who draws over the map's cover. Meteor Falls' bridge is Cam's 2026-11-01 play-test (10:03):
// "I should walk over the bridge, not underneath it".
import { describe, expect, it } from 'vitest';
import { World, type WorldMap } from '../src/bots/world';
import worldJson from './data/world.json';
import { Heights } from './heights';

const world = new World((worldJson as { maps: WorldMap[] }).maps);
const map = 'MAP_METEOR_FALLS_1F_1R';
const at = (x: number, y: number) => ({ map, x, y });

describe('Heights', () => {
  it('a trainer who walks onto a bridge from its bank stays on top of it', () => {
    const h = new Heights((m, x, y) => world.height(m, x, y));
    expect(h.over(1, at(18, 18))).toBe(true);
    expect(h.over(1, at(19, 18))).toBe(true);
    expect(h.over(1, at(20, 18))).toBe(true);
    expect(h.over(1, at(21, 18))).toBe(true);
  });

  it('a trainer who surfs under it stays under it, on the same cells', () => {
    const h = new Heights((m, x, y) => world.height(m, x, y));
    expect(h.over(2, at(10, 18))).toBe(false);
    expect(h.over(2, at(20, 18))).toBe(false);
  });

  it('a spot on the bridge says which level it is on, for somebody first seen there', () => {
    const h = new Heights((m, x, y) => world.height(m, x, y));
    expect(h.over(3, { ...at(20, 18), z: 4 })).toBe(true);
    expect(h.over(4, { ...at(20, 18), z: 1 })).toBe(false);
  });

  it('the ground under the cover is still under it', () => {
    const h = new Heights((m, x, y) => world.height(m, x, y));
    expect(h.over(5, at(2, 18))).toBe(false);
  });
});
