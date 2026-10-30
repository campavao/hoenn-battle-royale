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
