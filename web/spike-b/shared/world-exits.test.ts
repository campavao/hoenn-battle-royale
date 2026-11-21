// Nobody walks into a place with no way back. A match lands you on LANDING cells; from
// anywhere you can then get to, by any set of field moves, there has to be a walk home. Ledges
// are one-way and fine, as long as the ground below them joins up again. Found on Cam's "I also
// don't think I'm going to be able to get out of here" (11-01): Terra Cave and the store's
// elevator could be walked into, with exits that went nowhere (export-world.py SHUT_WARPS).
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { makeRoom } from './room';
import { stepFn, newMover, tick, type Keys } from '../sim';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;

describe('the world has no one-way pockets', () => {
  const room = makeRoom(MAPS, patchJson as unknown as PatchTable, 1);
  const land = room.landing();
  const un = (key: string) => { const [map, x, y] = key.split(':'); return { map, x: +x, y: +y }; };

  const cases = [
    ['no field moves', { surf: false, cut: 0 }],
    ['CUT and STRENGTH', { surf: false, cut: 3 }],
    ['SURF', { surf: true, cut: 0 }],
    ['all of them', { surf: true, cut: 3 }],
  ] as const;
  it.each(cases)('with %s, everywhere you can reach has a way back', (_name, opts) => {
    const step = stepFn((room as unknown as { world: Parameters<typeof stepFn>[0] }).world, opts);
    const reached = new Set<string>(land), queue = [...land], cameFrom = new Map<string, string[]>();
    for (let i = 0; i < queue.length; i++) {
      for (const d of [1, 2, 3, 4]) {
        const r = step(un(queue[i]), d);
        if (!r) continue;
        const to = `${r.to.map}:${r.to.x}:${r.to.y}`;
        const list = cameFrom.get(to);
        if (list) list.push(queue[i]);
        else cameFrom.set(to, [queue[i]]);
        if (!reached.has(to)) { reached.add(to); queue.push(to); }
      }
    }
    const back = new Set<string>(land), home = [...land];
    for (let i = 0; i < home.length; i++) {
      for (const p of cameFrom.get(home[i]) ?? []) if (!back.has(p)) { back.add(p); home.push(p); }
    }
    const stuck = new Set([...reached].filter((c) => !back.has(c)).map((c) => c.split(':')[0]));
    expect([...stuck].sort()).toEqual([]);
  });

  // Through a warp the ROM turns you by the landing and walks you off it only if it is a door
  // (export-warp-exits.py); walked on the way they came, Devon Corp's stairs put a player
  // coming down in the dead end behind them, whose only way out was back up (#397).
  it('no warp walks you into a dead end', () => {
    const world = (room as unknown as { world: Parameters<typeof stepFn>[0] & { warpAt(id: string, x: number, y: number): unknown } }).world;
    const step = stepFn(world, { surf: true, cut: 3 });
    const reached = new Set<string>(land), queue = [...land];
    for (let i = 0; i < queue.length; i++) {
      for (const d of [1, 2, 3, 4]) {
        const r = step(un(queue[i]), d);
        if (!r) continue;
        const to = `${r.to.map}:${r.to.x}:${r.to.y}`;
        if (!reached.has(to)) { reached.add(to); queue.push(to); }
      }
    }
    const KEY: Record<number, keyof Keys> = { 1: 'down', 2: 'up', 3: 'left', 4: 'right' };
    const stuck: string[] = [];
    let walked = 0;
    for (const at of reached) {
      const from = un(at);
      if (world.warpAt(from.map, from.x, from.y)) continue;
      for (const d of [1, 2, 3, 4]) {
        if (!step(from, d)?.warp) continue;
        walked++;
        const m = newMover(from, d);
        for (let f = 0; f < 8; f++) tick(m, { [KEY[d]]: true }, step);
        for (let f = 0; f < 120; f++) tick(m, {}, step);
        if (![1, 2, 3, 4].some((e) => { const r = step(m.spot, e); return r && !r.warp; })) {
          stuck.push(`${at} ${KEY[d]} -> ${m.spot.map}:${m.spot.x}:${m.spot.y}`);
        }
      }
    }
    expect(walked).toBeGreaterThan(1500);
    expect(stuck).toEqual([]);
  });

  it("down Devon Corp's stairs lands on the floor below, facing south", () => {
    const step = stepFn((room as unknown as { world: Parameters<typeof stepFn>[0] }).world);
    const m = newMover({ map: 'MAP_RUSTBORO_CITY_DEVON_CORP_2F', x: 14, y: 2 }, 2);
    for (let f = 0; f < 8; f++) tick(m, { up: true }, step);
    for (let f = 0; f < 120; f++) tick(m, {}, step);
    expect(m.spot).toEqual({ map: 'MAP_RUSTBORO_CITY_DEVON_CORP_1F', x: 14, y: 2 });
    expect(m.facing).toBe(1);
  });

  it('a rock face is not a door', () => {
    const route = MAPS.find((m) => m.id === 'MAP_ROUTE113')!;
    expect(route.warps?.some((w) => w.to === 'MAP_TERRA_CAVE_ENTRANCE')).toBe(false);
  });
});
