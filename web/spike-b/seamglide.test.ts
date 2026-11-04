import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../src/bots/world';
import worldJson from './data/world.json';
import { GLIDE_FRAMES, SeamGlide, seamOff } from './seamglide';
import { layout } from './shared/room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;

describe('the seams that do not meet', () => {
  it('are the one left open, two tiles out, and it gives the same answer both ways', () => {
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
      'MAP_PETALBURG_CITY>MAP_ROUTE102 0,2',
      'MAP_ROUTE102>MAP_PETALBURG_CITY 0,-2',
    ]);
  });

  // Cam, 11-04: "the cave entrance it looks completely blocked but I can still walk up that way".
  // ROUTE 116's foot lay over VERDANTURF's top rows, the Rusturf mouth and the MART's roof with them.
  it('no two maps of the plane share a cell, so what is drawn at a cell is what stands there', () => {
    const owner = new Map<string, string>();
    const shared: string[] = [];
    for (const p of layout(MAPS).values()) {
      for (let y = 0; y < p.m.h; y++) {
        for (let x = 0; x < p.m.w; x++) {
          const k = `${p.gx + x},${p.gy + y}`, was = owner.get(k);
          if (was) shared.push(`${was} ${p.m.id} ${k}`);
          owner.set(k, p.m.id);
        }
      }
    }
    expect(owner.size).toBeGreaterThan(40_000);
    expect(shared).toEqual([]);
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
