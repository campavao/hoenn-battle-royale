// A beaten leader's bag never shuts its winner in (player note #379, 11-16: "Trapped by gym
// leader's dropped bag"). The bag is solid and lies beside whoever won. In a one-wide aisle the
// only free cell beside them is the way back, and a bag they cannot empty (a full party leaves the
// rest of the team in it) is a wall there for the rest of the match. So: from every cell a trainer
// can face each leader from, win, leave the bag where it lies, and walk out of the gym's door.
import { describe, expect, it } from 'vitest';
import type { WorldMap, Spot } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { stepFn } from '../sim';
import { LEADERS, leaderAt } from './gyms';
import { KEY_A, makeRoom } from './room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const DXY: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };
const key = (s: Spot) => `${s.map}:${s.x}:${s.y}`;
const doors = (gym: string) => MAPS.flatMap((m) => (m.outdoor ? (m.warps ?? []).filter((w) => w.to === gym).map((w) => ({ map: gym, x: w.toX, y: w.toY })) : []));
const TEAM = [74, 74, 299, 75, 76, 95].map((sp) => ({ sp, lv: 30 }));

/** Every cell a trainer walks to from the gym's door and faces the leader from, and which way. */
function faces(l: (typeof LEADERS)[number]): { at: Spot; dir: number }[] {
  const room = makeRoom(MAPS, PATCHES, 1);
  const step = stepFn((room as unknown as { world: Parameters<typeof stepFn>[0] }).world, { surf: false, cut: 0 });
  const family = l.map.replace(/_(1F|B1F)$/, '');
  const start = doors(l.map);
  const seen = new Set(start.map(key)), q = [...start], out: { at: Spot; dir: number }[] = [];
  for (let i = 0; i < q.length; i++) {
    const at = q[i];
    for (const d of [1, 2, 3, 4]) {
      const [dx, dy] = DXY[d];
      if (leaderAt(at.map, at.x + dx, at.y + dy)) out.push({ at, dir: d });
      const r = step(at, d);
      if (!r || !r.to.map.startsWith(family) || leaderAt(r.to.map, r.to.x, r.to.y)) continue;
      if (!seen.has(key(r.to))) { seen.add(key(r.to)); q.push(r.to); }
    }
  }
  return out;
}

// The gyms a match has (SOOTOPOLIS's is not one of its maps, so nobody stands before JUAN).
const IN_MATCH = LEADERS.filter((l) => (makeRoom(MAPS, PATCHES, 1) as unknown as { maps: Map<string, unknown> }).maps.has(l.map));

describe("a beaten leader's bag never shuts its winner in (#379)", () => {
  it('covers seven gyms', () => expect(IN_MATCH.length).toBe(7));
  it.each(IN_MATCH.map((l) => [l.name, l] as const))('%s', (_name, l) => {
    const family = l.map.replace(/_(1F|B1F)$/, '');
    const shut: string[] = [];
    const spots = faces(l);
    expect(spots.length).toBeGreaterThan(0);
    for (const { at, dir } of spots) {
      const room = makeRoom(MAPS, PATCHES, 7);
      room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: at, facing: dir });
      room.step(new Map([[2, [KEY_A]]]));
      room.apply({ c: 'end', id: 2, won: true, team: TEAM });
      const bag = [...room.spills.values()].find((b) => b.name === l.name);
      expect(bag, `${l.name} from ${key(at)}: a bag`).toBeTruthy();
      // The walk out, with the bag where it lies: through any door off the gym's own floors.
      const step = room.stepFor(room.actor(2)!);
      const seen = new Set([key(at)]), q: Spot[] = [at];
      let out = false;
      for (let i = 0; i < q.length && !out; i++) {
        for (const d of [1, 2, 3, 4]) {
          const r = step(q[i], d);
          if (!r) continue;
          if (!r.to.map.startsWith(family)) { out = true; break; }
          if (!seen.has(key(r.to))) { seen.add(key(r.to)); q.push(r.to); }
        }
      }
      if (!out) shut.push(`${key(at)} (bag at ${bag!.x},${bag!.y})`);
    }
    expect(shut, `${l.name}: winners shut in by the bag`).toEqual([]);
  });
});
