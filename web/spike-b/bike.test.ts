import { describe, expect, it } from 'vitest';
import { ACRO_HOPPING, ACRO_NORMAL, ACRO_WHEELIE, acroFrame, acroNear, DIR_EAST, newMover, tick, type Keys, type Mover, type StepFn } from './sim';
import type { WorldMap } from '../src/bots/world';
import type { PatchTable } from '../src/bots/patches';
import patchJson from '../src/data/patches.json';
import { KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_SELECT, KEY_UP, SAFARI, makeRoom, type Room } from './shared/room';
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
  // Pass's bumpy slopes are a collision on foot (CheckAcroBikeCollision): walls in the grid
  // (export-world.py's ACRO_BEHAVIORS), and the ACRO BIKE's own in `acro` (below).
  it('is a wall to walk or ride the MACH BIKE on', () => {
    const w = makeRoom((worldJson as { maps: WorldMap[] }).maps, patchJson as unknown as PatchTable, 1).world;
    for (const [map, x, y] of [['MAP_ROUTE119', 8, 5], ['MAP_ROUTE119', 10, 7], ['MAP_JAGGED_PASS', 18, 8], ['MAP_JAGGED_PASS', 22, 16]] as const) {
      expect(w.cell(map, x, y), `${map}:${x}:${y}`).toBe(1);
    }
  });
});


// Cam, 11-03: "Yes, make them work." bike.c and field_player_avatar.c are the rules; the cells
// are the real ones in world.json (tools/br/export-acro.py), with the room's own walking.
describe('the ACRO BIKE on its own ground', () => {
  const MAPS = (worldJson as { maps: WorldMap[] }).maps;
  const NORTH = 2, SOUTH = 1, WEST = 3, EAST = 4;
  const at = (map: string, x: number, y: number, facing: number, acro = true, opening = 0): Room => {
    const room = makeRoom(MAPS, patchJson as unknown as PatchTable, 1);
    room.opening = opening;
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map, x, y }, facing });
    room.actor(1)!.calm = 1e9;
    room.apply({ c: 'ride', id: 1, acro });
    return room;
  };
  const hold = (room: Room, bits: number, frames: number) => { for (let i = 0; i < frames; i++) room.step(new Map([[1, [bits]]])); };
  const mount = (room: Room) => { hold(room, KEY_SELECT, 1); hold(room, 0, 1); expect(room.actor(1)!.m.bike).toBe(true); };
  const spot = (room: Room) => { const s = room.actor(1)!.m.spot; return [s.x, s.y]; };
  /** Hold until the trainer stands on (x, y), or fail: no more than `frames` frames. */
  const until = (room: Room, bits: number, x: number, y: number, frames = 400) => {
    for (let i = 0; i < frames; i++) {
      hold(room, bits, 1);
      const a = room.actor(1)!;
      if (a.m.spot.x === x && a.m.spot.y === y && !a.m.action) return;
    }
    throw new Error(`never reached ${x},${y}: at ${spot(room)}`);
  };

  it('world.json has the ground, by the map behaviours, and it is wall to every walker', () => {
    const count = (id: string, kind: number) => MAPS.find((m) => m.id === id)!.acro!.filter((c) => c[1] === kind).length;
    expect(count('MAP_JAGGED_PASS', 1)).toBe(14);
    expect(count('MAP_SAFARI_ZONE_NORTH', 1)).toBe(3);
    expect([2, 3, 4, 5].map((k) => count('MAP_SAFARI_ZONE_SOUTH', k))).toEqual([0, 2, 0, 11]);
    // Four of Route 119's sit under a collision bit (y = 11): those are walls to all.
    expect([2, 3, 4, 5].map((k) => count('MAP_ROUTE119', k))).toEqual([3, 4, 10, 34]);
    const w = makeRoom(MAPS, patchJson as unknown as PatchTable, 1).world;
    for (const m of MAPS) for (const [cell] of m.acro ?? []) expect(w.cell(m.id, cell % m.w, Math.floor(cell / m.w)), m.id).toBe(1);
  });

  describe('SELECT near its ground', () => {
    const fresh = (map: string, x: number, y: number) => {
      const room = at(map, x, y, NORTH);
      room.actor(1)!.likeAcro = undefined;
      return room;
    };

    it('gets on the ACRO BIKE beside a rock or a rail, and the MACH BIKE away from them', () => {
      for (const [map, x, y] of [['MAP_JAGGED_PASS', 22, 19], ['MAP_ROUTE119', 19, 7]] as const) {
        const room = fresh(map, x, y);
        mount(room);
        expect(room.actor(1)!.m.acro, map).toBe(true);
      }
      const far = fresh('MAP_ROUTE101', 8, 8);
      mount(far);
      expect(far.actor(1)!.m.acro).toBe(false);
    });

    it('reaches two tiles, not three', () => {
      const step: StepFn = () => null;
      step.acroAt = (s) => (s.x === 10 && s.y === 10 ? 1 : 0);
      expect(acroNear(step, { map: 'M', x: 12, y: 10 })).toBe(true);
      expect(acroNear(step, { map: 'M', x: 12, y: 12 })).toBe(true);
      expect(acroNear(step, { map: 'M', x: 13, y: 10 })).toBe(false);
    });

    it('the MACH BIKE USEd off the BAG is still the MACH BIKE there', () => {
      const room = at('MAP_JAGGED_PASS', 22, 19, NORTH, false);
      mount(room);
      expect(room.actor(1)!.m.acro).toBe(false);
    });
  });

  describe('Jagged Pass, (22,19) up the rocks to (22,15)', () => {
    const JAGGED = 'MAP_JAGGED_PASS';

    it('on foot, and on the MACH BIKE, the rock is a wall', () => {
      const foot = at(JAGGED, 22, 19, NORTH, false);
      hold(foot, KEY_UP, 60);
      expect(spot(foot)).toEqual([22, 19]);
      const mach = at(JAGGED, 22, 19, NORTH, false);
      mount(mach);
      hold(mach, KEY_UP, 60);
      expect(spot(mach)).toEqual([22, 19]);
      expect(mach.actor(1)!.m.acro).toBe(false);
      // B held makes no difference to the MACH BIKE
      hold(mach, KEY_B, 60);
      hold(mach, KEY_B | KEY_UP, 60);
      expect(spot(mach)).toEqual([22, 19]);
    });

    it('on the ACRO BIKE too until B has been held 40 frames, standing: then it hops up, a tile per 16 frames', () => {
      const room = at(JAGGED, 22, 19, NORTH);
      mount(room);
      expect(room.actor(1)!.m.acro).toBe(true);
      hold(room, KEY_UP, 30);
      expect(spot(room)).toEqual([22, 19]);
      hold(room, 0, 40);
      hold(room, KEY_B, 8 + 41);
      const a = room.actor(1)!;
      expect(a.m.acroState).toBe(ACRO_HOPPING);
      hold(room, 0 | KEY_B, 16 - (room.tick % 16));
      until(room, KEY_B, 22, 19, 32);
      // Up: a hop per tile, and the rider is off the ground for it.
      const lifts: number[] = [];
      const lens = new Set<number>();
      for (let i = 0; i < 200 && a.m.spot.y !== 15; i++) {
        hold(room, KEY_B | KEY_UP, 1);
        if (a.m.action) lens.add(a.m.action.len);
        lifts.push(a.m.lift);
      }
      expect(spot(room)).toEqual([22, 15]);
      expect(lens).toEqual(new Set([16]));
      expect(Math.min(...lifts)).toBe(-6); // sJumpY_Low's top
    });

    it('let go on a rock it stays up on its back wheel, and is off it by the flat ground below', () => {
      const room = at(JAGGED, 22, 19, NORTH);
      mount(room);
      hold(room, KEY_B, 8 + 41 + 16);
      until(room, KEY_B | KEY_UP, 22, 18);
      const a = room.actor(1)!;
      hold(room, 0, 20);
      expect(a.m.acroState).toBe(ACRO_WHEELIE);
      expect(spot(room)).toEqual([22, 18]);
      // Pushing at the next rock without B is nothing, a wheelie on the spot.
      hold(room, KEY_UP, 30);
      expect(spot(room)).toEqual([22, 18]);
      // Down it comes off, and on the flat let go of B it sits down again.
      hold(room, 0, 2);
      hold(room, KEY_DOWN, 2);
      until(room, KEY_DOWN, 22, 19);
      hold(room, 0, 12);
      expect(a.m.acroState).toBe(ACRO_NORMAL);
    });

    it('pushing at a rock with B held counts as well: you need not let the d-pad go', () => {
      const room = at(JAGGED, 22, 19, NORTH);
      mount(room);
      hold(room, KEY_B | KEY_UP, 8 + 41 + 16);
      until(room, KEY_B | KEY_UP, 22, 15, 200);
    });
  });

  describe('Route 119, the rails from (19,7) to (7,5)', () => {
    const R = 'MAP_ROUTE119';

    it('on foot and on the MACH BIKE a rail is a wall', () => {
      const foot = at(R, 19, 7, WEST, false);
      hold(foot, KEY_LEFT, 60);
      expect(spot(foot)).toEqual([19, 7]);
      const mach = at(R, 19, 7, WEST, false);
      mount(mach);
      hold(mach, KEY_LEFT, 60);
      expect(spot(mach)).toEqual([19, 7]);
    });

    it('an isolated piece is no road: only a jump from the side gets on', () => {
      // (20,7) north onto a horizontal piece: pushed at, a rail stops the bike turning at all.
      const room = at('MAP_SAFARI_ZONE_SOUTH', 20, 7, NORTH);
      mount(room);
      hold(room, KEY_UP, 30);
      expect(spot(room)).toEqual([20, 7]);
      // And ahead, along a vertical rail, onto what is under a collision bit (y = 11).
      const along = at('MAP_ROUTE119', 5, 10, SOUTH);
      mount(along);
      hold(along, KEY_DOWN, 30);
      expect(spot(along)).toEqual([5, 10]);
    });

    it('rides along one at 6 frames a tile, jumps the isolated pieces from the side, and cannot get off on one', () => {
      const room = at(R, 19, 7, WEST);
      mount(room);
      const a = room.actor(1)!;
      const lens = new Set<number>();
      for (let i = 0; i < 100 && a.m.spot.x !== 10; i++) { hold(room, KEY_LEFT, 1); if (a.m.action) lens.add(a.m.action.len); }
      expect(lens).toEqual(new Set([6]));
      hold(room, 0, 8);
      expect(spot(room)).toEqual([10, 7]);
      // No turning off it, no leaving it by pushing north, and no getting off.
      hold(room, KEY_UP, 30);
      expect(spot(room)).toEqual([10, 7]);
      expect(a.m.facing).toBe(WEST);
      hold(room, 0, 2);
      hold(room, KEY_SELECT, 1);
      hold(room, 0, 2);
      expect(a.m.bike).toBe(true);
      // B and north: over onto the isolated piece, sideways, still facing west. And again.
      hold(room, KEY_B | KEY_UP, 1);
      expect(a.m.action?.kind).toBe('hop');
      expect(a.m.action?.len).toBe(16);
      expect(a.m.facing).toBe(WEST);
      until(room, KEY_B | KEY_UP, 10, 6, 20);
      until(room, KEY_B | KEY_UP, 10, 5, 20);
      hold(room, 0, 12);
      expect(a.m.acroState).toBe(ACRO_NORMAL);
      until(room, KEY_LEFT, 7, 5);
      // Off the rail, on the ground, it gets off.
      hold(room, 0, 2);
      hold(room, KEY_SELECT, 1);
      hold(room, 0, 2);
      expect(a.m.bike).toBe(false);
    });

    it('sideways off a rail is nothing without B', () => {
      const room = at(R, 5, 10, SOUTH);
      room.actor(1)!.m.moveDir = EAST;
      room.actor(1)!.m.facing = EAST;
      mount(room);
      hold(room, KEY_RIGHT, 30);
      expect(spot(room)).toEqual([5, 10]);
    });

    it('a rail takes the ground it runs from at its height: not from below', () => {
      // Safari Zone South's rails are at height 5 and (21,3) beside them at 3.
      const room = at('MAP_SAFARI_ZONE_SOUTH', 21, 3, EAST);
      mount(room);
      hold(room, KEY_RIGHT, 30);
      expect(spot(room)).toEqual([21, 3]);
    });
  });

  describe('the Safari Zone', () => {
    const S = 'MAP_SAFARI_ZONE_SOUTH';

    it('on foot a rail is a wall, in the opening and out', () => {
      const room = at(S, 16, 7, EAST, false, 20 * 60);
      expect(room.ring().safari).toBe(true);
      hold(room, KEY_RIGHT, 60);
      expect(spot(room)).toEqual([16, 7]);
    });

    it('SELECT rides the ACRO BIKE there in the opening, whichever is chosen, across all its rails to the north', () => {
      const room = at(S, 16, 7, EAST, false, 20 * 60);
      expect(room.ring().safari).toBe(true);
      mount(room);
      const a = room.actor(1)!;
      expect(a.m.acro).toBe(true);
      until(room, KEY_RIGHT, 20, 7);
      hold(room, 0, 2);
      until(room, KEY_B | KEY_UP, 20, 6, 30);
      until(room, KEY_B | KEY_UP, 20, 5, 30);
      hold(room, 0, 12);
      until(room, KEY_RIGHT, 22, 5);
      hold(room, 0, 2);
      until(room, KEY_B | KEY_UP, 22, 4, 30);
      until(room, KEY_B | KEY_UP, 22, 3, 30);
      hold(room, 0, 12);
      until(room, KEY_RIGHT, 26, 3);
      expect(a.m.spot.map.startsWith(SAFARI)).toBe(true);
    });

    it('the MACH BIKE stays out of the Zone', () => {
      const room = at(S, 16, 7, EAST, false, 20 * 60);
      room.apply({ c: 'ride', id: 1, acro: false });
      hold(room, KEY_SELECT, 1);
      hold(room, 0, 1);
      expect(room.actor(1)!.m.acro).toBe(true);
    });

    it('a bot does not ride, nor hop: a rail and a rock are walls to it', () => {
      const room = makeRoom(MAPS, patchJson as unknown as PatchTable, 1);
      room.apply({ c: 'join', id: 2, bot: true, name: 'B', skin: 0, spot: { map: 'MAP_JAGGED_PASS', x: 22, y: 19 }, facing: NORTH });
      const a = room.actor(2)!;
      expect(room.stepFor(a).cycling).toBe(undefined);
      expect(room.stepFor(a).acroCycling).toBe(undefined);
      expect(room.stepFor(a)(a.m.spot, NORTH)).toBe(null);
    });
  });

  it('a mirror agrees frame by frame, and state() carries a ride under way', () => {
    const room = at('MAP_ROUTE119', 19, 7, WEST);
    const mirror = at('MAP_ROUTE119', 19, 7, WEST);
    const both = (bits: number, frames: number) => {
      for (let i = 0; i < frames; i++) {
        room.step(new Map([[1, [bits]]]));
        mirror.step(new Map([[1, [bits]]]));
        expect(mirror.hash()).toBe(room.hash());
      }
    };
    both(KEY_SELECT, 1);
    both(0, 1);
    both(KEY_LEFT, 56);
    expect(room.actor(1)!.m.spot.x).toBeLessThan(13);
    both(0, 12);
    both(KEY_B | KEY_UP, 9); // in the air
    expect(room.actor(1)!.m.action?.kind).toBe('hop');
    const copy = makeRoom(MAPS, patchJson as unknown as PatchTable, 1);
    copy.load(structuredClone(room.state()));
    expect(copy.hash()).toBe(room.hash());
    expect(copy.actor(1)!.m).toEqual(room.actor(1)!.m);
    expect(copy.actor(1)!.likeAcro).toBe(true);
    for (let i = 0; i < 80; i++) {
      const bits = i < 40 ? KEY_B | KEY_UP : KEY_LEFT;
      copy.step(new Map([[1, [bits]]]));
      room.step(new Map([[1, [bits]]]));
      expect(copy.hash()).toBe(room.hash());
    }
  });

  it('turns in place by jumping when B and the way back come together, as bike.c does', () => {
    const room = at('MAP_ROUTE101', 10, 10, SOUTH);
    mount(room);
    const a = room.actor(1)!;
    hold(room, 0, 3);
    hold(room, KEY_B | KEY_UP, 1);
    expect(a.m.action?.kind).toBe('hop');
    expect(a.m.action?.speed).toBe(0);
    expect(a.m.facing).toBe(SOUTH);
    hold(room, 0, 16);
    expect(a.m.facing).toBe(NORTH);
    expect(spot(room)).toEqual([10, 10]);
  });

  it('draws the ACRO BIKE sheet its own way: wheelie frames for a wheelie, a hop, and an ordinary ride', () => {
    const room = at('MAP_ROUTE101', 10, 10, SOUTH);
    mount(room);
    const a = room.actor(1)!;
    expect(acroFrame(a.m)).toBe(null);
    hold(room, KEY_B, 1);
    expect(a.m.acroState).toBe(ACRO_WHEELIE);
    expect(acroFrame(a.m)).toBe(9);
    hold(room, KEY_B, 5);
    expect(acroFrame(a.m)).toBe(10);
    hold(room, KEY_B, 4);
    expect(acroFrame(a.m)).toBe(21);
  });
});
