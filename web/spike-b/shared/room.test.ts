// The shared world's one promise: a Room mirrored from the host's frame records is the
// host's Room, frame for frame -- with bots wandering, trainers' keys arriving late and
// bunched, a battle started and ended, and a phone that joins halfway from a snapshot.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { Host, play } from './host';
import { KEY_A, KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, makeRoom } from './room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;

describe('shared room', () => {
  it('mirrors the host frame for frame', () => {
    const seed = 12345;
    const host = new Host(makeRoom(MAPS, PATCHES, seed), 64, MAPS);
    const early = makeRoom(MAPS, PATCHES, seed);
    early.load(host.room.state());
    let late: ReturnType<typeof makeRoom> | null = null;

    const a = host.join('A', 0);
    const b = host.join('B', 1);
    const step = host.room.stepFor({ id: -1 } as never);
    const p = host.room.patchesOn('MAP_ROUTE101').find((q) => step({ map: 'MAP_ROUTE101', x: q.x - 1, y: q.y }, 4)?.to.x === q.x)!;
    const c = host.join('C', 2, { map: 'MAP_ROUTE101', x: p.x - 1, y: p.y });
    host.input(c, 1, Array(60).fill(KEY_RIGHT));
    let rng = 7;
    const r = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
    const dirs = [KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT, 0];
    const sent = new Map([[a, 0], [b, 0]]);
    const held = new Map([[a, 0], [b, 0]]);
    let wild = 0, fights = 0, moved = 0;
    const start = new Map<number, string>();

    for (let f = 0; f < 6000; f++) {
      // Each phone's keys, sent in bursts of 1..4 frames as a network would.
      for (const id of [a, b]) {
        if (r() < 0.05) held.set(id, dirs[Math.floor(r() * dirs.length)] | (r() < 0.3 ? KEY_B : 0) | (r() < 0.1 ? KEY_A : 0));
        if (r() < 0.4) {
          const n = 1 + Math.floor(r() * 4);
          const first = sent.get(id)! + 1;
          host.input(id, first, Array(n).fill(held.get(id)));
          // and sometimes the same burst again
          if (r() < 0.1) host.input(id, first, Array(n).fill(held.get(id)));
          sent.set(id, first + n - 1);
        }
      }
      const { frame, events } = host.advance();
      for (const e of events) {
        if (e.type === 'wild') wild += 1; else fights += 1;
        // the phone's battle lasts a while, then it says so
        const done = f + 30 + Math.floor(r() * 200);
        pendingEnds.push([done, e.id]);
      }
      for (const [t, id] of pendingEnds.filter(([t]) => t === f)) { host.end(id); void t; }
      const mine = play(early, frame);
      expect(mine.map((e) => e.type)).toEqual(events.map((e) => e.type));
      if (late) play(late, frame);
      if (f === 3000) { late = makeRoom(MAPS, PATCHES, seed); late.load(host.room.state()); }
      expect(early.hash()).toBe(host.room.hash());
      if (late) expect(late.hash()).toBe(host.room.hash());
      for (const id of [a, b]) {
        const s = host.room.actor(id)?.m.spot;
        if (s) { const k = `${s.map}:${s.x}:${s.y}`; if (start.get(id) && start.get(id) !== k) moved += 1; start.set(id, k); }
      }
    }
    expect(JSON.stringify(early.state())).toBe(JSON.stringify(host.room.state()));
    expect(moved).toBeGreaterThan(50);
    expect(wild).toBeGreaterThan(0);
    console.log(`wild ${wild}, fights ${fights}, steps ${moved}`);
  });
});

const pendingEnds: [number, number][] = [];

describe('room battles', () => {
  it('a marked spot starts one wild battle, then is taken', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    const step = room.stepFor({ id: -1 } as never);
    // a spot with open ground west of it on Route 101
    const p = room.patchesOn('MAP_ROUTE101').find((q) => step({ map: 'MAP_ROUTE101', x: q.x - 1, y: q.y }, 4)?.to.x === q.x)!;
    expect(p).toBeTruthy();
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_ROUTE101', x: p.x - 1, y: p.y }, facing: 4 });
    const a = room.actor(1)!;
    const events = [];
    for (let i = 0; i < 40 && !a.battling; i++) { a.keys = KEY_RIGHT; events.push(...room.step()); }
    expect(events).toMatchObject([{ type: 'wild', id: 1, x: p.x, y: p.y, key: p.key }]);
    expect(room.isTaken(p.key)).toBe(true);
    for (let i = 0; i < 30; i++) expect(room.step()).toEqual([]); // standing still in the battle
    room.apply({ c: 'end', id: 1 });
    // off and back on: nothing
    const more = [];
    for (const k of [KEY_LEFT, KEY_RIGHT]) for (let i = 0; i < 40; i++) { a.keys = k; more.push(...room.step()); }
    expect(more).toEqual([]);
  });

  it('A at a bot starts one fight; both stand until it ends', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 1, bot: true, name: 'BOT', skin: 4, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 12 }, facing: 1 });
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 9, y: 12 }, facing: 4 });
    const me = room.actor(2)!, bot = room.actor(1)!;
    me.keys = KEY_A;
    expect(room.step()).toMatchObject([{ type: 'fight', id: 2, foe: 1 }]);
    expect(bot.battling && me.battling && bot.beaten).toBe(true);
    expect(bot.m.facing).toBe(3); // turned to face the trainer
    room.apply({ c: 'end', id: 2 });
    expect(bot.battling || me.battling).toBe(false);
    me.keys = 0; room.step();
    me.keys = KEY_A;
    expect(room.step()).toEqual([]); // beaten: once only
  });
});
