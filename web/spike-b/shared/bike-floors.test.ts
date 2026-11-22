// Cam, play-test 2026-11-22 (iPhone): "In the sand tower these spots are supposed to fall through
// if I'm on them for too long (without Mach bike normally)" and "Mach bike wall passage stuff in
// general is just allowing folks to walk up and down without bike". Emerald's two MACH BIKE floors:
// a cracked floor (field_tasks.c CrackedFloorPerStepCallback, data/scripts/cave_hole.inc) and a
// muddy slope (field_player_avatar.c ForcedMovement_MuddySlope), on the real cells
// (tools/br/export-bike-floors.py) with the room's own walking.
import { describe, expect, it } from 'vitest';
import { World, decodeGrid, DIRS, type WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import patchJson from '../../src/data/patches.json';
import worldJson from '../data/world.json';
import { newMover, tick, DIR_NORTH, type StepFn } from '../sim';
import { KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_SELECT, KEY_UP, makeRoom, type Room } from './room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const byId = new Map(MAPS.map((m) => [m.id, m]));
const NORTH = 2, SOUTH = 1, WEST = 3;
const T2F = 'MAP_MIRAGE_TOWER_2F', T1F = 'MAP_MIRAGE_TOWER_1F';
const R111 = 'MAP_ROUTE111';

const at = (map: string, x: number, y: number, facing: number, bike = false, bot = false): Room => {
  const room = makeRoom(MAPS, patchJson as unknown as PatchTable, 1);
  room.opening = 0;
  room.apply({ c: 'join', id: 1, bot, name: 'A', skin: 0, spot: { map, x, y }, facing });
  const a = room.actor(1)!;
  a.calm = 1e9;
  if (bike) {
    room.apply({ c: 'ride', id: 1, acro: false });
    hold(room, KEY_SELECT, 1);
    hold(room, 0, 1);
    expect(a.m.bike && !a.m.acro, 'on the MACH BIKE').toBe(true);
  }
  return room;
};
const hold = (room: Room, bits: number, frames: number) => { for (let i = 0; i < frames; i++) room.step(new Map([[1, [bits]]])); };
const where = (room: Room) => { const s = room.actor(1)!.m.spot; return [s.map, s.x, s.y]; };
/** Hold `bits` until the trainer stands still at (x, y) on `map`, or fail after `frames`. */
const until = (room: Room, bits: number, map: string, x: number, y: number, frames = 400) => {
  for (let i = 0; i < frames; i++) {
    hold(room, bits, 1);
    const m = room.actor(1)!.m;
    if (m.spot.map === map && m.spot.x === x && m.spot.y === y && !m.action) return;
  }
  throw new Error(`never stood on ${map} ${x},${y}: at ${where(room)}`);
};

describe('the floors in world.json', () => {
  it('has the cracked floors, the map each drops to, and the bike where they are', () => {
    const cracks = MAPS.filter((m) => m.cracks).map((m) => [m.id, m.cracks!.length, m.hole]);
    expect(cracks).toEqual([
      ['MAP_GRANITE_CAVE_B1F', 62, 'MAP_GRANITE_CAVE_B2F'],
      ['MAP_SKY_PILLAR_4F', 5, 'MAP_SKY_PILLAR_3F'],
      ['MAP_MIRAGE_TOWER_2F', 11, T1F],
      ['MAP_MIRAGE_TOWER_3F', 3, T2F],
    ]);
    expect(MAPS.filter((m) => m.bike).map((m) => m.id).sort()).toEqual(['MAP_GRANITE_CAVE_B1F', 'MAP_MIRAGE_TOWER_2F', 'MAP_MIRAGE_TOWER_3F', 'MAP_SKY_PILLAR_4F']);
  });

  it('lands every fall on floor of the map below', () => {
    const w = new World(MAPS);
    for (const m of MAPS) for (const c of m.cracks ?? []) {
      const x = c % m.w, y = Math.floor(c / m.w);
      expect(w.crackAt(m.id, x, y), `${m.id} ${x},${y}`).toEqual({ map: m.hole, x, y });
      expect(w.standable(m.hole!, x, y), `${m.hole} ${x},${y}`).toBe(true);
    }
  });

  it('has the muddy slopes, none in the Safari Zone (its bike is the ACRO BIKE alone)', () => {
    expect(MAPS.filter((m) => m.slopes).map((m) => [m.id, m.slopes!.map((c) => [c % m.w, Math.floor(c / m.w)])])).toEqual([
      [R111, [[29, 6], [29, 7], [17, 36], [17, 37]]],
      ['MAP_ROUTE115', [[28, 8], [28, 9]]],
      ['MAP_ROUTE119', [[6, 54], [6, 55]]],
      ['MAP_GRANITE_CAVE_B1F', [[9, 9], [9, 10]]],
    ]);
  });
});

describe('a cracked floor (Mirage Tower 2F)', () => {
  it('drops a trainer who walks onto it to the same cell of 1F', () => {
    const room = at(T2F, 4, 4, WEST);
    until(room, KEY_LEFT, T1F, 3, 4, 200);
    expect(room.actor(1)!.m.bike).toBe(false);
  });

  it('is crossed on the MACH BIKE at top speed, breaking behind it', () => {
    // A run-up west along row 4 (16, 8, then 4 frames a step), the cracks at (3,4) and down
    // the column to (3,7), and off them onto (3,8) by a turn at speed.
    const room = at(T2F, 6, 4, WEST, true);
    for (let i = 0; i < 60 && where(room)[1] !== 3; i++) hold(room, KEY_LEFT, 1);
    expect(where(room)).toEqual([T2F, 3, 4]);
    until(room, KEY_DOWN, T2F, 3, 8, 120);
    const m = room.actor(1)!.m;
    expect(m.holes?.cells.map((c) => [c % 4096, Math.floor(c / 4096)])).toEqual([[3, 4], [3, 5], [3, 6], [3, 7]]);
    // Back onto one of them it is a hole, bike or no bike.
    until(room, KEY_UP, T1F, 3, 7, 200);
  });

  it('drops the MACH BIKE before its top speed, and one that stops on it', () => {
    // From (5,4): 16 frames onto (4,4), then 8 onto the crack, slower than its 4.
    const slow = at(T2F, 5, 4, WEST, true);
    until(slow, KEY_LEFT, T1F, 3, 4, 200);
    // At speed onto (3,4) and (2,4), then the wall at (1,4): stopped on the crack.
    const stop = at(T2F, 6, 4, WEST, true);
    until(stop, KEY_LEFT, T1F, 2, 4, 200);
  });

  it('keeps one room on every machine: the broken floor is in the hash and the state', () => {
    const room = at(T2F, 6, 4, WEST, true);
    for (let i = 0; i < 60 && where(room)[1] !== 3; i++) hold(room, KEY_LEFT, 1);
    const mirror = makeRoom(MAPS, patchJson as unknown as PatchTable, 1);
    mirror.load(structuredClone(room.state()));
    expect(mirror.hash()).toBe(room.hash());
    const holes = room.actor(1)!.m.holes!;
    room.actor(1)!.m.holes = undefined;
    expect(room.hash()).not.toBe(mirror.hash());
    room.actor(1)!.m.holes = holes;
    for (let i = 0; i < 120; i++) { hold(room, KEY_DOWN, 1); mirror.step(new Map([[1, [KEY_DOWN]]])); }
    expect(mirror.hash()).toBe(room.hash());
  });

  it('a bot, who never rides, walks over it as before (its world has no hole there)', () => {
    const room = at(T2F, 4, 4, WEST, false, true);
    const a = room.actor(1)!;
    a.keys = KEY_LEFT;
    room.step();
    for (let i = 0; i < 40; i++) { a.keys = 0; room.step(); }
    expect(where(room)).toEqual([T2F, 3, 4]);
  });
});

describe('SKY PILLAR 4F, whose holes are the bots\' way down', () => {
  it('drops a trainer on foot, and lets the MACH BIKE at speed over', () => {
    const m = byId.get('MAP_SKY_PILLAR_4F')!;
    const w = new World(MAPS);
    // A crack with three cells of floor in a row beside it, to walk on from or run up along.
    for (const c of m.cracks!) {
      const x = c % m.w, y = Math.floor(c / m.w);
      for (const [dx, dy, dir, key] of [[1, 0, WEST, KEY_LEFT], [-1, 0, 4, KEY_RIGHT], [0, 1, NORTH, KEY_UP], [0, -1, SOUTH, KEY_DOWN]] as const) {
        const run = [1, 2, 3].map((k) => ({ x: x + dx * k, y: y + dy * k }));
        if (!run.every((s) => w.cell(m.id, s.x, s.y) === 0 && !w.crackAt(m.id, s.x, s.y))) continue;
        const foot = at(m.id, run[0].x, run[0].y, dir);
        until(foot, key, 'MAP_SKY_PILLAR_3F', x, y, 200);
        const bike = at(m.id, run[2].x, run[2].y, dir, true);
        for (let i = 0; i < 60 && !(where(bike)[1] === x && where(bike)[2] === y); i++) hold(bike, key, 1);
        expect(where(bike)).toEqual([m.id, x, y]);
        return;
      }
    }
    throw new Error('no crack with a run-up');
  });
});

describe('a muddy slope (Route 111, (29,6) and (29,7))', () => {
  it('slides a trainer on foot back down, facing up it', () => {
    const room = at(R111, 29, 8, NORTH);
    let top = 8;
    for (let i = 0; i < 300; i++) { hold(room, KEY_UP, 1); top = Math.min(top, room.actor(1)!.m.spot.y); }
    expect(top, 'onto the slope').toBe(7);
    hold(room, 0, 40);
    expect(where(room)).toEqual([R111, 29, 8]);
    expect(room.actor(1)!.m.facing).toBe(NORTH);
  });

  it('is climbed on the MACH BIKE at top speed, and not from a standing start', () => {
    const run = at(R111, 29, 11, NORTH, true);
    until(run, KEY_UP, R111, 29, 3, 200);
    const short = at(R111, 29, 8, NORTH, true);
    for (let i = 0; i < 300; i++) hold(short, KEY_UP, 1);
    hold(short, 0, 40);
    expect(where(short)[2]).toBeGreaterThanOrEqual(8);
  });

  it('is walked down from the top', () => {
    const room = at(R111, 29, 5, SOUTH);
    until(room, KEY_DOWN, R111, 29, 9, 200);
  });

  it('strands nobody who walks: above and below every slope there is a way to Littleroot, and up it only Route 119\'s has another', () => {
    const w = new World(MAPS);
    const key = (s: { map: string; x: number; y: number }) => `${s.map}:${s.x},${s.y}`;
    const reaches = (from: { map: string; x: number; y: number }, goal: string) => {
      const seen = new Set([key(from)]), q = [from];
      while (q.length && !seen.has(goal)) for (const n of w.neighbours(q.pop()!, true, 3)) if (!seen.has(key(n.to))) { seen.add(key(n.to)); q.push(n.to); }
      return seen.has(goal);
    };
    const home = key({ map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 });
    const around: string[] = [];
    for (const m of MAPS.filter((q) => q.slopes)) {
      for (const x of new Set(m.slopes!.map((c) => c % m.w))) {
        const ys = m.slopes!.filter((c) => c % m.w === x).map((c) => Math.floor(c / m.w));
        const above = { map: m.id, x, y: Math.min(...ys) - 1 }, below = { map: m.id, x, y: Math.max(...ys) + 1 };
        expect(reaches(above, home), `${m.id} above ${x}`).toBe(true);
        expect(reaches(below, home), `${m.id} below ${x}`).toBe(true);
        if (reaches(below, key(above))) around.push(`${m.id} ${x}`);
      }
    }
    // The rest are the MACH BIKE's to go up: Route 111's and 115's ledges, Granite Cave B1F's top.
    expect(around).toEqual(['MAP_ROUTE119 6']);
  }, 60_000);

  it('is one-way, downhill, to the bots\' world, and stepKey agrees with step on it', () => {
    const w = new World(MAPS);
    expect(w.step({ map: R111, x: 29, y: 8 }, 'north')).toBe(null);
    expect(w.step({ map: R111, x: 29, y: 7 }, 'north')).toBe(null);
    expect(w.step({ map: R111, x: 29, y: 8 }, 'north', false, false, true)).toEqual({ map: R111, x: 29, y: 7 });
    expect(w.step({ map: R111, x: 29, y: 5 }, 'south')).toEqual({ map: R111, x: 29, y: 6 });
    expect(w.step({ map: R111, x: 29, y: 6 }, 'south')).toEqual({ map: R111, x: 29, y: 7 });
    for (const m of MAPS.filter((q) => q.slopes)) {
      const grid = decodeGrid(m.grid, m.w * m.h);
      for (const c of m.slopes!) for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const x = (c % m.w) + dx, y = Math.floor(c / m.w) + dy;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h || grid[y * m.w + x] === 1) continue;
        DIRS.forEach((dir, d) => {
          const s = w.step({ map: m.id, x, y }, dir);
          const k = w.stepKey(w.key({ map: m.id, x, y }), d, false, false);
          expect(k < 0 ? null : w.spotAt(k), `${m.id} ${x},${y} ${dir}`).toEqual(s);
        });
      }
    }
  });
});

describe('the sim\'s rules, off any map', () => {
  /** One column, y = 0 at the top, 12 cells; a slope at y = 3 and 4, or a crack at y = 4. */
  const col = (crack: boolean): StepFn => {
    const fn: StepFn = (from, dir) => {
      const y = from.y + (dir === 1 ? 1 : dir === 2 ? -1 : 0);
      if (from.map !== 'M' || dir > 2 || y < 0 || y > 12) return null;
      return { to: { map: 'M', x: 0, y }, hop: false, ...(crack && y === 4 ? { crack: { map: 'B', x: 0, y } } : {}) };
    };
    fn.cycling = () => true;
    fn.slopeAt = (s) => !crack && s.map === 'M' && (s.y === 3 || s.y === 4);
    return fn;
  };
  const rider = (acro: boolean, step: StepFn) => {
    const m = newMover({ map: 'M', x: 0, y: 12 }, DIR_NORTH);
    tick(m, { select: true }, step);
    tick(m, {}, step);
    m.acro = acro;
    let top = 12;
    for (let i = 0; i < 300; i++) { tick(m, { up: true }, step); if (m.spot.map === 'M') top = Math.min(top, m.spot.y); }
    return { m, top };
  };

  it('the MACH BIKE climbs and crosses; the ACRO BIKE, at its own pace, does neither', () => {
    expect(rider(false, col(false)).top).toBe(0);
    expect(rider(true, col(false)).top).toBe(4);
    const mach = rider(false, col(true));
    expect([mach.m.spot.map, mach.top]).toEqual(['M', 0]);
    expect(rider(true, col(true)).m.spot).toEqual({ map: 'B', x: 0, y: 4 });
  });
});
