import { describe, expect, it } from 'vitest';
import { DIR_EAST, newMover, tick, type Keys, type Mover, type StepFn } from './sim';
import type { WorldMap } from '../src/bots/world';
import type { PatchTable } from '../src/bots/patches';
import patchJson from '../src/data/patches.json';
import { makeRoom } from './shared/room';
import worldJson from './data/world.json';

/** An open field 0..wall-1 wide; x = wall is a wall, x = door goes indoors. */
function field(wall = 99, door = -1): StepFn {
  const fn: StepFn = (from, dir) => {
    const x = from.x + (dir === DIR_EAST ? 1 : dir === 3 ? -1 : 0);
    if (x === wall) return null;
    if (x === door) return { to: { map: 'IN', x: 0, y: 0 }, hop: false, warp: true };
    return { to: { map: from.map, x, y: from.y }, hop: false };
  };
  fn.cycling = (s) => s.map === 'OUT';
  return fn;
}

/** Frames each step took while `keys` was held for `frames` frames. */
function steps(m: Mover, keys: Keys, frames: number, step: StepFn): number[] {
  const lens: number[] = [];
  for (let f = 0; f < frames; f++) {
    const was = m.action;
    tick(m, keys, step);
    if (m.action && m.action !== was && m.action.kind === 'step') lens.push(m.action.len);
  }
  return lens;
}

const getOn = (m: Mover, step: StepFn) => { tick(m, { select: true }, step); tick(m, {}, step); };

describe('the MACH BIKE', () => {
  it('speeds up 16, 8, then 4 frames a step while held, and coasts down to a stop', () => {
    const m = newMover({ map: 'OUT', x: 0, y: 0 }, DIR_EAST);
    const f = field();
    getOn(m, f);
    expect(m.bike).toBe(true);
    expect(steps(m, { right: true }, 16 + 8 + 4 * 4, f)).toEqual([16, 8, 4, 4, 4, 4]);
    expect(steps(m, {}, 80, f)).toEqual([4, 8, 16]);
    expect(m.action).toBe(null);
    expect(m.spot.x).toBe(9);
  });

  it('stops dead at a wall', () => {
    const m = newMover({ map: 'OUT', x: 0, y: 0 }, DIR_EAST);
    const f = field(4);
    getOn(m, f);
    steps(m, { right: true }, 16 + 8 + 4 + 2, f);
    expect(m.spot.x).toBe(3);
    tick(m, { right: true }, f);
    expect(m.action?.kind).toBe('bump');
    expect(m.bikeSpeed).toBe(0);
  });

  it('is not got on indoors, and is put away through a door', () => {
    const inside = newMover({ map: 'IN', x: 0, y: 0 }, DIR_EAST);
    getOn(inside, field());
    expect(inside.bike).toBe(false);
    const m = newMover({ map: 'OUT', x: 0, y: 0 }, DIR_EAST);
    const f = field(99, 2);
    getOn(m, f);
    steps(m, { right: true }, 40, f);
    expect(m.spot.map).toBe('IN');
    expect(m.bike).toBe(false);
  });

  it('gets off with SELECT again, and a held SELECT is one press', () => {
    const m = newMover({ map: 'OUT', x: 0, y: 0 }, DIR_EAST);
    const f = field();
    for (let i = 0; i < 5; i++) tick(m, { select: true }, f);
    expect(m.bike).toBe(true);
    tick(m, {}, f);
    tick(m, { select: true }, f);
    expect(m.bike).toBe(false);
  });
});

describe('the ACRO BIKE ground', () => {
  // Cam's 10-31 play: "I can walk on bike-only pathing". Route 119's white bars and Jagged
  // Pass's bumpy slopes are a collision on foot (CheckAcroBikeCollision), and this world
  // has no ACRO BIKE: export-world.py's ACRO_BEHAVIORS makes them walls.
  it('is a wall to walk or ride the MACH BIKE on', () => {
    const w = makeRoom((worldJson as { maps: WorldMap[] }).maps, patchJson as unknown as PatchTable, 1).world;
    for (const [map, x, y] of [['MAP_ROUTE119', 8, 5], ['MAP_ROUTE119', 10, 7], ['MAP_JAGGED_PASS', 18, 8], ['MAP_JAGGED_PASS', 22, 16]] as const) {
      expect(w.cell(map, x, y), `${map}:${x}:${y}`).toBe(1);
    }
  });
});
