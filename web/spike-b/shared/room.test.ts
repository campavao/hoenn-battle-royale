// The shared world's one promise: a Room mirrored from the host's frame records is the
// host's Room, frame for frame -- with bots wandering, trainers' keys arriving late and
// bunched, a battle started and ended, and a phone that joins halfway from a snapshot.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { Host, play } from './host';
import { GROUND_PER_MAP, KEY_A, KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, makeRoom } from './room';

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
    let wild = 0, fights = 0, items = 0, moved = 0;
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
        if (e.type === 'item') { items += 1; continue; }
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
    console.log(`wild ${wild}, fights ${fights}, items ${items}, steps ${moved}`);
  });
});

describe('bots', () => {
  // Cam (2026-10-28): "why does everyone move so fast?" They ran and walked six tiles at a
  // go. Emerald's wanderers walk one tile at walking pace, then stand 32..128 frames.
  it("wander like the game's townsfolk: walk one tile, then stand", () => {
    const host = new Host(makeRoom(MAPS, PATCHES, 5), 64, MAPS);
    const bots = host.room.actors.map((a) => a.id);
    const last = new Map<number, string>();
    const stepEnd = new Map<number, number>();
    const wasStep = new Map<number, boolean>();
    const stepFrames = new Map<number, number>();
    let steps = 0, fastest = 0, shortRest = 0, hops = 0, turns = 0;
    for (let f = 0; f < 3600; f++) {
      host.advance();
      for (const id of bots) {
        const a = host.room.actor(id)!;
        const k = `${a.m.spot.map}:${a.m.spot.x}:${a.m.spot.y}`;
        const stepping = a.m.action?.kind === 'step';
        if (a.m.action?.kind === 'hop') hops += 1;
        if (a.m.action?.kind === 'turn') turns += 1;
        if (stepping) stepFrames.set(id, (stepFrames.get(id) ?? 0) + 1);
        if (wasStep.get(id) && !stepping) stepEnd.set(id, f);
        if (a.m.action?.kind === 'hop') stepEnd.delete(id);
        if (last.has(id) && last.get(id) !== k) {
          steps += 1;
          // from the end of its last step to the start of this one: a rest of 32+
          if (stepEnd.has(id) && f - stepEnd.get(id)! < 32) shortRest += 1;
        }
        wasStep.set(id, stepping);
        last.set(id, k);
        if (stepping) fastest = Math.max(fastest, a.m.action!.speed);
      }
    }
    const perBotPerMinute = steps / bots.length;
    // one tile every ~1.5 s on average, never a run
    expect(perBotPerMinute).toBeGreaterThan(15);
    expect(perBotPerMinute).toBeLessThan(60);
    expect(shortRest).toBe(0);
    expect(hops).toBe(0); // wanderers never jump a ledge
    expect(turns).toBe(0); // they face and walk at once, no turn in place
    expect(fastest).toBe(1); // a pixel a frame: walking
    const frames = [...stepFrames.values()].reduce((x, y) => x + y, 0);
    expect(frames / steps).toBeGreaterThan(14); // 16 frames a tile (15 seen mid-action): walking, not 8
  });
});

describe('comings and goings', () => {
  it('a trainer who leaves mid-fight lets the bot walk again', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 1, bot: true, name: 'BOT', skin: 4, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 12 }, facing: 1 });
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 9, y: 12 }, facing: 4 });
    room.step(new Map([[2, [KEY_A]]]));
    expect(room.actor(1)!.battling).toBe(true);
    room.apply({ c: 'leave', id: 2 });
    expect(room.actor(1)!.battling).toBe(false);
  });

  it('two trainers joining in one frame stand on two tiles', () => {
    const host = new Host(makeRoom(MAPS, PATCHES, 99), 0, MAPS);
    const a = host.join('A', 0), b = host.join('B', 1);
    host.advance();
    expect(host.room.actor(a)!.m.spot).not.toEqual(host.room.actor(b)!.m.spot);
  });
});

describe('late keys', () => {
  // The relay's walk is the thumb's: whenever the phone's inputs arrive (bunched, late,
  // after a dry spell), the relay's trainer ends where the phone's own replay of the same
  // inputs does, every move of the way (review of #160: it used to stop a tile off).
  it('the relay walks the inputs the phone walked, however they arrive', () => {
    let rng = 99;
    const r = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
    for (let trial = 0; trial < 40; trial++) {
      const host = new Host(makeRoom(MAPS, PATCHES, 7), 0, MAPS);
      const start = { map: 'MAP_ROUTE101', x: 5, y: 10 };
      const id = host.join('A', 0, start);
      // the phone: holds and taps, one input a frame, walked on its own copy
      const inputs: number[] = [];
      for (let k = 0; k < 6; k++) {
        const bits = [KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT][Math.floor(r() * 4)] | (r() < 0.3 ? KEY_B : 0);
        const len = 1 + Math.floor(r() * 30);
        for (let i = 0; i < len; i++) inputs.push(bits);
        for (let i = Math.floor(r() * 10); i > 0; i--) inputs.push(0);
      }
      for (let i = 0; i < 20; i++) inputs.push(0);
      const phone = makeRoom(MAPS, PATCHES, 7);
      phone.apply({ c: 'join', id, bot: false, name: 'A', skin: 0, spot: start, facing: 1 });
      for (const bits of inputs) phone.step(new Map([[id, [bits]]]));
      // the network: each input arrives 0..12 frames late, in order
      const due: number[] = [];
      let t = 1;
      for (let i = 0; i < inputs.length; i++) { t = Math.max(t, i + Math.floor(r() * 13)); due.push(t); }
      let next = 0;
      for (let f = 0; f < inputs.length + 60; f++) {
        while (next < inputs.length && due[next] <= f) { host.input(id, next + 1, [inputs[next]]); next++; }
        host.advance();
      }
      expect(host.backlog(id)).toBe(0);
      expect(host.room.actor(id)!.m).toEqual(phone.actor(id)!.m);
    }
  }, 20_000); // 80 rooms' walks: ~3 s here, and a shared CI runner can take twice that
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
    for (let i = 0; i < 40 && !a.battling; i++) { events.push(...room.step(new Map([[1, [KEY_RIGHT]]]))); }
    expect(events).toMatchObject([{ type: 'wild', id: 1, x: p.x, y: p.y, key: p.key }]);
    expect(room.isTaken(p.key)).toBe(true);
    for (let i = 0; i < 30; i++) expect(room.step()).toEqual([]); // standing still in the battle
    room.apply({ c: 'end', id: 1 });
    // off and back on: nothing
    const more = [];
    for (const k of [KEY_LEFT, KEY_RIGHT]) for (let i = 0; i < 40; i++) { more.push(...room.step(new Map([[1, [k]]]))); }
    expect(more).toEqual([]);
  });

  it('A at a bot starts one fight; both stand until it ends', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 1, bot: true, name: 'BOT', skin: 4, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 12 }, facing: 1 });
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 9, y: 12 }, facing: 4 });
    const me = room.actor(2)!, bot = room.actor(1)!;
    const press = (bits: number) => room.step(new Map([[2, [bits]]]));
    expect(press(KEY_A)).toMatchObject([{ type: 'fight', id: 2, foe: 1 }]);
    expect(bot.battling && me.battling && bot.beaten).toBe(true);
    expect(bot.m.facing).toBe(3); // turned to face the trainer
    room.apply({ c: 'end', id: 2 });
    expect(bot.battling || me.battling).toBe(false);
    me.keys = KEY_B;
    room.apply({ c: 'end', id: 2 }); // not battling: nothing
    expect(me.keys).toBe(KEY_B);
    press(0);
    expect(press(KEY_A)).toEqual([]); // beaten: once only
  });
});

describe('item balls', () => {
  it('are dealt from the seed on plain ground a trainer can reach, a few a map', () => {
    const one = makeRoom(MAPS, PATCHES, 4242), two = makeRoom(MAPS, PATCHES, 4242), other = makeRoom(MAPS, PATCHES, 7);
    const g = [...one.ground().values()];
    expect(g).toEqual([...two.ground().values()]);
    expect(g).not.toEqual([...other.ground().values()]);
    const perMap = new Map<string, number>();
    for (const b of g) perMap.set(b.map, (perMap.get(b.map) ?? 0) + 1);
    expect(perMap.size).toBeGreaterThanOrEqual(5); // every map you can walk to
    expect(Math.max(...perMap.values())).toBeLessThanOrEqual(GROUND_PER_MAP);
    for (const b of g) {
      expect(one.world.cell(b.map, b.x, b.y)).toBe(0);
      expect(one.patchesOn(b.map).some((q) => q.x === b.x && q.y === b.y)).toBe(false);
      expect(b.item).toBeGreaterThan(0);
    }
    expect(new Set(g.map((b) => b.key)).size).toBe(g.length);
  });

  it('a ball is solid; A at it takes it once, off the map for everybody', () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const step = room.stepFor({ id: -1 } as never);
    // a ball with open ground west of it
    const b = [...room.ground().values()].find((q) => room.world.cell(q.map, q.x - 1, q.y) === 0 && !room.patchesOn(q.map).some((p) => p.x === q.x - 1 && p.y === q.y))!;
    expect(b).toBeTruthy();
    expect(step({ map: b.map, x: b.x - 1, y: b.y }, 4)).toBeNull(); // solid
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: b.map, x: b.x - 1, y: b.y }, facing: 4 });
    const press = (bits: number) => room.step(new Map([[1, [bits]]]));
    expect(press(KEY_A)).toMatchObject([{ type: 'item', id: 1, key: b.key, item: b.item }]);
    expect(room.groundAt(b.map, b.x, b.y)).toBeUndefined();
    press(0);
    expect(press(KEY_A)).toEqual([]); // gone
    const mirror = makeRoom(MAPS, PATCHES, 4242);
    mirror.load(room.state());
    expect(mirror.groundAt(b.map, b.x, b.y)).toBeUndefined();
    expect(mirror.hash()).toBe(room.hash());
    // now the cell is open
    let walked = false;
    for (let i = 0; i < 40 && !walked; i++) { press(KEY_RIGHT); walked = room.actor(1)!.m.spot.x === b.x; }
    expect(walked).toBe(true);
  });
});
