// The page's predicted trainer (net.ts Online.mine) against the relay's Room.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../src/bots/world';
import type { PatchTable } from '../src/bots/patches';
import worldJson from './data/world.json';
import patchJson from '../src/data/patches.json';
import { Online } from './net';
import { KEY_RIGHT, makeRoom } from './shared/room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const make = (seed: number) => makeRoom(MAPS, PATCHES, seed);

describe('the predicted trainer', () => {
  it('stops on a wild spot it walks onto, as the relay will, not past it (Cam 10-30 rubber band)', () => {
    const room = make(5);
    // A spot with open ground either side of it, west to east.
    const open = (map: string, x: number, y: number) => [0, 7].includes(room.world.cell(map, x, y));
    let at: { map: string; x: number; y: number } | undefined;
    for (const map of room.places.keys()) {
      const p = room.patchesOn(map).find((p) => open(map, p.x - 1, p.y) && open(map, p.x + 1, p.y) && open(map, p.x + 2, p.y)
        && !room.patchesOn(map).some((q) => q.y === p.y && (q.x === p.x - 1 || q.x === p.x + 1 || q.x === p.x + 2)));
      if (p) { at = { map, x: p.x, y: p.y }; break; }
    }
    expect(at).toBeDefined();
    room.apply({ c: 'join', id: 1, bot: false, name: 'ME', skin: 0, spot: { map: at!.map, x: at!.x - 1, y: at!.y }, facing: 4 });
    room.actor(1)!.calm = 0;
    const ws = { readyState: 1, send: () => undefined, addEventListener: () => undefined } as unknown as WebSocket;
    const link = new Online(ws, make);
    link.receive({ t: 'hello', id: 1, state: room.state() }, () => undefined);
    for (let i = 0; i < 60; i++) link.frame(KEY_RIGHT);
    expect(link.mine()!.m.spot).toEqual(at);
  });
});

describe('falling behind the relay', () => {
  // Cam's 10-31 play: "bots sort of teleported to me", right after a battle among the
  // bags. A phone that drew few frames in the fight was seconds behind the relay after
  // it, and the page played the whole backlog in one frame.
  const behind = (hurry: boolean) => {
    const room = make(5);
    const spot = [...room.places.keys()].map((map) => ({ map, x: 5, y: 5 })).find((s) => room.world.cell(s.map, s.x, s.y) === 0)!;
    room.apply({ c: 'join', id: 1, bot: false, name: 'ME', skin: 0, spot, facing: 1 });
    const ws = { readyState: 1, send: () => undefined, addEventListener: () => undefined } as unknown as WebSocket;
    const link = new Online(ws, make);
    link.receive({ t: 'hello', id: 1, state: room.state() }, () => undefined);
    const t0 = link.room.tick;
    link.receive({ t: 'f', f: Array.from({ length: 300 }, (_, i) => ({ tick: t0 + 1 + i })) } as never, () => undefined);
    (link as unknown as { hurry: boolean }).hurry = hurry;
    link.frame(0);
    return link.room.tick - t0;
  };
  it('catches up at a walk you can see on the field, never in one frame', () => {
    expect(behind(false)).toBeLessThanOrEqual(4);
  });
  it('and all at once while a battle or a ROM screen covers it', () => {
    expect(behind(true)).toBeGreaterThan(290);
  });
});
