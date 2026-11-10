// Every gym leader can be walked up to, on this game's own grid (Cam 2026-11-10: "audit every gym
// to make sure that they are accessible (aka I can get to the gym leader)"). A leader fights when A
// is pressed facing them (Room.step -> leaderAt) and is a wall otherwise, so the proof is a walk, by
// the same steps a trainer has and with no SURF, CUT or STRENGTH, from the town's door to a cell
// that faces them. The match has no gym trainers and no switches to press (br_strip.c clears the
// map), so a puzzle's walls are what stands between: MAUVILLE's beams were, until
// tools/br/open-gym-puzzles.py.
import { describe, expect, it } from 'vitest';
import type { WorldMap, Spot } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { FLY_SPOTS } from '../flyspots';
import { stepFn } from '../sim';
import { makeRoom } from './room';
import { LEADERS, leaderAt } from './gyms';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const DXY: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };

const room = makeRoom(MAPS, patchJson as unknown as PatchTable, 1);
const world = (room as unknown as { world: Parameters<typeof stepFn>[0] }).world;
const key = (s: Spot) => `${s.map}:${s.x}:${s.y}`;
/** The doors from a street into `gym`: the cell inside each one puts you on. */
const doors = (gym: string) => MAPS.flatMap((m) => (m.outdoor ? (m.warps ?? []).filter((w) => w.to === gym).map((w) => ({ town: m.id, x: w.x, y: w.y, inside: { map: gym, x: w.toX, y: w.toY } })) : []));

describe('every gym leader can be walked up to from the gym door', () => {
  it.each(LEADERS.map((l) => [l.name, l] as const))('%s', (_n, l) => {
    const step = stepFn(world, { surf: false, cut: 0 });
    // The gym's own floors: a hole or a ladder goes between them; a door back out is a street.
    const family = l.map.replace(/_(1F|B1F)$/, '');
    const start = doors(l.map).map((d) => d.inside);
    expect(start.length, `a door into ${l.map}`).toBeGreaterThan(0);
    const reached = new Set<string>(start.map(key)), q = [...start], stand: string[] = [];
    for (let i = 0; i < q.length; i++) {
      const at = q[i];
      for (const d of [1, 2, 3, 4]) {
        const [dx, dy] = DXY[d];
        if (leaderAt(at.map, at.x + dx, at.y + dy)) stand.push(key(at));
        const r = step(at, d);
        if (!r || !r.to.map.startsWith(family) || leaderAt(r.to.map, r.to.x, r.to.y)) continue;
        if (!reached.has(key(r.to))) { reached.add(key(r.to)); q.push(r.to); }
      }
    }
    expect(stand, `${l.name}: a cell to talk to them from, walked to from the door`).not.toEqual([]);
  });
});

describe('and the gym door is reachable', () => {
  // On foot from where a match deals you with nothing (mainland, boats counted), and the two it
  // is not: MOSSDEEP is an island (SURF, FLY or a ferry-less pick off the fly map) and SOOTOPOLIS a
  // crater under the sea (DIVE with SURF, or FLY). Every town is a FLY spot either way.
  const main = room.mainland();
  const MAINLAND = ['ROXANNE', 'BRAWLY', 'WATTSON', 'FLANNERY', 'NORMAN', 'WINONA'];
  it.each(LEADERS.map((l) => [l.name, l] as const))('%s', (name, l) => {
    const [door] = doors(l.map);
    expect(main.has(`${door.town}:${door.x}:${door.y + 1}`), `${name}'s door on the mainland`).toBe(MAINLAND.includes(name));
    // From the FLY landing to the gym's door, on foot, in the town itself. SOOTOPOLIS's gym is on
    // the lake's island, as in Emerald: SURF, and with it the whole way in.
    const [fx, fy] = FLY_SPOTS[door.town];
    const from: Spot = { map: door.town, x: fx, y: fy };
    const reaches = (surf: boolean) => {
      const step = stepFn(world, { surf, cut: 0 });
      const seen = new Set([key(from)]), q = [from];
      for (let i = 0; i < q.length; i++) {
        for (const d of [1, 2, 3, 4]) {
          const r = step(q[i], d);
          if (!r) continue;
          if (r.warp && r.to.map === door.inside.map && r.to.x === door.inside.x && r.to.y === door.inside.y) return true;
          if (r.to.map === door.town && !seen.has(key(r.to))) { seen.add(key(r.to)); q.push(r.to); }
        }
      }
      return false;
    };
    expect(reaches(false), `${name}: from the FLY landing to the door, no SURF`).toBe(name !== 'JUAN');
    expect(reaches(true), `${name}: from the FLY landing to the door, SURF`).toBe(true);
  });
});
