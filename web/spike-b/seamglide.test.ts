import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../src/bots/world';
import worldJson from './data/world.json';
import { GLIDE_FRAMES, SeamGlide, seamOff } from './seamglide';
import { layout } from './shared/room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;

describe('the seams that do not meet', () => {
  it('are three, two tiles out, and each gives the same answer both ways', () => {
    const placed = layout(MAPS);
    const off: string[] = [];
    for (const p of placed.values()) {
      for (const s of p.m.seams) {
        const q = placed.get(s.to);
        const e = q && seamOff(p, q);
        if (e) {
          off.push(`${p.m.id}>${s.to} ${e.x},${e.y}`);
          const back = seamOff(q!, p)!;
          expect([back.x, back.y]).toEqual([-e.x || 0, -e.y || 0]);
        }
      }
    }
    expect(off.sort()).toEqual([
      'MAP_DEWFORD_TOWN>MAP_ROUTE107 0,-2',
      'MAP_FALLARBOR_TOWN>MAP_ROUTE114 0,2',
      'MAP_ROUTE107>MAP_DEWFORD_TOWN 0,2',
      'MAP_ROUTE114>MAP_FALLARBOR_TOWN 0,-2',
      'MAP_ROUTE116>MAP_VERDANTURF_TOWN 0,-2',
      'MAP_VERDANTURF_TOWN>MAP_ROUTE116 0,2',
    ]);
  });

  it('glide: the jump undone at once, and none left after a step', () => {
    const g = new SeamGlide();
    const off = (a: string, b: string) => (a === 'A' && b === 'B' ? { x: 0, y: 2 } : null);
    g.look(1, 'A', 100, off);
    expect(g.offset(1, 100)).toEqual({ x: 0, y: 0 });
    g.look(1, 'B', 110, off);
    expect(g.offset(1, 110).y).toBe(-2);
    expect(g.offset(1, 110 + GLIDE_FRAMES / 2).y).toBe(-1);
    expect(g.offset(1, 110 + GLIDE_FRAMES)).toEqual({ x: 0, y: 0 });
    // A map that meets, or a warp: nothing.
    g.look(1, 'C', 200, off);
    expect(g.offset(1, 200)).toEqual({ x: 0, y: 0 });
  });
});
