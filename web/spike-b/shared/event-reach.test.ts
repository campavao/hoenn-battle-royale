// An event's legendary and the pieces around it must never wall one another (or an item
// ball) off from where a trainer walks in (Cam, 11-10: "bags and pokeballs near legendary
// pokemon can sometimes block it"). Every piece is solid, so every piece has to leave a
// standing cell beside it that a walk from outside the cluster reaches.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { stepFn } from '../sim';
import { EVENT_MAX } from '../../src/match/events';
import { RING_PHASE, makeRoom, type Room } from './room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
type Priv = { dropEvent(n: number, ring: ReturnType<Room['ring']>): void };

const DIRS = [1, 2, 3, 4];
const NEIGH: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const R = 14;

/** Pieces whose cell is not reachable from outside the cluster (d > 8 of the legendary), every
 *  other piece, the trader and every ball being a wall. */
function cutOff(room: Room): string[] {
  const out: string[] = [];
  for (const e of room.events) {
    if (e.story) continue;
    const step = stepFn(room.world);
    const wall = (map: string, x: number, y: number) => !!(room.groundAt(map, x, y) || room.spillAt(map, x, y) || room.traderAt(map, x, y));
    const key = (x: number, y: number) => `${x},${y}`;
    // Edges of the walk, reversed: who can step to a cell.
    const rev = new Map<string, [number, number][]>();
    for (let y = e.y - R; y <= e.y + R; y++) for (let x = e.x - R; x <= e.x + R; x++) {
      if (room.world.cell(e.map, x, y) !== 0 || wall(e.map, x, y)) continue;
      for (const dir of DIRS) {
        const r = step({ map: e.map, x, y }, dir);
        if (!r || r.warp || r.to.map !== e.map || wall(r.to.map, r.to.x, r.to.y)) continue;
        const k = key(r.to.x, r.to.y);
        (rev.get(k) ?? rev.set(k, []).get(k)!).push([x, y]);
      }
    }
    const pieces = [...room.spills.values()].filter((b) => b.map === e.map && Math.abs(b.x - e.x) + Math.abs(b.y - e.y) <= 9 && !(b.person));
    const targets = [...pieces.map((b) => ({ what: b.legend ? 'legendary' : `piece ${b.key}`, x: b.x, y: b.y })), ...(e.trader ? [{ what: 'trader', x: e.trader.x, y: e.trader.y }] : [])];
    for (const t of targets) {
      const seen = new Set<string>();
      const q: [number, number][] = [];
      for (const [dx, dy] of NEIGH) {
        const x = t.x + dx, y = t.y + dy;
        if (room.world.cell(e.map, x, y) === 0 && !wall(e.map, x, y)) { q.push([x, y]); seen.add(key(x, y)); }
      }
      let reached = false;
      while (q.length && !reached) {
        const [x, y] = q.pop()!;
        if (Math.abs(x - e.x) + Math.abs(y - e.y) > 8) { reached = true; break; }
        for (const p of rev.get(key(x, y)) ?? []) if (!seen.has(key(...p))) { seen.add(key(...p)); q.push(p); }
      }
      if (!reached) out.push(`${t.what} at ${e.map} ${t.x},${t.y} (legendary ${e.x},${e.y})`);
    }
  }
  return out;
}

describe('event pieces', () => {
  it('leave the legendary, every piece and the trader reachable from outside, over many seeds and events', () => {
    const bad: string[] = [];
    let drops = 0;
    for (const seed of [1, 7, 42, 99, 123, 777, 2024, 31337, 5, 64]) {
      const room = makeRoom(MAPS, PATCHES, seed);
      (room as unknown as { storyFor(): undefined }).storyFor = () => undefined;
      for (let n = 0; n < EVENT_MAX; n++) {
        for (const phase of [1, 3, 5]) {
          room.epoch = room.tick - phase * RING_PHASE - 5;
          const ring = room.ring();
          room.spills.clear();
          room.events.length = 0;
          (room as unknown as Priv).dropEvent(n, ring);
          if (!room.events.length) continue;
          drops++;
          for (const m of cutOff(room)) bad.push(`seed ${seed} event ${n} phase ${phase}: ${m}`);
        }
      }
    }
    expect(drops).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  }, 300_000);
});
