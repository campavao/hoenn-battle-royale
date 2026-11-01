// The shared world's one promise: a Room mirrored from the host's frame records is the
// host's Room, frame for frame -- with bots wandering, trainers' keys arriving late and
// bunched, a battle started and ended, and a phone that joins halfway from a snapshot.
import { SAFARI_CELLS } from '../../src/match/safari';
import { GIFTS } from '../../src/match/gifts';
import { GOLD } from '../../src/match/events';
import ballsC from '../../../src/br/br_balls.c?raw';
import zoneC from '../../../src/br/br_zone.c?raw';
import roomsJson from '../data/rooms.json';
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import sectionsJson from '../../../src/data/region_map/region_map_sections.json';
import { STORIES } from '../../src/match/story';
import patchJson from '../../src/data/patches.json';
import { Host, play } from './host';
import { over } from './over';
import { ITEM_LINK_CABLE, ITEM_POKE_DOLL, cleanBag, isTm, within } from './items';
import { HURT, botKeys, health } from './bots';
import { AFTER_WIN, FIELD_SURF, SAFARI, PICK_WAIT, GROUND_PER_MAP, RING_PHASE, SECTION_TILES, SPILL_KEY, KEY_A, KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_SELECT, KEY_UP, WALKUP_BANG, CHEST, CHEST_SPECIES, ITEM_MASTER_BALL, ZONE_CELLS, ZONE_ITEMS, ZONE_TMS, eventPiece, makeRoom, zoneBalls, wornParty, type RoomEvent } from './room';

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
    // In the Zone, where they have nowhere to be (out in Hoenn each is soon on its way
    // somewhere, bots.ts wander).
    const r = makeRoom(MAPS, PATCHES, 5);
    r.opening = 120 * 60;
    const host = new Host(r, 29, MAPS);
    const bots = host.room.actors.map((a) => a.id);
    const last = new Map<number, string>();
    const stepEnd = new Map<number, number>();
    const wasStep = new Map<number, boolean>();
    const stepFrames = new Map<number, number>();
    let steps = 0, fastest = 0, shortRest = 0, hops = 0, turns = 0;
    // Wanderers only: one walking into the coming ring, or up to somebody, has somewhere
    // to be.
    const walkers = new Set<number>();
    const FRAMES = 3600;
    for (let f = 0; f < FRAMES; f++) {
      host.advance();
      for (const id of bots) if (host.brains.get(id)?.steps?.length) walkers.add(id);
      for (const id of bots) {
        if (walkers.has(id)) continue;
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
    expect(walkers.size).toBeLessThan(bots.length - 6);
    const perBotPerMinute = steps / (bots.length - walkers.size) * 3600 / FRAMES;
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

describe('bots with somewhere to be', () => {
  it('walk into the coming ring before it closes, and some to an event while its legendary stands', () => {
    const host = new Host(makeRoom(MAPS, PATCHES, 8), 29, MAPS);
    const room = host.room;
    // A legendary's event, not a story's (STORY_CHANCE), and not the final ring's sea.
    (room as unknown as { storyFor(): undefined }).storyFor = () => undefined;
    expect(room.centre(room.ring().round).final).toBeUndefined();
    // Phase 5 (2 sections next): the first shrinks, live's 15 and 9 sections, leave the
    // walk out of Littleroot that the bots are dealt on alone.
    room.epoch = room.tick - 5 * RING_PHASE;
    const r0 = room.ring();
    // How many bots the next fog would catch, were it to close now.
    const r1 = { ...r0, r: r0.next! };
    const outside = () => room.actors.filter((a) => a.bot && room.inFog(a.m.spot, r1)).length;
    const before = outside();
    expect(before).toBeGreaterThan(8);
    for (let f = 0; f < RING_PHASE - 60; f++) host.advance();
    expect(outside()).toBeLessThanOrEqual(before / 2);
    // A legendary on the ground draws some of them (an early phase's event).
    room.epoch = room.tick - RING_PHASE + 60;
    room.ringPhase = RING_PHASE;
    for (let f = 0; f < 120; f++) host.advance();
    const e = room.events[0];
    expect(e).toBeDefined();
    for (let f = 0; f < 60 * 60; f++) host.advance();
    const near = room.actors.filter((a) => a.bot && a.m.spot.map === e.map && Math.abs(a.m.spot.x - e.x) + Math.abs(a.m.spot.y - e.y) <= 6);
    expect(near.length).toBeGreaterThan(0);
  });
});

describe('released', () => {
  it('a mon a full party let go lies beside its trainer as a ball, never under them (POK-294)', () => {
    const host = new Host(makeRoom(MAPS, PATCHES, 99), 0, MAPS);
    const a = host.join('A', 0, { map: 'MAP_ROUTE101', x: 10, y: 10 });
    host.advance();
    const me = host.room.actor(a)!;
    host.released(a, [{ species: 25, level: 12 }]);
    host.advance();
    host.released(a, [{ species: 4, level: 9 }]);
    host.advance();
    const balls = [...host.room.spills.values()].filter((s) => s.bag.mons?.length === 1 && [25, 4].includes(s.bag.mons[0].species));
    expect(balls.map((b) => b.bag.mons![0].species).sort((x, y) => x - y)).toEqual([4, 25]);
    for (const b of balls) {
      expect(b.map).toBe(me.m.spot.map);
      expect(Math.abs(b.x - me.m.spot.x) + Math.abs(b.y - me.m.spot.y), 'beside, not under').toBe(1);
    }
    expect(new Set(balls.map((b) => `${b.x}:${b.y}`)).size, 'one cell each').toBe(2);
    // A page that was not there sees the same balls.
    const late = makeRoom(MAPS, PATCHES, 99);
    late.load(host.room.state());
    expect([...late.spills.keys()].sort()).toEqual([...host.room.spills.keys()].sort());
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
  it('a taken spot grows back with the next ring phase, not on a timer (br_patch.c Regrow)', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    const key = room.patchesOn('MAP_ROUTE101')[0].key;
    // Taken at the start of the ring's second phase.
    room.tick = room.epoch + room.opening + room.ringPhase + 1;
    room.taken.set(key, room.tick);
    // Longer than the old 90 s, still in that phase: still taken.
    room.tick += room.ringPhase - 60;
    room.step();
    expect(room.isTaken(key)).toBe(true);
    // Into the next phase: back.
    room.tick += 120;
    room.step();
    expect(room.isTaken(key)).toBe(false);
    expect(room.taken.has(key)).toBe(false);
  });

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
    expect(bot.battling && me.battling).toBe(true);
    expect(bot.m.facing).toBe(3); // turned to face the trainer
    room.apply({ c: 'end', id: 2, won: true });
    // Beaten: off the map, its team and purse in a bag where it stood (HBR-90).
    expect(room.actor(1)).toBeUndefined();
    expect(me.battling).toBe(false);
    const b = room.spillAt('MAP_LITTLEROOT_TOWN', 10, 12)!;
    expect(b).toMatchObject({ key: SPILL_KEY + 1, name: 'BOT' });
    expect(b.bag.mons!.length).toBeGreaterThan(0);
    expect(b.bag.money).toBeGreaterThan(0);
    expect(room.results.fallen).toEqual([]); // not in a match: nobody to rank
    me.keys = KEY_B;
    room.apply({ c: 'end', id: 2 }); // not battling: nothing
    expect(me.keys).toBe(KEY_B);
    press(0);
    expect(press(KEY_A)).toMatchObject([{ type: 'bag', id: 2, key: SPILL_KEY + 1, name: 'BOT' }]); // its bag, not a fight
  });
});

describe('trainer against trainer', () => {
  const L = 'MAP_LITTLEROOT_TOWN';
  /** Frames on until a fight's events (after the "!" and the walk-up): them, and how many. */
  const fightAfter = (room: ReturnType<typeof makeRoom>, max = 400) => {
    for (let i = 0; i < max; i++) {
      const e = room.step(new Map());
      if (e.length) return { e, i };
    }
    return { e: [], i: max };
  };
  it('the one who walks up leaving, or a new round, frees the other: no battle is coming', () => {
    for (const how of ['leave', 'out', 'round'] as const) {
      const room = makeRoom(MAPS, PATCHES, 99);
      room.apply({ c: 'join', id: 3, bot: false, name: 'A', skin: 0, spot: { map: L, x: 9, y: 12 }, facing: 1 });
      room.apply({ c: 'join', id: 5, bot: false, name: 'B', skin: 1, spot: { map: L, x: 12, y: 12 }, facing: 3 });
      const a = room.actor(3)!;
      for (let i = 0; i < 300; i++) room.step(new Map());
      expect(a.meet?.walk).toBe(false);
      if (how === 'round') (room as unknown as { newRound(n: number): void }).newRound(1);
      else room.apply({ c: how, id: 5 });
      expect([a.battling, a.meet, a.foe]).toEqual([false, undefined, 0]);
    }
  });

  it('two trainers who see each other fight once, and stand until each one ends it', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 3, bot: false, name: 'A', skin: 0, spot: { map: L, x: 9, y: 12 }, facing: 1 });
    room.apply({ c: 'join', id: 5, bot: false, name: 'B', skin: 1, spot: { map: L, x: 12, y: 12 }, facing: 3 });
    const a = room.actor(3)!, b = room.actor(5)!;
    // New by the truck: a grace first.
    for (let i = 0; i < 300; i++) expect(room.step(new Map())).toEqual([]);
    // B looks west along the row at A, three cells off: an engage, whoever looks. B
    // looked, so B walks up (br_walkup.h), after the "!".
    expect(a.battling && b.battling).toBe(true);
    expect([a.meet?.walk, b.meet?.walk]).toEqual([false, true]);
    const { e, i } = fightAfter(room);
    expect(i).toBeGreaterThanOrEqual(WALKUP_BANG);
    expect(e).toMatchObject([
      { type: 'duel', id: 3, foe: 5, first: true },
      { type: 'duel', id: 5, foe: 3, first: false },
    ]);
    expect([a.m.spot.x, b.m.spot.x]).toEqual([9, 10]); // beside
    expect([a.m.facing, b.m.facing]).toEqual([4, 3]); // face to face
    expect(room.step(new Map([[3, [KEY_DOWN]], [5, [KEY_A]]]))).toEqual([]);
    expect([a.m.spot.x, b.m.spot.x, a.m.spot.y, b.m.spot.y]).toEqual([9, 10, 12, 12]);
    // One side's battle over first: the other is still in theirs.
    room.apply({ c: 'end', id: 3 });
    expect([a.battling, b.battling]).toEqual([false, true]);
    room.apply({ c: 'end', id: 5 });
    // The grace: no second fight straight away.
    for (let i = 0; i < 120; i++) expect(room.step(new Map())).toEqual([]);
    expect(a.meet && b.meet).toBeTruthy();
    expect(fightAfter(room).e).toMatchObject([{ type: 'duel' }, { type: 'duel' }]);
  });

  it('sees five cells along the look and no further', () => {
    const room0 = makeRoom(MAPS, PATCHES, 99);
    // A row of Littleroot with nothing in the way for seven cells.
    let x0 = -1, y0 = -1;
    for (let y = 0; y < 20 && x0 < 0; y++) for (let x = 0; x < 14 && x0 < 0; x++) {
      if ([0, 1, 2, 3, 4, 5, 6].every((d) => room0.world.clear(L, x + d, y) && room0.world.standable(L, x + d, y))) { x0 = x; y0 = y; }
    }
    expect(x0).toBeGreaterThanOrEqual(0);
    const at = (dx: number) => {
      const room = makeRoom(MAPS, PATCHES, 99);
      room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: L, x: x0, y: y0 }, facing: 4 });
      room.apply({ c: 'join', id: 3, bot: false, name: 'B', skin: 1, spot: { map: L, x: x0 + dx, y: y0 }, facing: 2 });
      for (let i = 0; i < 300; i++) room.step(new Map());
      return !!room.actor(2)!.meet;
    };
    expect(at(6)).toBe(false); // six cells
    expect(at(5)).toBe(true); // five
  });

  it('a bot that sees a trainer challenges them, once its grace is over; not one the trainer fled', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 1, bot: true, name: 'BOT', skin: 4, spot: { map: L, x: 10, y: 12 }, facing: 3 });
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: L, x: 7, y: 12 }, facing: 1 });
    const bot = room.actor(1)!, me = room.actor(2)!;
    const events: ReturnType<typeof room.step> = [];
    for (let i = 0; i < 400 && !me.battling; i++) events.push(...room.step(new Map()));
    expect(events).toEqual([]);
    // It faced the trainer down the line: it walks up, a map trainer's way.
    expect(bot.meet?.walk).toBe(true);
    expect(fightAfter(room).e).toMatchObject([{ type: 'fight', id: 2, foe: 1 }]);
    expect([me.m.spot.x, bot.m.spot.x]).toEqual([7, 8]);
    expect(me.m.facing).toBe(4); // turned to the bot
    expect(bot.m.facing).toBe(3);
    room.apply({ c: 'end', id: 2, fled: true });
    for (let i = 0; i < 300; i++) expect(room.step(new Map())).toEqual([]); // fled: apart a while
  });

  it('two bots that see each other fight on a trainer\'s page; the loser is out, no answer and both walk on', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: { map: L, x: 9, y: 12 }, facing: 4 });
    room.apply({ c: 'join', id: 2, bot: true, name: 'TWO', skin: 5, spot: { map: L, x: 11, y: 12 }, facing: 3 });
    // Nobody to fight it out: no fight.
    for (let i = 0; i < 400; i++) expect(room.step(new Map())).toEqual([]);
    room.apply({ c: 'join', id: 7, bot: false, name: 'A', skin: 0, spot: { map: L, x: 3, y: 3 }, facing: 1 });
    const events: ReturnType<typeof room.step> = [];
    for (let i = 0; i < 20 && !events.length; i++) events.push(...room.step(new Map()));
    expect(events).toMatchObject([{ type: 'bots', id: 7, a: 1, b: 2 }]);
    const one = room.actor(1)!, two = room.actor(2)!;
    expect([one.battling, two.battling, one.foe, two.foe]).toEqual([true, true, 2, 1]);
    // Somebody else's answer, or one for another pair, is no answer.
    room.apply({ c: 'bots', id: 3, a: 1, b: 2, winner: 1 });
    room.apply({ c: 'bots', id: 7, a: 2, b: 5, winner: 2 });
    expect(one.battling).toBe(true);
    room.apply({ c: 'lock' });
    room.apply({ c: 'bots', id: 7, a: 1, b: 2, winner: 2 });
    // The loser is off the map, its bag where it stood; the winner walks on.
    expect(room.actor(1)).toBeUndefined();
    expect(two.battling).toBe(false);
    expect(room.spillAt(L, 9, 12)).toMatchObject({ key: SPILL_KEY + 1, name: 'ONE' });
    expect(room.results.fallen).toMatchObject([{ id: 1, by: 'TWO', bot: true }]);
  });

  it("a bots' fight spends from both bags and leaves the winner what it had left (brain.ts settleAnswered)", () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: { map: L, x: 9, y: 12 }, facing: 4 });
    room.apply({ c: 'join', id: 2, bot: true, name: 'TWO', skin: 5, spot: { map: L, x: 11, y: 12 }, facing: 3 });
    room.apply({ c: 'join', id: 7, bot: false, name: 'A', skin: 0, spot: { map: L, x: 3, y: 3 }, facing: 1 });
    const one = room.actor(1)!, two = room.actor(2)!;
    one.loot = { items: [{ id: 13, n: 2 }, { id: 22, n: 1 }], money: 0 };
    two.loot = { items: [{ id: 13, n: 1 }], money: 0 };
    for (let i = 0; i < 400 && !one.battling; i++) room.step(new Map());
    expect(one.foe).toBe(2);
    room.apply({ c: 'lock' });
    // TWO won on half its lead and a fainted second; ONE drank a POTION, TWO its only one.
    room.apply({ c: 'bots', id: 7, a: 1, b: 2, winner: 2, hp: [0.5, 0, 3], used: [[13], [13, 13]] });
    expect(two.wear).toEqual([0.5, 0, 1]);
    expect(two.loot!.items).toEqual([]);
    // What ONE drank is not on the ground where it fell.
    expect(room.spillAt(L, 9, 12)!.bag.items).not.toContainEqual({ id: 13, n: 2 });
    expect(room.spillAt(L, 9, 12)!.bag.items).toContainEqual({ id: 13, n: 1 });
  });

  it('one bot fight at a time, room-wide; the page that ran it leaving lets them go', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 7, bot: false, name: 'A', skin: 0, spot: { map: L, x: 3, y: 3 }, facing: 1 });
    room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: { map: L, x: 9, y: 12 }, facing: 4 });
    room.apply({ c: 'join', id: 2, bot: true, name: 'TWO', skin: 5, spot: { map: L, x: 11, y: 12 }, facing: 3 });
    room.apply({ c: 'join', id: 3, bot: true, name: 'SIX', skin: 4, spot: { map: L, x: 9, y: 15 }, facing: 4 });
    room.apply({ c: 'join', id: 4, bot: true, name: 'TEN', skin: 5, spot: { map: L, x: 11, y: 15 }, facing: 3 });
    const events: ReturnType<typeof room.step> = [];
    for (let i = 0; i < 400; i++) events.push(...room.step(new Map()).filter((e) => e.type === 'bots'));
    expect(events).toHaveLength(1);
    room.apply({ c: 'leave', id: 7 });
    expect(room.actors.filter((a) => a.battling)).toEqual([]);
  });

  it('a fight that never got going, or was fled, keeps that pair apart ten seconds', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 3, bot: false, name: 'A', skin: 0, spot: { map: L, x: 9, y: 12 }, facing: 4 });
    room.apply({ c: 'join', id: 5, bot: false, name: 'B', skin: 1, spot: { map: L, x: 11, y: 12 }, facing: 3 });
    for (let i = 0; i < 300; i++) room.step(new Map());
    expect(room.actor(3)!.battling).toBe(true);
    expect(fightAfter(room).e).toHaveLength(2);
    room.apply({ c: 'end', id: 3, fled: true });
    room.apply({ c: 'end', id: 5 });
    for (let i = 0; i < 600; i++) expect(room.step(new Map())).toEqual([]);
    expect(room.actor(3)!.meet).toBeTruthy();
    expect(fightAfter(room).e).toHaveLength(2);
  });

  it('a trainer whose foe left is still in the fight until their page ends it', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 3, bot: false, name: 'A', skin: 0, spot: { map: L, x: 9, y: 12 }, facing: 4 });
    room.apply({ c: 'join', id: 5, bot: false, name: 'B', skin: 1, spot: { map: L, x: 11, y: 12 }, facing: 1 });
    for (let i = 0; i < 300; i++) room.step(new Map());
    expect(fightAfter(room).e).toHaveLength(2);
    room.apply({ c: 'leave', id: 5 });
    expect(room.actor(3)!.battling).toBe(true);
    room.apply({ c: 'end', id: 3 });
    expect(room.actor(3)!.battling).toBe(false);
  });
});

describe('item balls', () => {
  it('are dealt from the seed on plain ground a trainer can reach, a few a map', () => {
    const one = makeRoom(MAPS, PATCHES, 4242), two = makeRoom(MAPS, PATCHES, 4242), other = makeRoom(MAPS, PATCHES, 7);
    // The field's (the Zone's six are br_zone.c's, below).
    const g = [...one.ground().values()].filter((b) => !b.map.startsWith(SAFARI));
    expect(g).toEqual([...two.ground().values()].filter((b) => !b.map.startsWith(SAFARI)));
    expect(g).not.toEqual([...other.ground().values()].filter((b) => !b.map.startsWith(SAFARI)));
    const perMap = new Map<string, number>();
    for (const b of g) if (!b.gift) perMap.set(b.map, (perMap.get(b.map) ?? 0) + 1);
    expect(perMap.size).toBeGreaterThanOrEqual(5); // every map you can walk to
    expect(Math.max(...perMap.values())).toBeLessThanOrEqual(GROUND_PER_MAP);
    // All over Hoenn, not the seven maps walkable from Littleroot (a drop in Mauville found
    // nothing on the ground), and every one on open ground a trainer walks out of.
    for (const m of ['MAP_MAUVILLE_CITY', 'MAP_FORTREE_CITY', 'MAP_LILYCOVE_CITY', 'MAP_SLATEPORT_CITY', 'MAP_ROUTE119']) expect(perMap.get(m), m).toBeGreaterThan(0);
    const open = new Set(one.open().map((c) => `${c.map}:${c.x}:${c.y}`));
    const outdoors = g.filter((b) => one.places.has(b.map));
    for (const b of outdoors) expect(open.has(`${b.map}:${b.x}:${b.y}`), `${b.map}:${b.x}:${b.y}`).toBe(true);
    for (const b of g) {
      // Outdoors on the ground; a house's cache on its table, as br_balls.c lays it (a
      // wall cell, taken from the cell in front).
      expect(one.places.has(b.map) ? [0] : [0, 1], `${b.map}:${b.x}:${b.y}`).toContain(one.world.cell(b.map, b.x, b.y));
      expect(one.patchesOn(b.map).some((q) => q.x === b.x && q.y === b.y)).toBe(false);
      expect(b.item).toBeGreaterThan(0);
    }
    expect(new Set(g.map((b) => b.key)).size).toBe(g.length);
  });

  it('every house and floor with a cache in the live match has its ball: a machine, or gold', () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const rooms = roomsJson as [string, number, number, boolean, boolean, number, number, boolean][];
    const g = [...room.ground().values()];
    const caches = g.filter((b) => !room.places.has(b.map) && !b.map.startsWith(SAFARI));
    expect(caches.length).toBeGreaterThan(20);
    for (const b of caches) {
      expect(rooms.some(([m, x, y, , cache]) => cache && m === b.map && x === b.x && y === b.y)).toBe(true);
      expect(isTm(b.item) || GOLD.includes(b.item)).toBe(true);
    }
    // ...and the table is br_balls.c's as it stands (tools/br/spike-rooms.py makes it).
    const houses = Number(/#define BR_HOUSES (\d+)/.exec(ballsC)![1]);
    const body = ballsC.slice(ballsC.indexOf('static const struct BrRoom sRooms[] ='));
    const rows = [...body.slice(0, body.indexOf('};')).matchAll(/\{ (MAP_\w+), (\d+), (\d+), (\d+), (\d+), (TRUE|FALSE), (\w+) \}/g)];
    expect(rooms).toEqual(rows.map((r, i) => [r[1], Number(r[2]), Number(r[3]), i < houses, r[6] === 'TRUE', Number(r[4]), Number(r[5]), r[7] !== 'BR_NO_TRADER']));
  });

  it("a story event lays its reward where Emerald set it, and is told once a round", () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const r = room as unknown as { storyFor(rng: () => number, ring: unknown): { id: string } | undefined; tellStory(n: number, ring: unknown, s: unknown, rng: () => number): void };
    const ring = { ...room.ring(), r: Infinity, phase: 2 };
    const told = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const s = r.storyFor(() => (i * 0.37) % 1, ring);
      if (!s) break;
      expect(told.has(s.id)).toBe(false);
      told.add(s.id);
      r.tellStory(i, ring, s, () => 0.5);
    }
    // The place-and-reward rows this world has the maps for.
    expect([...told].sort()).toEqual(expect.arrayContaining(['abandoned-ship', 'ancient-tomb', 'desert-ruins', 'granite-cave', 'island-cave', 'lavaridge-egg', 'mirage-tower', 'stevens-house']));
    // ...and the islands, which the ferry sails to; not the final ring's two.
    expect(told.has('southern-island')).toBe(true);
    expect(told.has('sky-pillar') || told.has('sootopolis')).toBe(false);
    // CAPT. STERN stands at his harbour with what he gives for the SCANNER.
    const stern = [...room.spills.values()].find((b) => b.person?.wants);
    expect(stern).toMatchObject({ map: 'MAP_SLATEPORT_CITY_HARBOR', x: 6, y: 13, person: { name: 'CAPT. STERN', wants: 278 } });
    const steven = room.events.find((e) => e.story === 'stevens-house')!;
    expect(steven.species).toBe(0);
    expect(room.spillAt('MAP_MOSSDEEP_CITY_STEVENS_HOUSE', 4, 2)?.bag.mons?.[0].species).toBe(398);
    expect(steven.trader).toMatchObject({ x: 5, y: 2 });
  });

  it("a REGI chamber's wall is shut until its story opens it: DESERT RUINS' with A", () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const r = room as unknown as { tellStory(n: number, ring: unknown, s: unknown, rng: () => number): void };
    const at = { map: 'MAP_DESERT_RUINS', x: 8, y: 21 };
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: at, facing: 2 });
    room.step();
    const a = room.actor(1000)!;
    a.calm = 0;
    // No story: the chamber is shut, as the match's is.
    expect(room.stepFor(a)(at, 2)).toBeNull();
    r.tellStory(0, { ...room.ring(), r: Infinity, phase: 2 }, STORIES.find((s) => s.id === 'desert-ruins'), () => 0.5);
    expect(room.stepFor(a)(at, 2)).toBeNull();
    // Its REGIROCK stands inside as an event's legendary does.
    expect(room.spillAt('MAP_DESERT_RUINS', 8, 7)?.legend).toBe(true);
    expect(room.events[0].species).toBe(401);
    const evs = room.step(new Map([[1000, [KEY_A]]]));
    expect(evs).toContainEqual(expect.objectContaining({ type: 'door', id: 1000, how: 'smash', opened: true }));
    expect(room.stepFor(a)(at, 2)?.to).toEqual({ map: 'MAP_DESERT_RUINS', x: 8, y: 11 });
  });

  it("a gate's boss guards his story's pieces, and A at him is his own fight", () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const r = room as unknown as { tellStory(n: number, ring: unknown, s: unknown, rng: () => number): void };
    r.tellStory(0, { ...room.ring(), r: Infinity }, STORIES.find((s) => s.id === 'weather-institute'), () => 0.5);
    // SHELLY at (4,6) holds the CASTFORM; the supplies at (5,6) wait on her.
    const shelly = room.spillAt('MAP_ROUTE119_WEATHER_INSTITUTE_2F', 4, 6)!;
    expect(shelly.person).toMatchObject({ name: 'SHELLY', gate: 2 });
    expect(shelly.legend).toBeUndefined();
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_ROUTE119_WEATHER_INSTITUTE_2F', x: 5, y: 7 }, facing: 2 });
    room.step();
    const a = room.actor(1000)!;
    a.calm = 0;
    expect(room.step(new Map([[1000, [KEY_A]]]))).toContainEqual(expect.objectContaining({ type: 'guarded', name: 'SHELLY' }));
    a.m.spot = { map: 'MAP_ROUTE119_WEATHER_INSTITUTE_2F', x: 4, y: 7 };
    room.step(new Map([[1000, [0]]]));
    expect(room.step(new Map([[1000, [KEY_A]]]))).toContainEqual(expect.objectContaining({ type: 'gate', gate: 2, key: shelly.key }));
    expect(room.picked.get(shelly.key)).toBe(1000);
    expect(a.battling).toBe(true);
    // Left mid-fight: SHELLY stands for the next one.
    room.apply({ c: 'leave', id: 1000 });
    expect(room.picked.has(shelly.key)).toBe(false);
  });

  it("door-only outdoor places are anchored; SKY PILLAR's final ring waits for land near it", () => {
    const room = makeRoom(MAPS, PATCHES, 5);
    for (const id of ['MAP_MT_CHIMNEY', 'MAP_MT_PYRE_SUMMIT', 'MAP_SKY_PILLAR_TOP']) {
      expect(room.places.has(id)).toBe(false);
      expect(room.anchors.has(id)).toBe(true);
    }
    // The mainland walkers stand nowhere near Route 131: no seed centres a ring at sea.
    for (let seed = 0; seed < 40; seed++) expect(makeRoom(MAPS, PATCHES, seed).centre(0).final).toBeUndefined();
  });

  it("the ferry sails to a live island's story and back, and nowhere without one", () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const r = room as unknown as { tellStory(n: number, ring: unknown, s: unknown, rng: () => number): void };
    const harbor = { map: 'MAP_LILYCOVE_CITY_HARBOR', x: 8, y: 11 };
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: harbor, facing: 2 });
    room.step();
    const a = room.actor(1000)!;
    a.calm = 0;
    const slateport = { id: 'slateport', name: 'SLATEPORT CITY' };
    expect(room.step(new Map([[1000, [KEY_A]]]))).toContainEqual(expect.objectContaining({ type: 'ferry', to: [slateport] }));
    room.step(new Map([[1000, [0]]]));
    expect(room.maps.has('MAP_SOUTHERN_ISLAND_INTERIOR')).toBe(true);
    r.tellStory(0, { ...room.ring(), r: Infinity }, STORIES.find((s) => s.id === 'southern-island'), () => 0.5);
    expect(room.step(new Map([[1000, [KEY_A]]]))).toContainEqual(expect.objectContaining({ type: 'ferry', to: [slateport, { id: 'southern-island', name: 'SOUTHERN ISLAND' }] }));
    room.apply({ c: 'sail', id: 1000, to: 'southern-island' });
    expect(room.actor(1000)!.m.spot).toEqual({ map: 'MAP_SOUTHERN_ISLAND_EXTERIOR', x: 13, y: 22 });
    // The island is measured by the dock (the fog there is Lilycove's).
    expect(room.inFog(room.actor(1000)!.m.spot, { ...room.ring(), r: 1e6 })).toBe(false);
    // The sailor behind, facing him: home.
    room.actor(1000)!.m.facing = 1;
    room.step(new Map([[1000, [0]]]));
    expect(room.step(new Map([[1000, [KEY_A]]]))).toContainEqual(expect.objectContaining({ type: 'ferry', home: true }));
    room.apply({ c: 'sail', id: 1000, to: '' });
    expect(room.actor(1000)!.m.spot).toEqual(harbor);
  });

  it('a bot wears down: the fight its trainer reports leaves its HP, and nobody else can say so', () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_PETALBURG_CITY', x: 10, y: 22 }, facing: 1 });
    room.apply({ c: 'join', id: 1001, bot: false, name: 'C', skin: 0, spot: { map: 'MAP_PETALBURG_CITY', x: 12, y: 22 }, facing: 1 });
    room.apply({ c: 'join', id: 7, bot: true, name: 'BOT', skin: 0, spot: { map: 'MAP_PETALBURG_CITY', x: 11, y: 22 }, facing: 3 });
    const bot = room.actor(7)!;
    // Not before it has fought anybody.
    room.apply({ c: 'wear', id: 1000, bot: 7, hp: [0.5] });
    expect(bot.wear).toBeUndefined();
    // A at it: a fight, with A (room.ts's own fight start).
    room.actor(1000)!.m.spot = { map: 'MAP_PETALBURG_CITY', x: 10, y: 22 };
    room.actor(1000)!.m.facing = 4;
    room.actor(1000)!.calm = 0;
    room.step(new Map([[1000, [0]]]));
    const ev = room.step(new Map([[1000, [KEY_A]]])).find((e) => e.type === 'fight');
    expect(ev).toMatchObject({ id: 1000, foe: 7 });
    // Not from somebody it did not fight.
    room.apply({ c: 'wear', id: 1001, bot: 7, hp: [0.1] });
    expect(bot.wear).toBeUndefined();
    // A, out of it already (a loss puts the trainer out first): once.
    room.apply({ c: 'out', id: 1000 });
    room.apply({ c: 'wear', id: 1000, bot: 7, hp: [0.5, 0, 2] });
    expect(bot.wear).toEqual([0.5, 0, 1]);
    room.apply({ c: 'wear', id: 1000, bot: 7, hp: [1, 1, 1] });
    expect(bot.wear).toEqual([0.5, 0, 1]);
    // Its next team as dealt, with those wounds: a fainted slot stays down, a scratch keeps 1 HP.
    const team = [{ hp: 40, maxHp: 40 }, { hp: 30, maxHp: 30 }, { hp: 20, maxHp: 20 }, { hp: 10, maxHp: 10 }];
    expect(wornParty(team, bot.wear).map((m) => m.hp)).toEqual([20, 0, 20, 10]);
    expect(wornParty(team, [0.001]).map((m) => m.hp)[0]).toBe(1);
    expect(wornParty(team, undefined)).toBe(team);
  });

  it("a bot fights a trainer with its own bag: what the ROM says it spent is gone from it (POK-237)", () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_PETALBURG_CITY', x: 10, y: 22 }, facing: 4 });
    room.apply({ c: 'join', id: 7, bot: true, name: 'BOT', skin: 0, spot: { map: 'MAP_PETALBURG_CITY', x: 11, y: 22 }, facing: 3 });
    const bot = room.actor(7)!;
    bot.loot = { items: [{ id: 13, n: 2 }, { id: 22, n: 1 }], money: 0 };
    room.actor(1000)!.calm = 0;
    room.step(new Map([[1000, [0]]]));
    expect(room.step(new Map([[1000, [KEY_A]]])).find((e) => e.type === 'fight')).toMatchObject({ id: 1000, foe: 7 });
    room.apply({ c: 'wear', id: 1000, bot: 7, hp: [0.5], spent: [13, 22] });
    expect(bot.loot.items).toEqual([{ id: 13, n: 1 }]);
    // Once: a second report spends nothing more.
    room.apply({ c: 'wear', id: 1000, bot: 7, hp: [0.5], spent: [13] });
    expect(bot.loot.items).toEqual([{ id: 13, n: 1 }]);
    // Beaten: what it has left is what goes down.
    room.apply({ c: 'end', id: 1000, won: true });
    expect(room.spillAt('MAP_PETALBURG_CITY', 11, 22)!.bag.items).toContainEqual({ id: 13, n: 1 });
    expect(room.spillAt('MAP_PETALBURG_CITY', 11, 22)!.bag.items).not.toContainEqual({ id: 22, n: 1 });
  });

  it('a hurt bot walks to a CENTER and comes out whole (brain.ts HURT and healHere)', () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    (room as unknown as { opening: number }).opening = 0;
    // Oldale's CENTER door is (6,16); its doorstep is the cell below.
    expect(room.centreSteps()).toContainEqual({ map: 'MAP_OLDALE_TOWN', x: 6, y: 17 });
    room.apply({ c: 'join', id: 7, bot: true, name: 'BOT', skin: 0, spot: { map: 'MAP_OLDALE_TOWN', x: 10, y: 12 }, facing: 1 });
    const bot = room.actor(7)!;
    bot.calm = 1e9; // nobody to fight here, nothing but the walk
    const brain = { rng: 7, wait: 0, dir: 1 };
    const walk = (frames: number) => { for (let i = 0; i < frames && bot.wear; i++) { bot.keys = botKeys(room, bot, brain); room.step(); } };
    // Whole, or only scratched: no CENTER.
    bot.wear = [0.9, 0.8];
    walk(600);
    expect(bot.wear).toEqual([0.9, 0.8]);
    // Under half: there, and whole again.
    bot.wear = [0.2, 0];
    expect(health(bot)).toBeLessThan(HURT);
    walk(60 * 60);
    expect(bot.wear).toBeUndefined();
    expect(bot.m.spot).toEqual({ map: 'MAP_OLDALE_TOWN', x: 6, y: 17 });
  });

  it("the heal and a potion are the room's own: a copy that never runs the bots heals them on the same frame", () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    (room as unknown as { opening: number }).opening = 0;
    room.apply({ c: 'join', id: 7, bot: true, name: 'BOT', skin: 0, spot: { map: 'MAP_OLDALE_TOWN', x: 6, y: 17 }, facing: 1 });
    const bot = room.actor(7)!;
    bot.calm = 1e9;
    // On the doorstep with no brain at all (a page's copy): whole on the next frame.
    bot.wear = [0.1];
    room.step();
    expect(bot.wear).toBeUndefined();
    // Off it, hurt, with a POTION: within QUAFF_FRAMES it drinks it, the worst mon up 20 HP.
    bot.m = { ...bot.m, spot: { map: 'MAP_OLDALE_TOWN', x: 10, y: 12 } };
    bot.loot = { items: [{ id: 13, n: 1 }], money: 0 };
    bot.wear = [0.25, 1];
    for (let i = 0; i < 600 && bot.loot.items.length; i++) room.step();
    expect(bot.loot.items).toEqual([]);
    expect(bot.wear[0]).toBeGreaterThan(0.25);
    // Whole enough (over 60%): it keeps the next one.
    bot.loot = { items: [{ id: 13, n: 1 }], money: 0 };
    bot.wear = [0.7, 1];
    for (let i = 0; i < 700; i++) room.step();
    expect(bot.loot.items).toEqual([{ id: 13, n: 1 }]);
  });

  it('FLY off the MAP lands where the flight did: a town of the match, a cell to stand on, not out of the Zone', () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_PETALBURG_CITY', x: 10, y: 22 }, facing: 1 });
    const fly = (map: string, x: number, y: number) => { room.apply({ c: 'fly', id: 1000, to: { map, x, y } }); return { ...room.actor(1000)!.m.spot }; };
    // The Zone's gate is shut until the drop: no flying out of it.
    (room as unknown as { opening: number }).opening = 60 * 60;
    expect(room.ring().safari).toBeTruthy();
    expect(fly('MAP_PETALBURG_CITY', 20, 17)).toEqual({ map: 'MAP_PETALBURG_CITY', x: 10, y: 22 });
    (room as unknown as { opening: number }).opening = 0;
    expect(room.ring().safari).toBeFalsy();
    expect(fly('MAP_NOWHERE', 1, 1)).toEqual({ map: 'MAP_PETALBURG_CITY', x: 10, y: 22 });
    expect(fly('MAP_PETALBURG_CITY', 0, 0)).toEqual({ map: 'MAP_PETALBURG_CITY', x: 10, y: 22 }); // a wall
    expect(fly('MAP_PETALBURG_CITY', 20, 17)).toEqual({ map: 'MAP_PETALBURG_CITY', x: 20, y: 17 });
  });

  it('the SS TIDAL and MR. BRINEY run: each stop sails where its own menu does (br_boot.c)', () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const at = (map: string, x: number, y: number, facing: number) => {
      room.actor(1000)!.m.spot = { map, x, y };
      room.actor(1000)!.m.facing = facing;
      room.step(new Map([[1000, [0]]]));
      return room.step(new Map([[1000, [KEY_A]]])).find((e) => e.type === 'ferry');
    };
    const sail = (to: string) => { room.apply({ c: 'sail', id: 1000, to }); return { ...room.actor(1000)!.m.spot }; };
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_SLATEPORT_CITY_HARBOR', x: 8, y: 11 }, facing: 2 });
    room.step();
    room.actor(1000)!.calm = 0;
    // Slateport's attendant: Lilycove, and nowhere else (the FRONTIER is off the menu).
    expect(at('MAP_SLATEPORT_CITY_HARBOR', 8, 11, 2)).toMatchObject({ to: [{ id: 'lilycove', name: 'LILYCOVE CITY' }] });
    expect(sail('petalburg')).toEqual({ map: 'MAP_SLATEPORT_CITY_HARBOR', x: 8, y: 11 });
    // Aboard: the crossing is its own test.
    expect(sail('lilycove')).toEqual({ map: 'MAP_SS_TIDAL_CORRIDOR', x: 1, y: 10 });
    expect(room.actor(1000)!.cruise).toEqual({ to: 'lilycove', leg: 'board', steps: 0 });
    room.actor(1000)!.cruise = undefined;
    // ...and back, from Lilycove's.
    expect(at('MAP_LILYCOVE_CITY_HARBOR', 8, 11, 2)).toMatchObject({ to: [{ id: 'slateport' }] });
    expect(sail('slateport')).toEqual({ map: 'MAP_SS_TIDAL_CORRIDOR', x: 1, y: 10 });
    room.actor(1000)!.cruise = undefined;
    // MR. BRINEY in his cottage: Dewford; at Dewford: Petalburg or Slateport (the beach).
    expect(at('MAP_ROUTE104_MR_BRINEYS_HOUSE', 5, 4, 2)).toMatchObject({ briney: true, to: [{ id: 'dewford', name: 'DEWFORD' }] });
    expect(sail('dewford')).toEqual({ map: 'MAP_DEWFORD_TOWN', x: 11, y: 9 });
    expect(at('MAP_DEWFORD_TOWN', 11, 9, 4)).toMatchObject({ briney: true, to: [{ id: 'petalburg' }, { id: 'beach', name: 'SLATEPORT' }] });
    expect(sail('beach')).toEqual({ map: 'MAP_ROUTE109', x: 20, y: 24 });
    expect(at('MAP_ROUTE109', 20, 24, 4)).toMatchObject({ briney: true, to: [{ id: 'dewford' }] });
    expect(sail('petalburg')).toEqual({ map: 'MAP_ROUTE109', x: 20, y: 24 }); // not from here
    expect(sail('dewford')).toEqual({ map: 'MAP_DEWFORD_TOWN', x: 11, y: 9 });
    room.actor(1000)!.m.facing = 4;
    expect(sail('petalburg')).toEqual({ map: 'MAP_ROUTE104_MR_BRINEYS_HOUSE', x: 5, y: 4 });
    // He stands solid, as any townsperson.
    expect(room.stepFor(room.actor(1000)!)({ map: 'MAP_ROUTE104_MR_BRINEYS_HOUSE', x: 5, y: 4 }, 2)).toBeNull();
  });

  it("the SS TIDAL's crossing: aboard until she makes land, by 205 steps one leg and the bed the other (SSTidalCorridor)", () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const me = () => room.actor(1000)!;
    const press = (facing: number) => {
      me().m.facing = facing;
      room.step(new Map([[1000, [0]]]));
      return room.step(new Map([[1000, [KEY_A]]])).filter((e) => e.type === 'cruise');
    };
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_SLATEPORT_CITY_HARBOR', x: 8, y: 11 }, facing: 2 });
    room.step();
    me().calm = 0;
    room.apply({ c: 'sail', id: 1000, to: 'lilycove' });
    // Boarded: she leaves port on the next frame, and says so.
    const left = room.step(new Map([[1000, [0]]])).filter((e) => e.type === 'cruise');
    expect(left).toMatchObject([{ say: 'board', cruise: { to: 'lilycove', leg: 'depart' } }]);
    expect(room.anchors.has('MAP_SS_TIDAL_CORRIDOR') && room.anchors.has('MAP_SS_TIDAL_ROOMS')).toBe(true);
    // The sailor by the way off: not yet. And the way off is shut: no step onto him.
    expect(press(1)).toMatchObject([{ say: 'sailor', cruise: { leg: 'depart' } }]);
    room.apply({ c: 'sail', id: 1000, to: 'lilycove' });
    expect(me().m.spot).toEqual({ map: 'MAP_SS_TIDAL_CORRIDOR', x: 1, y: 10 });
    // 205 steps out of Slateport: halfway, and the steps stop counting.
    let said: RoomEvent[] = [];
    const walk = (n: number) => {
      for (let i = 0; i < n; i++) {
        const dir = i % 2 ? KEY_LEFT : KEY_RIGHT;
        for (let f = 0; f < 40 && me().m.spot.x === (i % 2 ? 2 : 1); f++) said.push(...room.step(new Map([[1000, [dir]]])).filter((e) => e.type === 'cruise'));
        for (let f = 0; f < 20; f++) said.push(...room.step(new Map([[1000, [0]]])).filter((e) => e.type === 'cruise'));
      }
    };
    walk(204);
    expect(said).toEqual([]);
    expect(me().cruise).toMatchObject({ leg: 'depart', steps: 204 });
    walk(1);
    expect(said).toMatchObject([{ say: 'halfway', cruise: { leg: 'halfway', steps: 0 } }]);
    said = [];
    walk(300);
    expect(said).toEqual([]);
    // The bed in cabin No. 2: a rest, and she has made land in LILYCOVE.
    me().m.spot = { map: 'MAP_SS_TIDAL_ROOMS', x: 14, y: 11 };
    expect(press(4)).toMatchObject([{ say: 'land', bed: true, cruise: { to: 'lilycove', leg: 'land' } }]);
    // The sailor sees me off at Lilycove's harbour.
    me().m.spot = { map: 'MAP_SS_TIDAL_CORRIDOR', x: 1, y: 10 };
    expect(press(1)).toMatchObject([{ say: 'sailor', cruise: { leg: 'land' } }]);
    room.apply({ c: 'sail', id: 1000, to: 'slateport' }); // not where she landed
    expect(me().m.spot.map).toBe('MAP_SS_TIDAL_CORRIDOR');
    room.apply({ c: 'sail', id: 1000, to: 'lilycove' });
    expect(me().m.spot).toEqual({ map: 'MAP_LILYCOVE_CITY_HARBOR', x: 8, y: 11 });
    expect(me().cruise).toBeUndefined();

    // Out of Lilycove: no steps count until a rest, which is only halfway; then either
    // 205 steps or a second rest makes SLATEPORT.
    me().m.facing = 2;
    room.apply({ c: 'sail', id: 1000, to: 'slateport' });
    room.step(new Map([[1000, [0]]]));
    said = [];
    walk(205);
    expect(me().cruise).toMatchObject({ to: 'slateport', leg: 'depart', steps: 0 });
    me().m.spot = { map: 'MAP_SS_TIDAL_ROOMS', x: 14, y: 12 };
    expect(press(4)).toMatchObject([{ say: 'halfway', bed: true, cruise: { leg: 'halfway' } }]);
    me().m.spot = { map: 'MAP_SS_TIDAL_CORRIDOR', x: 1, y: 10 };
    said = [];
    walk(205);
    expect(said).toMatchObject([{ say: 'land', cruise: { to: 'slateport', leg: 'land' } }]);
    me().m.spot = { map: 'MAP_SS_TIDAL_CORRIDOR', x: 1, y: 10 };
    press(1);
    room.apply({ c: 'sail', id: 1000, to: 'slateport' });
    expect(me().m.spot).toEqual({ map: 'MAP_SLATEPORT_CITY_HARBOR', x: 8, y: 11 });
  });

  it("the CABLE CAR: each station's attendant rides it up or down, landing past her (Route112_CableCarStation)", () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const at = (map: string) => {
      room.actor(1000)!.m.spot = { map, x: 6, y: 7 };
      room.actor(1000)!.m.facing = 2;
      room.step(new Map([[1000, [0]]]));
      return room.step(new Map([[1000, [KEY_A]]])).find((e) => e.type === 'ferry');
    };
    const sail = (to: string) => { room.apply({ c: 'sail', id: 1000, to }); return { ...room.actor(1000)!.m.spot, facing: room.actor(1000)!.m.facing }; };
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_ROUTE112_CABLE_CAR_STATION', x: 6, y: 7 }, facing: 2 });
    room.step();
    room.actor(1000)!.calm = 0;
    expect(at('MAP_ROUTE112_CABLE_CAR_STATION')).toMatchObject({ cable: 'up', to: [{ id: 'chimney', name: 'MT. CHIMNEY' }] });
    expect(sail('route112')).toMatchObject({ map: 'MAP_ROUTE112_CABLE_CAR_STATION', x: 6, y: 7 }); // not from here
    expect(sail('chimney')).toEqual({ map: 'MAP_MT_CHIMNEY_CABLE_CAR_STATION', x: 6, y: 7, facing: 1 });
    expect(at('MAP_MT_CHIMNEY_CABLE_CAR_STATION')).toMatchObject({ cable: 'down', to: [{ id: 'route112' }] });
    expect(sail('route112')).toEqual({ map: 'MAP_ROUTE112_CABLE_CAR_STATION', x: 6, y: 7, facing: 1 });
    // Both stations are in the world, and she stands solid.
    expect(room.anchors.has('MAP_MT_CHIMNEY_CABLE_CAR_STATION') && room.anchors.has('MAP_ROUTE112_CABLE_CAR_STATION')).toBe(true);
    expect(room.stepFor(room.actor(1000)!)({ map: 'MAP_ROUTE112_CABLE_CAR_STATION', x: 6, y: 7 }, 2)).toBeNull();
  });

  it("ISLAND CAVE's wall opens by itself a phase on; ANCIENT TOMB's for the page that saw a flier", () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const r = room as unknown as { tellStory(n: number, ring: unknown, s: unknown, rng: () => number): void };
    const ring = room.ring();
    r.tellStory(0, { ...ring, r: Infinity }, STORIES.find((s) => s.id === 'island-cave'), () => 0.5);
    r.tellStory(1, { ...ring, r: Infinity }, STORIES.find((s) => s.id === 'ancient-tomb'), () => 0.5);
    const tomb = { map: 'MAP_ANCIENT_TOMB', x: 8, y: 21 };
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: tomb, facing: 2 });
    room.step();
    room.actor(1000)!.calm = 0;
    expect(room.step(new Map([[1000, [KEY_A]]]))).toContainEqual(expect.objectContaining({ type: 'door', how: 'fly' }));
    expect(room.events[1].opened).toBe(false);
    room.apply({ c: 'open', id: 1000, n: 1 });
    expect(room.events[1].opened).toBe(true);
    expect(room.events[0].opened).toBe(false);
    while (room.ring().phase === ring.phase) room.step();
    expect(room.events[0].opened).toBe(true);
  });

  it('the ground has the odd LINK CABLE and POKe DOLL, as the map balls do (BrBalls_Deal)', () => {
    const g = [...makeRoom(MAPS, PATCHES, 4242).ground().values()].filter((b) => !b.gift);
    const n = (item: number) => g.filter((b) => b.item === item).length;
    expect(n(ITEM_LINK_CABLE)).toBeGreaterThan(0);
    expect(n(ITEM_POKE_DOLL)).toBeGreaterThan(0);
    expect(n(ITEM_LINK_CABLE)).toBeLessThan(g.length / 6);
  });

  it('somebody is home in one house in eight, and the big floors trade; a giver gives once', () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const homes = room.homes;
    expect(homes.some((h) => !h.gives)).toBe(true);
    for (const h of homes) expect(room.traderAt(h.map, h.x, h.y)?.n).toBe(h.n);
    // The same seed deals the same people; a state carries them.
    expect(makeRoom(MAPS, PATCHES, 4242).homes).toEqual(homes);
    const h = homes[0];
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: h.map, x: h.x, y: h.y + 1 }, facing: 2 });
    for (let i = 0; i < 2; i++) room.step(new Map([[2, [i ? KEY_A : 0]]]));
    expect(h.busy).toBe(2);
    room.apply({ c: 'traded', id: 2, n: h.n, given: 25 });
    expect(h.busy).toBe(0);
    if (h.gives) expect(room.traderAt(h.map, h.x, h.y)).toBeUndefined();
    else expect(h.species).toBe(25);
  });

  it('a gift-giver stands in every town and city, holding one held item', () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const gifts = [...room.ground().values()].filter((b) => b.gift);
    const towns = [...new Set([...room.ground().values()].map((b) => b.map))].filter((m) => /_(TOWN|CITY)$/.test(m));
    expect(towns.length).toBeGreaterThan(0);
    expect(gifts.map((b) => b.map).sort()).toEqual(towns.sort());
    for (const b of gifts) expect(GIFTS).toContain(b.item);
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
    // a ball that would not go in the bag is put back by its taker, and only by them
    const back = makeRoom(MAPS, PATCHES, 4242);
    back.load(room.state());
    back.apply({ c: 'drop', id: 2, key: b.key });
    expect(back.groundAt(b.map, b.x, b.y)).toBeUndefined();
    back.apply({ c: 'drop', id: 1, key: b.key });
    expect(back.groundAt(b.map, b.x, b.y)).toEqual(b);
    // The same anywhere in Hoenn, not only on the maps walkable from Littleroot: a trainer
    // dropped in Mauville takes the ball beside them.
    const far = makeRoom(MAPS, PATCHES, 4242);
    const m = [...far.ground().values()].find((q) => q.map === 'MAP_MAUVILLE_CITY' && far.world.cell(q.map, q.x - 1, q.y) === 0 && !far.groundAt(q.map, q.x - 1, q.y))!;
    expect(m, 'a ball in Mauville with ground west of it').toBeTruthy();
    far.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: m.map, x: m.x - 1, y: m.y }, facing: 4 });
    expect(far.step(new Map([[1, [KEY_A]]]))).toMatchObject([{ type: 'item', id: 1, key: m.key, item: m.item }]);
    // now the cell is open
    let walked = false;
    for (let i = 0; i < 40 && !walked; i++) { press(KEY_RIGHT); walked = room.actor(1)!.m.spot.x === b.x; }
    expect(walked).toBe(true);
  });
});

describe('the fog', () => {
  it('closes on a seeded centre phase by phase, then covers everything until somebody wins', () => {
    const room = makeRoom(MAPS, PATCHES, 31337), same = makeRoom(MAPS, PATCHES, 31337);
    const at = (p: number) => room.ring(p * RING_PHASE + 1);
    expect(at(0)).toMatchObject({ round: 0, phase: 0, r: Infinity, last: false });
    expect(at(0).left).toBe(RING_PHASE - 1);
    const radii = [1, 2, 3, 4, 5, 6, 7].map((p) => at(p).r);
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1]);
    expect(radii[5]).toBeGreaterThan(0);
    expect(radii[6]).toBe(SECTION_TILES / 2); // the centre's own section, as the match's 0
    expect(at(8)).toMatchObject({ phase: 8, r: -1, last: true });
    // The fog everywhere holds (director.ts stops its ring there): no lifting on a timer.
    expect(at(40)).toMatchObject({ round: 0, phase: 8, r: -1, last: true, left: 0 });
    expect(same.ring(3 * RING_PHASE)).toEqual(room.ring(3 * RING_PHASE));
    expect(room.centre(1).cx !== room.centre(0).cx || room.centre(1).cy !== room.centre(0).cy).toBe(true); // a new round, a new centre
    // the centre is a cell a trainer can stand on, and is never in the fog before the end
    const centre = room.reachable().find((s) => !room.inFog(s, at(5)))!;
    expect(centre).toBeTruthy();
    const start = { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 };
    expect(room.inFog(start, at(0))).toBe(false);
    expect(room.inFog(start, at(8))).toBe(true);
    // every reachable cell is clear in the announcement; most are fogged by the seventh phase
    const cells = room.reachable();
    expect(cells.filter((s) => room.inFog(s, at(0))).length).toBe(0);
    // ...and all but the centre's section by the seventh (Littleroot's walk is a few sections)
    expect(cells.filter((s) => room.inFog(s, at(7))).length / cells.length).toBeGreaterThan(0.8);
  });

  it('a trainer who is out leaves the map, and its bot walks again', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 1, bot: true, name: 'BOT', skin: 4, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 12 }, facing: 1 });
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 9, y: 12 }, facing: 4 });
    room.step(new Map([[2, [KEY_A]]]));
    expect(room.actor(1)!.battling).toBe(true);
    room.apply({ c: 'out', id: 2 });
    expect(room.actor(2)).toBeUndefined();
    expect(room.actor(1)!.battling).toBe(false);
  });
});

describe('a fallen trainer\'s bag', () => {
  const bag = { items: [{ id: 13, n: 3 }, { id: 4, n: 6 }], money: 1200 };
  const mon = (species: number) => ({ species, level: 5 });

  it('never shuts a door: off a doormat or a door, beside it (Cam 10-31)', () => {
    const world = makeRoom(MAPS, PATCHES, 99).world;
    // A Centre's mat (just walked in), Oldale's Centre door (just walked out).
    for (const at of [{ map: 'MAP_OLDALE_TOWN_POKEMON_CENTER_1F', x: 7, y: 8 }, { map: 'MAP_OLDALE_TOWN', x: 6, y: 16 }]) {
      expect(world.warpAt(at.map, at.x, at.y), `${at.map} is a door`).toBeTruthy();
      const room = makeRoom(MAPS, PATCHES, 99);
      room.apply({ c: 'join', id: 1, bot: false, name: 'MAY', skin: 0, spot: at, facing: 1 });
      room.apply({ c: 'out', id: 1, bag });
      const b = room.spills.get(SPILL_KEY + 1)!;
      expect(b, at.map).toMatchObject({ map: at.map, name: 'MAY', bag });
      expect(world.warpAt(b.map, b.x, b.y), `${at.map}: not on a door`).toBeUndefined();
      expect(Math.abs(b.x - at.x) + Math.abs(b.y - at.y), `${at.map}: beside it`).toBe(1);
    }
  });

  it('lies where they fell; solid; A takes it whole, and what did not fit goes back', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    const at = { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 12 };
    room.apply({ c: 'join', id: 1, bot: false, name: 'MAY', skin: 0, spot: at, facing: 1 });
    room.apply({ c: 'join', id: 2, bot: false, name: 'B', skin: 0, spot: { ...at, x: 9 }, facing: 4 });
    room.apply({ c: 'out', id: 1, bag });
    expect(room.actor(1)).toBeUndefined();
    const key = SPILL_KEY + 1;
    expect(room.spillAt(at.map, at.x, at.y)).toMatchObject({ key, name: 'MAY', bag });
    expect(room.stepFor(room.actor(2)!)({ ...at, x: 9 }, 4)).toBeNull(); // solid
    // mirrored like everything else
    const mirror = makeRoom(MAPS, PATCHES, 99);
    mirror.load(room.state());
    expect(mirror.hash()).toBe(room.hash());
    expect(room.step(new Map([[2, [KEY_A]]]))).toMatchObject([{ type: 'bag', id: 2, key, bag, name: 'MAY' }]);
    expect(room.spillAt(at.map, at.x, at.y)).toBeUndefined();
    room.step(new Map([[2, [0]]]));
    expect(room.step(new Map([[2, [KEY_A]]]))).toEqual([]);
    // the potions would not fit: back down with only them, and only by the taker
    room.apply({ c: 'drop', id: 3, key, rest: { items: [{ id: 13, n: 3 }], money: 0 } });
    expect(room.spillAt(at.map, at.x, at.y)).toBeUndefined();
    room.apply({ c: 'drop', id: 2, key, rest: { items: [{ id: 13, n: 3 }], money: 0 } });
    expect(room.spillAt(at.map, at.x, at.y)?.bag).toEqual({ items: [{ id: 13, n: 3 }], money: 0 });
    mirror.load(room.state());
    expect(mirror.hash()).toBe(room.hash());
  });

  it('holds the team too: a bag of only mons lies, and goes back with whoever was left in it', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    const at = { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 12 };
    room.apply({ c: 'join', id: 1, bot: false, name: 'MAY', skin: 0, spot: at, facing: 1 });
    room.apply({ c: 'join', id: 2, bot: false, name: 'B', skin: 0, spot: { ...at, x: 9 }, facing: 4 });
    room.apply({ c: 'out', id: 1, bag: { items: [], money: 0, mons: [mon(1), mon(2)] } });
    const key = SPILL_KEY + 1;
    expect(room.spillAt(at.map, at.x, at.y)?.bag.mons).toEqual([mon(1), mon(2)]);
    const before = room.hash();
    expect(room.step(new Map([[2, [KEY_A]]]))).toMatchObject([{ type: 'bag', key, bag: { mons: [mon(1), mon(2)] } }]);
    // one of theirs taken, one of B's put down in its place
    room.apply({ c: 'drop', id: 2, key, rest: { items: [], money: 0, mons: [mon(2), mon(9)] } });
    expect(room.spillAt(at.map, at.x, at.y)?.bag.mons).toEqual([mon(2), mon(9)]);
    expect(room.hash()).not.toBe(before);
    const mirror = makeRoom(MAPS, PATCHES, 99);
    mirror.load(room.state());
    expect(mirror.hash()).toBe(room.hash());
  });

  it('an empty bag leaves nothing, and leaving (not out) leaves nothing', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 12 }, facing: 1 });
    room.apply({ c: 'join', id: 2, bot: false, name: 'B', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 9, y: 12 }, facing: 1 });
    room.apply({ c: 'out', id: 1, bag: { items: [], money: 0 } });
    room.apply({ c: 'leave', id: 2 });
    expect([...room.spills.values()].filter((s) => s.map !== CHEST.map)).toEqual([]); // the DAY CARE's chest is the room's
  });

  it('what a phone sends is made safe, and a bag put back never grows', () => {
    expect(cleanBag(null)).toBeNull();
    expect(cleanBag({ items: 'x' })).toBeNull();
    expect(cleanBag({ items: Array(93).fill({ id: 1, n: 1 }) })).toBeNull();
    // not an item, none, not a whole number, a key item, a machine: out; a berry stack to 999
    expect(cleanBag({ items: [{ id: 13, n: 3 }, { id: 999, n: 1 }, { id: 4, n: 0 }, { id: 2.5, n: 1 }, { id: 261, n: 1 }, { id: 289, n: 1 }, { id: 133, n: 1500 }], money: 5e9 }))
      .toEqual({ items: [{ id: 13, n: 3 }, { id: 133, n: 999 }], money: 999999 });
    expect(within({ items: [{ id: 13, n: 9 }, { id: 4, n: 2 }, { id: 7, n: 1 }], money: 9999 }, bag))
      .toEqual({ items: [{ id: 13, n: 3 }, { id: 4, n: 2 }], money: 1200 });
    // a team: up to six, each a real species at a real level
    expect(cleanBag({ items: [], money: 0, mons: [mon(1)] })).toEqual({ items: [], money: 0, mons: [mon(1)] });
    expect(cleanBag({ items: [], money: 0, mons: Array(7).fill(mon(1)) })).toBeNull();
    expect(cleanBag({ items: [], money: 0, mons: [{ species: 412, level: 5 }] })).toBeNull();
    expect(cleanBag({ items: [], money: 0, mons: [{ species: 25, level: 101 }] })).toBeNull();
    expect(cleanBag({ items: [], money: 0, mons: [7] })).toBeNull();
    expect(cleanBag({ items: [], money: 0, mons: [{ species: 25, level: 5, extra: 1 }] })).toEqual({ items: [], money: 0, mons: [{ species: 25, level: 5 }] });
    expect(within({ items: [], money: 0, mons: [mon(3)] }, bag).mons).toEqual([mon(3)]);
  });
});

describe('rounds', () => {
  it('who is on the map when the fog closes plays it, bots too; the last one standing wins; soon after, everybody is back at the truck', () => {
    // A cycle longer than AFTER_WIN, as the match's is.
    const PHASE = 200;
    const host = new Host(makeRoom(MAPS, PATCHES, 4242), 3, MAPS, 0);
    const mirror = makeRoom(MAPS, PATCHES, 4242);
    host.room.ringPhase = mirror.ringPhase = PHASE;
    mirror.load(host.room.state());
    // A bot that walks up to a trainer gets a fight their page here calls off at once.
    const run = (n: number) => {
      for (let i = 0; i < n; i++) {
        const { frame, events } = host.advance();
        play(mirror, frame);
        expect(mirror.hash()).toBe(host.room.hash());
        for (const e of events) if (e.type === 'fight') host.end(e.id);
      }
    };
    const bots = host.room.actors.filter((x) => x.bot).map((x) => x.id);
    expect(bots.length).toBeGreaterThan(0);
    const a = host.join('A', 0), b = host.join('B', 1), d = host.join('', 0);
    run(PHASE + 1); // into phase 1: the fog closes
    expect(host.room.ring().phase).toBe(1);
    expect(host.room.actor(d)!.name).toBe(`TRAINER ${d}`);
    expect(host.room.results.entrants.map(([id]) => id)).toEqual([...bots, a, b, d]);

    // A late joiner waits on the bench, its keys spent as they come.
    const c = host.join('C', 1);
    host.input(c, 1, Array(20).fill(KEY_UP));
    run(1);
    expect(host.room.actor(c)).toBeUndefined();
    expect(host.room.bench.map((x) => x.id)).toEqual([c]);
    expect(host.backlog(c)).toBe(0);

    // A goes out to B; D leaves.
    host.out(a, undefined, b);
    run(1);
    expect(host.room.results.fallen.find((f) => f.id === a)).toEqual({ id: a, name: 'A', by: 'B', at: expect.any(Number) });
    expect(host.room.bench.map((x) => x.id).sort()).toEqual([a, c].sort());
    host.leave(d);
    run(1);
    expect(host.room.results.fallen.find((f) => f.id === d)).toMatchObject({ left: true });

    // B beats a bot: out. The rest go to the fog as it closes on them; B, who does not
    // bleed in the room, is the last one standing.
    const bot = host.room.actors.find((x) => x.bot);
    if (bot) {
      const me = host.room.actor(b)!;
      me.battling = bot.battling = true; me.foe = bot.id;
      mirror.actor(b)!.battling = mirror.actor(bot.id)!.battling = true; mirror.actor(b)!.foe = bot.id;
      host.end(b, false, true);
      run(1);
      expect(host.room.results.fallen.find((f) => f.id === bot.id)).toMatchObject({ id: bot.id, name: bot.name, by: 'B', bot: true });
      expect(host.room.actor(bot.id)).toBeUndefined();
    }
    while (!host.room.results.winner) run(PHASE);
    expect(host.room.results.winner).toBe(b);
    expect(host.room.results.fallen.filter((f) => bots.includes(f.id)).length).toBe(bots.length);
    const won = host.room.results.wonAt!;
    expect(host.room.ring().round).toBe(0);

    // A phone that joins now mirrors the bench, the results and the round's start too.
    const late = makeRoom(MAPS, PATCHES, 4242);
    late.load(host.room.state());
    expect(late.hash()).toBe(host.room.hash());
    // AFTER_WIN on: A, B and C at the truck on three cells, nothing of the old round left.
    run(won + AFTER_WIN - host.room.tick);
    expect(host.room.ring()).toMatchObject({ round: 1, phase: 0 });
    expect(host.room.epoch).toBe(won + AFTER_WIN);
    expect(host.room.results).toEqual({ round: 1, entrants: [], fallen: [], winner: 0 });
    expect(host.room.bench).toEqual([]);
    // The bots all went out last round: none of them stands again.
    expect(host.room.actors.filter((x) => x.bot)).toEqual([]);
    const humans = host.room.actors.filter((x) => !x.bot);
    expect(humans.map((x) => x.id)).toEqual([a, b, c]);
    expect(new Set(humans.map((x) => `${x.m.spot.map}:${x.m.spot.x}:${x.m.spot.y}`)).size).toBe(3);
    for (const x of humans) expect(x.m.spot.map).toBe('MAP_LITTLEROOT_TOWN');
    // A whole phase of announcement, and the next fog closes on all of them.
    run(PHASE - 1);
    expect(host.room.ring().phase).toBe(0);
    host.input(c, 21, Array(10).fill(KEY_DOWN));
    run(2);
    expect(host.room.ring().phase).toBe(1);
    expect(host.room.results.entrants.map(([id]) => id)).toEqual([a, b, c]);
  });

  it('one trainer alone never wins, and two out on one frame leave no winner', () => {
    const room = makeRoom(MAPS, PATCHES, 5);
    room.ringPhase = 10;
    for (const [id, x] of [[1, 9], [2, 10], [3, 11]]) room.apply({ c: 'join', id, bot: false, name: `P${id}`, skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x, y: 10 }, facing: 1 });
    for (let i = 0; i < 11; i++) room.step();
    room.apply({ c: 'out', id: 1, wild: true });
    room.step();
    expect(room.results.fallen[0]).toMatchObject({ id: 1, name: 'P1', by: '', wild: true });
    expect(room.results.winner).toBe(0);
    room.apply({ c: 'out', id: 2 });
    room.apply({ c: 'out', id: 3 });
    room.step();
    expect(room.results.fallen.length).toBe(3);
    expect(room.results.winner).toBe(0);

    const solo = makeRoom(MAPS, PATCHES, 5);
    solo.ringPhase = 10;
    solo.apply({ c: 'join', id: 1, bot: false, name: 'P1', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, facing: 1 });
    for (let i = 0; i < 11; i++) solo.step();
    expect(solo.results.entrants).toEqual([[1, 'P1']]);
    solo.apply({ c: 'out', id: 1 });
    solo.step();
    expect(solo.results.winner).toBe(0);
  });
});

describe('a match from a room', () => {
  it('START locks it to everybody at the truck, and it is over when one is left', () => {
    const host = new Host(makeRoom(MAPS, PATCHES, 11), 3, MAPS);
    const a = host.join('ALICE', 0, undefined, 1000);
    const b = host.join('BOB', 0, undefined, 1001);
    host.lock();
    host.advance();
    const room = host.room;
    expect(room.results.entrants.map(([id]) => id).sort((x, y) => x - y)).toEqual([1, 2, 3, a, b]);
    expect(over(room)).toBe(false);
    // Later than START: on the bench, not in it.
    const c = host.join('CARA', 0, undefined, 1002);
    host.advance();
    expect(room.bench.map((x) => x.id)).toEqual([c]);
    expect(room.results.entrants.some(([id]) => id === c)).toBe(false);
    // One trainer out: still on (the bots and BOB play on).
    host.out(a);
    host.advance();
    expect(over(room)).toBe(false);
    // The last trainer out: the bots play it out, and the trainers watch (HBR-96).
    host.out(b);
    host.advance();
    expect(room.results.winner).toBe(0);
    expect(over(room)).toBe(false);
    // ...judged by the out trainers' pages, which still answer the bots' fights.
    const round = room.results.round;
    let frames = 1;
    while (!over(room) && frames < 200_000) {
      for (const e of host.advance().events) if (e.type === 'bots') host.bots(e.id, e.a, e.b, e.a);
      frames++;
    }
    expect(frames).toBeGreaterThan(60);
    expect(room.results.winner || room.ring().round > round).toBeTruthy();
  });
});

describe("the ring's size", () => {
  it("is the live match's, in sections of SECTION_TILES: the fit of the maps to region_map_sections.json", () => {
    const room = makeRoom(MAPS, PATCHES, 11);
    const S = new Map(sectionsJson.map_sections.flatMap((s) => (s.x === undefined ? [] : [[s.id, { x: s.x, y: s.y!, width: s.width!, height: s.height! }] as const])));
    const fit = (pick: (m: WorldMap, p: { gx: number; gy: number }, s: { x: number; y: number; width: number; height: number }) => [number, number]) => {
      let n = 0, su = 0, sv = 0, suu = 0, suv = 0;
      for (const [id, p] of room.places) {
        const m = room.maps.get(id)!, s = S.get(m.section);
        if (!s || !m.outdoor) continue;
        const [u, v] = pick(m, p, s);
        n++; su += u; sv += v; suu += u * u; suv += u * v;
      }
      return (n * suv - su * sv) / (n * suu - su * su);
    };
    const kx = fit((m, p, s) => [s.x + s.width / 2, p.gx + m.w / 2]), ky = fit((m, p, s) => [s.y + s.height / 2, p.gy + m.h / 2]);
    expect(Math.abs(kx - SECTION_TILES)).toBeLessThan(1);
    expect(Math.abs(ky - SECTION_TILES)).toBeLessThan(1);
    // Each phase's radius, as live's RING_RADII after the announcement.
    room.ringPhase = 60;
    const r = (phase: number) => room.ring(phase * 60).r;
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(r)).toEqual([Infinity, 15 * 27, 9 * 27, 7 * 27, 5 * 27, 3 * 27, 2 * 27, 13.5, -1]);
  });
});

describe('a bag in a bot\'s way', () => {
  it('gives the bot its items and money; the Pokémon stay in it, and the bot steps over', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    const L = 'MAP_LITTLEROOT_TOWN';
    room.apply({ c: 'join', id: 1, bot: true, name: 'BOT', skin: 4, spot: { map: L, x: 10, y: 12 }, facing: 4 });
    room.spills.set(SPILL_KEY + 50, { key: SPILL_KEY + 50, map: L, x: 11, y: 12, name: 'MAY', bag: { items: [{ id: 13, n: 2 }], money: 300, mons: [{ species: 25, level: 9 }] } });
    room.actor(1)!.calm = 0;
    for (let i = 0; i < 40; i++) { room.actor(1)!.keys = KEY_RIGHT | KEY_A; room.step(); }
    const bag = room.spillAt(L, 11, 12)!;
    expect(bag.bag).toEqual({ items: [], money: 0, mons: [{ species: 25, level: 9 }] });
    expect(room.actor(1)!.loot).toEqual({ items: [{ id: 13, n: 2 }], money: 300 });
    expect(room.actor(1)!.m.spot.x).toBeGreaterThan(11);
    // A new round's bag starts empty of the old round's pickings (review of batch 12).
    (room as unknown as { newRound(n: number): void }).newRound(1);
    expect(room.actor(1)!.loot).toBeUndefined();
  });
});

describe('Cam 10-30', () => {
  it("the Zone's bots walk about it, and a trainer cannot fight one there", () => {
    const r = makeRoom(MAPS, PATCHES, 7);
    r.ringPhase = 120 * 60; r.opening = 60 * 60;
    const host = new Host(r, 7, MAPS, 0);
    const me = host.join('ME', 0, undefined, 1000);
    host.lock();
    host.advance();
    const where = () => r.actors.filter((a) => a.bot).map((a) => `${a.m.spot.map}:${a.m.spot.x},${a.m.spot.y}`);
    const first = where();
    expect(first.every((s) => s.startsWith(SAFARI))).toBe(true);
    for (let f = 0; f < 60 * 20; f++) { host.input(me, f + 1, [0]); host.advance(); }
    expect(where().filter((s, i) => s !== first[i]).length).toBeGreaterThan(3);
    // Facing one, A starts nothing.
    const bot = r.actors.find((a) => a.bot && !a.m.action)!;
    const m = r.actor(me)!;
    const s = bot.m.spot;
    r.actors = r.actors.filter((a) => a.id === me || a.id === bot.id || a.m.spot.map !== s.map || Math.abs(a.m.spot.x - s.x - 1) + Math.abs(a.m.spot.y - s.y) > 0);
    m.m = { ...m.m, spot: { map: s.map, x: s.x + 1, y: s.y }, facing: 3, moveDir: 3, action: null };
    const events = r.step(new Map([[me, [KEY_A]]]));
    expect(events.filter((e) => e.type === 'fight')).toEqual([]);
    expect(m.battling).toBe(false);
  });

  it('with five or more left the bots still go about and meet, a MAX 8 match not standing still', () => {
    const r = makeRoom(MAPS, PATCHES, 7);
    r.ringPhase = 120 * 60; r.opening = 60 * 60;
    const host = new Host(r, 7, MAPS, 0);
    const me = host.join('ME', 0, undefined, 1000);
    host.lock();
    let pend: [number, number, number][] = [];
    const fights: number[] = [];
    for (let f = 0; f < 60 * 60 * 6; f++) {
      host.input(me, f + 1, [0]);
      for (const [a, b] of pend.filter(([, , at]) => f >= at)) host.bots(me, a, b, a);
      pend = pend.filter(([, , at]) => f < at);
      for (const e of host.advance().events) {
        if (e.type === 'bots') { pend.push([e.a, e.b, f + 600]); fights.push(f); }
        if (e.type === 'fight') host.end(me);
      }
    }
    // Seed 7 had three bot fights in the first two minutes and none for the next five.
    expect(fights.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < fights.length; i++) expect(fights[i] - fights[i - 1]).toBeLessThan(60 * 120);
  });
});

describe('the last three', () => {
  it('hunt each other, picking up the bags and balls in their way, to a champion', () => {
    // Seed 99 left its last two standing apart behind an item ball until the fog took one.
    for (const seed of [99, 4242]) {
      const host = new Host(makeRoom(MAPS, PATCHES, seed), 7, MAPS, 0);
      host.room.ringPhase = 120 * 60;
      const me = host.join('ME', 0, undefined, 1000);
      host.lock();
      let pend: [number, number, number][] = [];
      let three = 0;
      for (let f = 0; f < 60 * 60 * 20 && !over(host.room); f++) {
        if (f === 3600) host.out(me);
        host.input(me, f + 1, [0]);
        for (const [a, b] of pend.filter(([, , at]) => f >= at)) host.bots(me, a, b, a);
        pend = pend.filter(([, , at]) => f < at);
        for (const e of host.advance().events) if (e.type === 'bots') pend.push([e.a, e.b, f + 600]);
        const r = host.room.results;
        if (!three && r.entrants.length - r.fallen.length <= 3) three = f;
      }
      const r = host.room.results;
      expect(over(host.room)).toBe(true);
      expect(r.winner).toBeGreaterThan(0);
      const last = r.fallen.filter((x) => (x.at ?? 0) > three);
      expect(last.length).toBe(2);
      expect(last.every((x) => x.by)).toBe(true);
      expect(last[1].at! - three).toBeLessThan(60 * 90);
    }
  });
});

describe('doors', () => {
  const O = 'MAP_OLDALE_TOWN', PC = 'MAP_OLDALE_TOWN_POKEMON_CENTER_1F';
  const walk = (room: ReturnType<typeof makeRoom>, id: number, bits: number, n: number) => {
    const out: ReturnType<typeof room.step> = [];
    for (let i = 0; i < n; i++) out.push(...room.step(new Map([[id, [bits]]])));
    return out;
  };

  it('in at the door, through a fade, out by the mat; the nurse across the counter', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: O, x: 6, y: 17 }, facing: 2 });
    const a = room.actor(1)!;
    room.step(new Map([[1, [KEY_UP]]]));
    expect(a.m.spot).toEqual({ map: PC, x: 7, y: 8 });
    expect(a.m.action?.kind).toBe('warp');
    walk(room, 1, 0, 40);
    // up to the counter, and A: the nurse
    walk(room, 1, KEY_UP, 80);
    expect(a.m.spot).toEqual({ map: PC, x: 7, y: 4 });
    walk(room, 1, 0, 40); // the bump into the counter plays out
    expect(room.step(new Map([[1, [KEY_A]]]))).toMatchObject([{ type: 'nurse', id: 1, map: PC }]);
    walk(room, 1, 0, 2);
    // down to the mat, and down once more: out, on the door
    for (let i = 0; i < 200 && a.m.spot.map === PC; i++) walk(room, 1, KEY_DOWN, 1);
    expect(a.m.spot).toEqual({ map: O, x: 6, y: 16 });
    expect(a.m.action?.kind).toBe('warp');
  });

  it('the fog inside is the fog at the door; a closed door stays shut; bots stay outside', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    expect(room.anchors.get(PC)).toEqual({ gx: room.places.get(O)!.gx + 6.5, gy: room.places.get(O)!.gy + 16.5 });
    expect(room.anchors.has('MAP_OLDALE_TOWN_POKEMON_CENTER_2F')).toBe(true); // up the stairs, the same door
    expect(room.anchors.has('MAP_LITTLEROOT_TOWN_PROFESSOR_BIRCHS_LAB')).toBe(false);
    for (let phase = 1; phase < 8; phase++) {
      room.tick = phase * room.ringPhase + 1;
      expect(room.inFog({ map: PC, x: 3, y: 3 })).toBe(room.inFog({ map: O, x: 6, y: 16 }));
    }
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 7, y: 17 }, facing: 2 });
    walk(room, 1, KEY_UP, 40);
    expect(room.actor(1)!.m.spot).toEqual({ map: 'MAP_LITTLEROOT_TOWN', x: 7, y: 17 });
    room.apply({ c: 'join', id: 2, bot: true, name: 'BOT', skin: 4, spot: { map: O, x: 6, y: 17 }, facing: 2 });
    expect(room.stepFor(room.actor(2)!)({ map: O, x: 6, y: 17 }, 2)).toBeNull();
  });
});

describe('events', () => {
  it('every other ring from the first shrink drops a legendary, two rares, three gold balls and supplies; A on the legendary is its battle', () => {
    const room = makeRoom(MAPS, PATCHES, 8);
    // The legendary's cluster, not a story told in its place (STORY_CHANCE).
    (room as unknown as { storyFor(): undefined }).storyFor = () => undefined;
    room.ringPhase = 60;
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, facing: 1 });
    for (let i = 0; i < 60; i++) room.step(new Map());
    expect(room.events).toHaveLength(1);
    const e = room.events[0];
    expect([401, 402, 403]).toContain(e.species);
    const pieces = [...room.spills.values()].filter((b) => b.key >= eventPiece(0, 0) && b.key < eventPiece(1, 0));
    expect(pieces).toHaveLength(7);
    expect(pieces[0]).toMatchObject({ legend: true, map: e.map, x: e.x, y: e.y, bag: { mons: [{ species: e.species, level: 15 }] } });
    expect(pieces.slice(3, 6).every((b) => b.bag.items.length === 1)).toBe(true);
    expect(room.inFog({ map: e.map, x: e.x, y: e.y })).toBe(false);
    // Phase 2 drops none; phase 3 the second, a LATI.
    for (let i = 0; i < 120; i++) room.step(new Map());
    expect(room.events.map((v) => v.n)).toEqual([0, 1]);
    expect([407, 408]).toContain(room.events[1].species);
    // A at it: its battle, and it is off the ground until it goes back.
    const me = room.actor(2)!;
    me.calm = 1e9;
    me.m = { ...me.m, spot: { map: e.map, x: e.x, y: e.y + 1 }, prev: { map: e.map, x: e.x, y: e.y + 1 }, facing: 2, moveDir: 2, action: null };
    expect(room.step(new Map([[2, [KEY_A]]]))).toMatchObject([{ type: 'legend', id: 2, key: e.key, species: e.species }]);
    expect(room.spillAt(e.map, e.x, e.y)).toBeUndefined();
    room.apply({ c: 'drop', id: 2, key: e.key });
    expect(room.spillAt(e.map, e.x, e.y)?.legend).toBe(true);
    room.apply({ c: 'end', id: 2 });
    // Taken again, and the trainer leaves mid-battle: back on the ground.
    for (let i = 0; i < 3; i++) room.step(new Map());
    me.calm = 1e9;
    room.step(new Map([[2, [0]]]));
    expect(room.step(new Map([[2, [KEY_A]]]))).toMatchObject([{ type: 'legend' }]);
    room.apply({ c: 'leave', id: 2 });
    expect(room.spillAt(e.map, e.x, e.y)?.legend).toBe(true);
  });
});

describe('event traders', () => {
  it('stand past the pieces with a rare the event did not drop; one trade at a time; he keeps what he is given', () => {
    const room = makeRoom(MAPS, PATCHES, 5);
    room.ringPhase = 60;
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, facing: 1 });
    room.apply({ c: 'join', id: 3, bot: false, name: 'B', skin: 0, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 11, y: 10 }, facing: 1 });
    for (let i = 0; i < 60; i++) room.step(new Map());
    const e = room.events[0];
    const t = e.trader!;
    expect(t).toBeDefined();
    const dropped = [...room.spills.values()].flatMap((b) => b.bag.mons ?? []).map((m) => m.species);
    expect(dropped).not.toContain(t.species);
    expect(room.spillAt(e.map, t.x, t.y)).toBeUndefined();
    const put = (id: number, dy: number) => { const a = room.actor(id)!; a.calm = 1e9; a.m = { ...a.m, spot: { map: e.map, x: t.x, y: t.y + dy }, prev: { map: e.map, x: t.x, y: t.y + dy }, facing: dy > 0 ? 2 : 1, moveDir: dy > 0 ? 2 : 1, action: null }; };
    put(2, 1);
    put(3, -1);
    expect(room.step(new Map([[2, [KEY_A]], [3, [KEY_A]]]))).toMatchObject([{ type: 'trade', id: 2, n: 0, species: t.species }]);
    room.apply({ c: 'traded', id: 3, n: 0, given: 25 }); // not his to say
    expect(t.busy).toBe(2);
    room.apply({ c: 'traded', id: 2, n: 0, given: 277 });
    expect([t.busy, t.species, room.actor(2)!.battling]).toEqual([0, 277, false]);
    room.step(new Map([[3, [0]]]));
    expect(room.step(new Map([[3, [KEY_A]]]))).toMatchObject([{ type: 'trade', id: 3, species: 277 }]);
    room.apply({ c: 'leave', id: 3 });
    expect(t.busy).toBe(0);
  });
});

describe('marts', () => {
  it('A at a clerk, or across the counter at one, opens the MART; nobody walks onto a clerk', () => {
    const room = makeRoom(MAPS, PATCHES, 7);
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: 'MAP_OLDALE_TOWN_MART', x: 3, y: 3 }, facing: 3 });
    room.apply({ c: 'join', id: 3, bot: false, name: 'B', skin: 0, spot: { map: 'MAP_LILYCOVE_CITY_DEPARTMENT_STORE_2F', x: 7, y: 4 }, facing: 1 });
    expect(room.step(new Map([[2, [KEY_A]], [3, [KEY_A]]]))).toMatchObject([
      { type: 'mart', id: 2, map: 'MAP_OLDALE_TOWN_MART' },
      { type: 'mart', id: 3, map: 'MAP_LILYCOVE_CITY_DEPARTMENT_STORE_2F' },
    ]);
    // Facing away: nothing.
    room.actor(2)!.m.facing = 4;
    expect(room.step(new Map([[2, [0]]]))).toEqual([]);
    expect(room.step(new Map([[2, [KEY_A]]]))).toEqual([]);
    expect(room.stepFor(room.actor(2)!)({ map: 'MAP_OLDALE_TOWN_MART', x: 1, y: 2 }, 1)).toBeNull();
  });
});

describe('the Safari opening', () => {
  it('opens every round in the Zone with no fighting; the fly map drops each where they chose, or anywhere', () => {
    const room = makeRoom(MAPS, PATCHES, 11);
    room.ringPhase = room.opening = 600;
    for (const id of [1, 2, 3]) {
      const at = room.truck(id);
      expect(at.length).toBe(8);
      expect(at.every((s) => s.map.startsWith(SAFARI))).toBe(true);
      room.apply({ c: 'join', id, bot: false, name: 'ABC'[id - 1], skin: 0, spot: at[0], facing: 1 });
    }
    room.apply({ c: 'pick', id: 2, map: 'MAP_SAFARI_ZONE_NORTH' }); // not a drop
    expect(room.actor(2)!.m.spot.map.startsWith(SAFARI)).toBe(true);
    expect(room.ring().safari).toBe(true);
    // Side by side, looking at each other: no fight in the Zone.
    const [a, b] = [room.actor(1)!, room.actor(2)!];
    a.calm = b.calm = 0;
    b.m = { ...b.m, spot: { ...a.m.spot, x: a.m.spot.x + 1 }, prev: { ...a.m.spot, x: a.m.spot.x + 1 }, facing: 3, moveDir: 3 };
    a.m.facing = a.m.moveDir = 4;
    let fights = 0;
    for (let i = 0; i < 300; i++) fights += room.step(new Map()).filter((e) => e.type === 'fight' || e.type === 'duel').length;
    // Out of balls before the end: C's fly map comes up now, and drops C at once.
    room.apply({ c: 'pick', id: 3, map: 'MAP_ROUTE101' });
    expect(room.actor(3)!.m.spot.map).toBe('MAP_ROUTE101');
    for (let i = 0; i < 299; i++) fights += room.step(new Map()).filter((e) => e.type === 'fight' || e.type === 'duel').length;
    expect(room.ring().safari).toBe(true);
    room.step(new Map());
    expect(room.ring().safari).toBeFalsy();
    expect(room.ring()).toMatchObject({ phase: 0, r: Infinity });
    // The Safari is over, the fly map is up: everybody waits in the Zone, still not fighting.
    for (let i = 0; i < 60; i++) fights += room.step(new Map()).filter((e) => e.type === 'fight' || e.type === 'duel').length;
    expect(fights).toBe(0);
    expect(a.m.spot.map.startsWith(SAFARI)).toBe(true);
    room.apply({ c: 'pick', id: 1, map: 'MAP_FORTREE_CITY' });
    expect(a.m.spot.map).toBe('MAP_FORTREE_CITY');
    // B never chose: dropped anywhere once the fly map's time is up.
    for (let i = 0; i < PICK_WAIT - 62; i++) room.step(new Map());
    expect(b.m.spot.map.startsWith(SAFARI)).toBe(true);
    room.step(new Map());
    room.step(new Map());
    expect(b.m.spot.map.startsWith(SAFARI)).toBe(false);
  });
});

describe('where the Safari opens (HBR-109)', () => {
  it("deals each trainer one of the live Zone's 24 cells from the seed and the seat, bots too, and drops the bots at the buzzer", () => {
    const first = (seed: number, id: number) => {
      const room = makeRoom(MAPS, PATCHES, seed);
      room.ringPhase = room.opening = 600;
      return room.zone(id)[0];
    };
    // Same seed and seat, same cell; another seed, mostly another area of the Zone.
    expect(first(5, 1)).toEqual(first(5, 1));
    const areas = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => first(seed, 1).map));
    expect(areas.size).toBeGreaterThan(2);
    // On (or right by) a live cell.
    const c = first(5, 1);
    expect(SAFARI_CELLS.some((s) => s.map === c.map && Math.abs(s.x - c.x) + Math.abs(s.y - c.y) <= 2)).toBe(true);

    const room = makeRoom(MAPS, PATCHES, 9);
    room.ringPhase = room.opening = 300;
    const host = new Host(room, 12, MAPS, 0);
    const me = host.join('ME', 0);
    host.advance();
    const bots = room.actors.filter((a) => a.bot);
    expect(bots.length).toBe(12);
    expect(room.actors.every((a) => a.m.spot.map.startsWith(SAFARI))).toBe(true);
    // Nobody on anybody else's cell.
    expect(new Set(room.actors.map((a) => `${a.m.spot.map}:${a.m.spot.x}:${a.m.spot.y}`)).size).toBe(13);
    while (room.ring().safari) host.advance();
    // The buzzer: the bots are out over Hoenn at once; I wait on my fly map.
    expect(bots.every((a) => !a.m.spot.map.startsWith(SAFARI))).toBe(true);
    expect(room.actor(me)!.m.spot.map.startsWith(SAFARI)).toBe(true);
  });
});

describe('the drop after the Safari (Cam 2026-10-29)', () => {
  it('waits out a battle fought in the Zone before dropping anywhere, and never onto a walled-in pocket', () => {
    const room = makeRoom(MAPS, PATCHES, 21);
    room.ringPhase = 6000;
    room.opening = 300;
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: room.truck(1)[0], facing: 1 });
    const a = room.actor(1)!;
    while (room.ring().safari) room.step(new Map());
    // A battle that runs past the fly map's time: still in the Zone after it.
    a.battling = true;
    for (let i = 0; i < PICK_WAIT + 600; i++) room.step(new Map());
    expect(a.m.spot.map.startsWith(SAFARI)).toBe(true);
    a.battling = false;
    // Then the fly map's whole time again, and the drop.
    for (let i = 0; i < PICK_WAIT - 10; i++) room.step(new Map());
    expect(a.m.spot.map.startsWith(SAFARI)).toBe(true);
    for (let i = 0; i < 20; i++) room.step(new Map());
    expect(a.m.spot.map.startsWith(SAFARI)).toBe(false);
    expect(room.landing().has(`${a.m.spot.map}:${a.m.spot.x}:${a.m.spot.y}`)).toBe(true);
    // The bank behind the ABANDONED SHIP (ROUTE 108) is no landing; the mainland is.
    const land = room.landing();
    expect([...land].some((k) => k.startsWith('MAP_ROUTE108:'))).toBe(false);
    expect(land.has('MAP_LITTLEROOT_TOWN:10:10')).toBe(true);
    // Exact under one-way ledges: from every landing cell (a sample) the walk reaches at
    // least 200 cells; from every outdoor cell left out, it never does and comes back.
    const walk = (k: string) => {
      const [map, x, y] = k.split(':');
      const seen = new Set([k]), queue: { map: string; x: number; y: number; z?: number }[] = [{ map, x: +x, y: +y }];
      while (queue.length && seen.size < 400) {
        const at = queue.pop()!;
        for (let dir = 1; dir <= 4; dir++) {
          const r = (room as unknown as { base: (s: typeof at, d: number) => { to: typeof at } | null }).base(at, dir);
          if (!r || !room.places.has(r.to.map) || r.to.map.startsWith(SAFARI)) continue;
          const kk = `${r.to.map}:${r.to.x}:${r.to.y}:${r.to.z ?? ''}`;
          if (!seen.has(kk)) { seen.add(kk); queue.push(r.to); }
        }
      }
      return seen.size;
    };
    const cells = [...land];
    for (let i = 0; i < cells.length; i += 97) expect(walk(cells[i])).toBeGreaterThanOrEqual(200);
  });
});

describe('gym leaders', () => {
  it('A at a leader is their battle; the first to beat them closes the gym, and they leave it', () => {
    const room = makeRoom(MAPS, PATCHES, 7);
    const G = 'MAP_RUSTBORO_CITY_GYM';
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: G, x: 5, y: 3 }, facing: 2 });
    room.apply({ c: 'join', id: 3, bot: false, name: 'B', skin: 0, spot: { map: G, x: 4, y: 2 }, facing: 4 });
    expect(room.stepFor(room.actor(2)!)({ map: G, x: 5, y: 3 }, 2)).toBeNull();
    // Both at once: both fight ROXANNE, each in their own ROM.
    expect(room.step(new Map([[2, [KEY_A]], [3, [KEY_A]]]))).toMatchObject([{ type: 'boss', id: 2, n: 0 }, { type: 'boss', id: 3, n: 0 }]);
    room.apply({ c: 'end', id: 3 }); // B lost or ran
    room.apply({ c: 'end', id: 2, won: true });
    expect(room.gyms).toEqual([[0, 'A']]);
    expect(room.bossDown(0)).toBe(true);
    expect(room.actor(2)!.battling).toBe(false);
    // Gone: nothing to talk to, and the cell is open.
    room.step(new Map([[3, [0]]]));
    expect(room.step(new Map([[3, [KEY_A]]]))).toEqual([]);
    expect(room.stepFor(room.actor(2)!)({ map: G, x: 5, y: 3 }, 2)).not.toBeNull();
    expect(makeRoom(MAPS, PATCHES, 7).hash()).not.toBe(room.hash());
    const copy = makeRoom(MAPS, PATCHES, 7);
    copy.load(room.state());
    expect(copy.hash()).toBe(room.hash());
  });
});

describe('field moves', () => {
  it('a team that could SURF walks onto water, at SURF pace; one that could not stays on the shore', () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    const R = 'MAP_ROUTE103';
    const m = MAPS.find((x) => x.id === R)!;
    let shore: { x: number; y: number } | null = null;
    for (let y = 0; y < m.h - 1 && !shore; y++) for (let x = 0; x < m.w && !shore; x++) {
      if (room.world.cell(R, x, y) === 0 && room.world.cell(R, x, y + 1) === 2 && room.world.cell(R, x, y + 2) === 2) shore = { x, y };
    }
    expect(shore).toBeTruthy();
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: R, ...shore! }, facing: 1 });
    const a = room.actor(1)!;
    const down = (n: number) => { for (let i = 0; i < n; i++) room.step(new Map([[1, [KEY_DOWN | KEY_B]]])); };
    down(40);
    expect(a.m.spot).toEqual({ map: R, ...shore! });
    room.apply({ c: 'field', id: 1, bits: FIELD_SURF });
    room.step(new Map([[1, [KEY_DOWN | KEY_B]]])); // B held: a walk on land, but SURF's pace on water
    expect(a.m.spot).toEqual({ map: R, x: shore!.x, y: shore!.y + 1 });
    expect(a.m.action).toMatchObject({ kind: 'step', speed: 2 });
    // a bot's field is its own business: it is not told
    room.apply({ c: 'join', id: 2, bot: true, name: 'B', skin: 4, spot: { map: R, x: 0, y: 0 }, facing: 1 });
    room.apply({ c: 'field', id: 2, bits: 7 });
    expect(room.actor(2)!.field).toBeUndefined();
  });
});

describe('no Safari', () => {
  it('START with SAFARI 0 drops each trainer somewhere of their own, not side by side at the truck', () => {
    const host = new Host(makeRoom(MAPS, PATCHES, 21), 0, MAPS, 0);
    const ids = [host.join('A', 0), host.join('B', 1), host.join('C', 2)];
    host.lock();
    host.advance();
    const at = ids.map((id) => host.room.actor(id)!.m.spot);
    expect(new Set(at.map((s) => s.map)).size).toBeGreaterThan(1);
    for (const s of at) expect(host.room.places.has(s.map)).toBe(true);
    // Five seconds of nobody moving: nobody has met anybody.
    for (let f = 0; f < 600; f++) expect(host.advance().events.filter((e) => e.type === 'duel')).toEqual([]);
  });
});

describe('after the last trainer is out', () => {
  const L = 'MAP_LITTLEROOT_TOWN';
  it("an out trainer's page still judges the bots' fights, so the bots play it out to a champion", () => {
    const room = makeRoom(MAPS, PATCHES, 99);
    room.apply({ c: 'join', id: 7, bot: false, name: 'A', skin: 0, spot: { map: L, x: 3, y: 3 }, facing: 1 });
    room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: { map: L, x: 9, y: 12 }, facing: 4 });
    room.apply({ c: 'join', id: 2, bot: true, name: 'TWO', skin: 5, spot: { map: L, x: 11, y: 12 }, facing: 3 });
    room.apply({ c: 'lock' });
    room.apply({ c: 'out', id: 7 });
    expect(room.bench.map((b) => b.id)).toEqual([7]);
    const events: ReturnType<typeof room.step> = [];
    for (let i = 0; i < 400 && !events.length; i++) events.push(...room.step(new Map()));
    expect(events).toMatchObject([{ type: 'bots', id: 7, a: 1, b: 2 }]);
    room.apply({ c: 'bots', id: 7, a: 1, b: 2, winner: 2 });
    room.step(new Map());
    expect(room.results.winner).toBe(2);
    // Gone for good (LEAVE, or the socket): nobody is left to judge, and a fight they
    // were running lets its bots go.
    const again = makeRoom(MAPS, PATCHES, 99);
    again.load({ ...room.state(), results: { round: 0, entrants: [], fallen: [], winner: 0 } });
    again.apply({ c: 'join', id: 3, bot: true, name: 'SIX', skin: 4, spot: { map: L, x: 9, y: 15 }, facing: 4 });
    again.apply({ c: 'join', id: 4, bot: true, name: 'TEN', skin: 5, spot: { map: L, x: 11, y: 15 }, facing: 3 });
    again.apply({ c: 'leave', id: 7 });
    for (let i = 0; i < 400; i++) expect(again.step(new Map()).filter((e) => e.type === 'bots')).toEqual([]);
  });

  it('a match of one trainer and seven bots, the trainer out at a minute, ends with a champion', () => {
    const host = new Host(makeRoom(MAPS, PATCHES, 4242), 7, MAPS, 0);
    host.room.ringPhase = 120 * 60;
    const me = host.join('ME', 0, undefined, 1000);
    host.lock();
    let pend: [number, number, number][] = [];
    let f = 0;
    for (; f < 60 * 60 * 20 && !over(host.room); f++) {
      if (f === 3600) host.out(me);
      host.input(me, f + 1, [0]);
      for (const [a, b] of pend.filter(([, , at]) => f >= at)) host.bots(me, a, b, a);
      pend = pend.filter(([, , at]) => f < at);
      for (const e of host.advance().events) {
        if (e.type === 'bots') pend.push([e.a, e.b, f + 600]);
        if (e.type === 'fight') host.end(me);
      }
    }
    expect(over(host.room)).toBe(true);
    expect(host.room.results.winner).toBeGreaterThan(0);
    expect(host.room.results.fallen.some((x) => x.bot && x.by)).toBe(true); // a bot beat a bot
  });
});

describe('the balls a match deals (br_balls.c)', () => {
  // Cam's 10-31 play: "no items in buildings" and "not enough TMs".
  it('puts a cache in most houses, on the table where br_balls.c lays it', () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const indoors = [...room.ground().values()].filter((b) => !room.places.has(b.map) && !b.gift && !b.map.startsWith(SAFARI));
    // br_balls.c's sRooms has 139 caches on this world's floors; 54 were dealt when a
    // table cell (class 1) turned one away.
    expect(indoors.length, `${indoors.length} balls indoors`).toBeGreaterThanOrEqual(120);
  });
  it('makes a quarter of the ground balls machines, as BR_BALLS_TM_IN is 4', () => {
    let tms = 0, all = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const room = makeRoom(MAPS, PATCHES, seed);
      for (const b of room.ground().values()) {
        if (!room.places.has(b.map) || b.gift || b.map.startsWith(SAFARI)) continue;
        all++;
        if (b.item >= 289 && b.item <= 346) tms++;
      }
    }
    expect(tms / all, `${tms} of ${all}`).toBeGreaterThan(0.2);
    expect(tms / all, `${tms} of ${all}`).toBeLessThan(0.32);
  });
});

describe('the Safari Zone loot (br_zone.c)', () => {
  it("six balls, one an area on br_zone.c's own cells, and about one match in eight has the MASTER BALL", () => {
    // The C's sSafariItemCells, by area: the room's cells are the ROM's, not a copy.
    const names: Record<string, string> = { 0: 'NORTHWEST', 1: 'NORTH', 12: 'NORTHEAST', 2: 'SOUTHWEST', 3: 'SOUTH', 13: 'SOUTHEAST' };
    const cells = [...zoneC.slice(zoneC.indexOf('sSafariItemCells')).matchAll(/\{\s*(\d+),\s*(\d+),\s*(\d+)\s*\}/g)].slice(0, 6).map((m) => `MAP_SAFARI_ZONE_${names[m[1]]}:${m[2]}:${m[3]}`);
    expect(ZONE_CELLS.map((c) => `${c.map}:${c.x}:${c.y}`)).toEqual(cells);
    let masters = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const ids = zoneBalls(seed);
      expect(ids).toHaveLength(6);
      for (const id of ids) expect(id === ITEM_MASTER_BALL || ZONE_ITEMS.includes(id) || ZONE_TMS.includes(id)).toBe(true);
      const m = ids.filter((id) => id === ITEM_MASTER_BALL).length;
      expect(m).toBeLessThanOrEqual(1);
      masters += m;
    }
    expect(masters).toBeGreaterThan(25);
    expect(masters).toBeLessThan(75);
    // On the room's ground, each where a trainer can stand to reach it.
    const room = makeRoom(MAPS, PATCHES, 7);
    expect(ZONE_CELLS.map((c) => room.groundAt(c.map, c.x, c.y)?.item)).toEqual(zoneBalls(7));
    // (plain ground or tall grass, the class-7 cell NORTHEAST's is: the ROM's own cells)
    for (const c of ZONE_CELLS) expect([0, 7], `${c.map} ${c.x},${c.y}`).toContain(room.world.cell(c.map, c.x, c.y));
  });

  it('the DAY CARE is a chest: one fully evolved POKeMON on its floor, the first one there takes it, every round', () => {
    const chest = [...zoneC.slice(zoneC.indexOf('sChest[]')).split('};')[0].matchAll(/SPECIES_([A-Z]+)/g)].map((m) => m[1]);
    expect(chest.length).toBe(CHEST_SPECIES.length);
    const room = makeRoom(MAPS, PATCHES, 4242);
    const s = room.spillAt(CHEST.map, CHEST.x, CHEST.y);
    expect(s?.bag.mons).toHaveLength(1);
    expect(CHEST_SPECIES).toContain(s!.bag.mons![0].species);
    // Level 0: the rung the match is at when somebody takes it (the page's).
    expect(s!.bag.mons![0].level).toBe(0);
    // Taken, it is gone for the round, and back in the next.
    room.apply({ c: 'join', id: 1000, bot: false, name: 'A', skin: 0, spot: { map: CHEST.map, x: CHEST.x, y: CHEST.y + 1 }, facing: 2 });
    const a = room.actor(1000)!;
    a.calm = 0;
    room.step(new Map([[1000, [0]]]));
    expect(room.step(new Map([[1000, [KEY_A]]]))).toContainEqual(expect.objectContaining({ id: 1000, key: s!.key }));
    expect(room.spillAt(CHEST.map, CHEST.x, CHEST.y)).toBeUndefined();
    (room as unknown as { newRound(n: number): void }).newRound(1);
    expect(room.spillAt(CHEST.map, CHEST.x, CHEST.y)?.bag.mons).toHaveLength(1);
  });
});

describe('the rod', () => {
  // Land with water north of it on ROUTE 103, and land south.
  const shore = (room: ReturnType<typeof makeRoom>) => {
    const map = 'MAP_ROUTE103';
    for (let y = 1; y < 40; y++) for (let x = 0; x < 80; x++) {
      if (room.world.cell(map, x, y) === 0 && room.world.cell(map, x, y - 1) === 2 && room.world.cell(map, x, y + 1) === 0) return { map, x, y };
    }
    throw new Error('no shore');
  };

  it('SELECT facing water casts it: the trainer stands fishing until the page ends it', () => {
    const room = makeRoom(MAPS, PATCHES, 5);
    const at = shore(room);
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: at, facing: 2 });
    const a = room.actor(1)!;
    expect(room.step(new Map([[1, [KEY_SELECT]]]))).toMatchObject([{ type: 'fish', id: 1, map: at.map, x: at.x, y: at.y - 1 }]);
    expect(a.battling).toBe(true);
    expect(a.m.bike).toBe(false);
    // held, or pressed again, it casts nothing more, and the trainer stays put
    expect(room.step(new Map([[1, [KEY_SELECT | KEY_DOWN]]]))).toEqual([]);
    expect(a.m.spot).toEqual(at);
    room.apply({ c: 'end', id: 1 });
    expect(a.battling).toBe(false);
  });

  it('facing land, SELECT is still the bike', () => {
    const room = makeRoom(MAPS, PATCHES, 5);
    const at = shore(room);
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: at, facing: 1 });
    expect(room.step(new Map([[1, [KEY_SELECT]]]))).toEqual([]);
    expect(room.actor(1)!.m.bike).toBe(true);
  });
});
