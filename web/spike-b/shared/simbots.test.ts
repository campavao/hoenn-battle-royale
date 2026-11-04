// Room.simBots: the host fights a bot meeting itself, off the room's step (battlesim.ts).
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { Host, play } from './host';
import { soloLink } from '../net';
import { WorldIndex } from '../../src/bots/hoenn';
import { eventMs, logMs, type BattleEvent } from './battlelog';
import { HOST_JUDGE, makeRoom, BOT_DUEL_GAP, type Room } from './room';
import { findPath } from '../../src/bots/path';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const L = 'MAP_LITTLEROOT_TOWN';

function stage(seed = 99, simBots = true): Room {
  const room = makeRoom(MAPS, PATCHES, seed);
  room.simBots = simBots;
  room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: { map: L, x: 9, y: 12 }, facing: 4 });
  room.apply({ c: 'join', id: 2, bot: true, name: 'TWO', skin: 5, spot: { map: L, x: 11, y: 12 }, facing: 3 });
  return room;
}

describe('Room.simBots', () => {
  it('a meeting needs no trainer, and is the host\'s', () => {
    const room = stage();
    const events: ReturnType<typeof room.step> = [];
    for (let i = 0; i < 400 && !events.length; i++) events.push(...room.step(new Map()));
    expect(events).toMatchObject([{ type: 'bots', id: HOST_JUDGE, a: 1, b: 2 }]);
    expect(room.actor(1)).toMatchObject({ battling: true, foe: 2, judge: HOST_JUDGE });
    // No page takes it: the event is nobody's, and `id` is no trainer's.
    expect(room.actor(HOST_JUDGE)).toBeUndefined();
  });

  it('any number of pairs fight at once, with no gap between them', () => {
    const room = stage();
    room.apply({ c: 'join', id: 3, bot: true, name: 'THREE', skin: 4, spot: { map: L, x: 9, y: 4 }, facing: 4 });
    room.apply({ c: 'join', id: 4, bot: true, name: 'FOUR', skin: 5, spot: { map: L, x: 11, y: 4 }, facing: 3 });
    const handed: number[] = [];
    for (let i = 0; i < 400; i++) for (const e of room.step(new Map())) if (e.type === 'bots') handed.push(room.tick);
    expect(handed.length).toBe(2);
    expect(handed[1] - handed[0]).toBeLessThan(BOT_DUEL_GAP);
    expect(room.duelAfter).toBe(0);
  });

  describe('two who meet, fight (Cam, 11-02: "Bots stand next to each other without fighting")', () => {
    const met = (room: Room, frames = 120) => {
      for (let i = 0; i < frames; i++) if (room.step(new Map()).some((e) => e.type === 'bots')) return true;
      return false;
    };
    const two = (a: { map: string; x: number; y: number }, fa: number, b: { map: string; x: number; y: number }, fb: number) => {
      const room = makeRoom(MAPS, PATCHES, 99);
      room.simBots = true;
      room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: a, facing: fa });
      room.apply({ c: 'join', id: 2, bot: true, name: 'TWO', skin: 5, spot: b, facing: fb });
      room.actor(1)!.calm = room.actor(2)!.calm = 0;
      return room;
    };

    it('side by side, whichever way they face', () => {
      const room = two({ map: L, x: 9, y: 12 }, 1, { map: L, x: 10, y: 12 }, 1);
      expect(met(room)).toBe(true);
      expect(room.actor(1)!.m.facing, 'they turn to each other').toBe(4);
      expect(room.actor(2)!.m.facing).toBe(3);
    });

    it('not two a cell apart with their backs turned', () => {
      expect(met(two({ map: L, x: 9, y: 12 }, 3, { map: L, x: 11, y: 12 }, 4))).toBe(false);
    });

    it('over a seam, which the page draws as one street', () => {
      // Littleroot's north edge is Route 101's south: y 0 there, y 19 here, the same x.
      const side = two({ map: L, x: 10, y: 0 }, 3, { map: 'MAP_ROUTE101', x: 10, y: 19 }, 3);
      expect(met(side)).toBe(true);
      expect(side.actor(1)!.m.facing).toBe(2);
      expect(side.actor(2)!.m.facing).toBe(1);
      const looks = two({ map: L, x: 10, y: 1 }, 2, { map: 'MAP_ROUTE101', x: 10, y: 18 }, 3);
      expect(met(looks), 'an eyeline two cells over the seam').toBe(true);
      expect(looks.actor(1)!.m.spot, 'and it walks up, over it').toEqual({ map: 'MAP_ROUTE101', x: 10, y: 19 });
      const away = two({ map: L, x: 10, y: 1 }, 1, { map: 'MAP_ROUTE101', x: 10, y: 18 }, 2);
      expect(met(away), 'and not with their backs to it').toBe(false);
    });

    /** Open ground: fifteen cells in a row, for a walk that nothing gets in the way of. */
    const street = (room: Room, map: string) => {
      const m = room.maps.get(map)!;
      for (let y = 0; y < m.h; y++) {
        for (let x = 0, run = 0; x < m.w; x++) {
          run = room.world.cell(map, x, y) === 0 ? run + 1 : 0;
          if (run === 15) return { y, x: x - 14 };
        }
      }
      throw new Error(`no street on ${map}`);
    };
    /** A bot on its way along a row, its steps laid out, as bots.ts walks a leg. One with no brain
     *  stands where it is. */
    const walking = (room: Room, host: Host, id: number, map: string, y: number, from: number, to: number) => {
      const ring = room.ring();
      const steps = findPath(room.world, { map, x: from, y }, { map, x: to, y }, 2000).steps;
      expect(steps.length).toBe(Math.abs(to - from));
      host.brains.set(id, { rng: 1, wait: 0, dir: 1, plan: `${ring.round}:${ring.phase}:${room.events.length}`, goal: { map, x: to, y }, steps });
    };

    it('a bot on the move, seen by one who stands: at the first step that brings it into sight', async () => {
      const R = 'MAP_ROUTE103';
      // Whichever frame it set off on, against the room's looks every eighth.
      for (let delay = 0; delay < 16; delay++) {
        const room = makeRoom(MAPS, PATCHES, 99);
        room.simBots = true;
        const { x, y } = street(room, R);
        room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: { map: R, x, y }, facing: 4 });
        room.apply({ c: 'join', id: 2, bot: true, name: 'TWO', skin: 5, spot: { map: R, x: x + 14, y }, facing: 3 });
        room.actor(1)!.calm = room.actor(2)!.calm = 0;
        const host = new Host(room, 0, MAPS, 0);
        room.apply({ c: 'lock' });
        for (let i = 0; i < delay; i++) host.advance();
        walking(room, host, 2, R, y, x + 14, x + 1);
        let at = -1;
        for (let i = 0; i < 600 && at < 0; i++) { host.advance(); if (room.actor(2)!.battling) at = room.actor(2)!.m.spot.x - x; }
        expect(at, `set off on frame ${delay}`).toBe(5);
        // The "!", and then it walks the rest, or the one who looked does.
        for (let i = 0; i < 300 && !room.actor(1)!.judge; i++) host.advance();
        expect(room.actor(1)!.judge, 'the fight').toBe(HOST_JUDGE);
        expect(Math.abs(room.actor(2)!.m.spot.x - room.actor(1)!.m.spot.x), 'beside each other').toBe(1);
      }
    });

    it('two on the move, however their steps fall', async () => {
      const R = 'MAP_ROUTE103';
      for (let delay = 0; delay < 16; delay++) {
        const room = makeRoom(MAPS, PATCHES, 99);
        room.simBots = true;
        const { x, y } = street(room, R);
        room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: { map: R, x, y }, facing: 4 });
        room.apply({ c: 'join', id: 2, bot: true, name: 'TWO', skin: 5, spot: { map: R, x: x + 14, y }, facing: 3 });
        room.actor(1)!.calm = room.actor(2)!.calm = 0;
        const host = new Host(room, 0, MAPS, 0);
        room.apply({ c: 'lock' });
        walking(room, host, 1, R, y, x, x + 14);
        for (let i = 0; i < delay; i++) host.advance();
        walking(room, host, 2, R, y, x + 14, x);
        let apart = -1;
        for (let i = 0; i < 600 && apart < 0; i++) { host.advance(); if (room.actor(1)!.battling) apart = room.actor(2)!.m.spot.x - room.actor(1)!.m.spot.x; }
        expect(apart, `the other set off on frame ${delay}`).toBeGreaterThanOrEqual(3);
      }
    });

    it('two walking, whose steps never end on one frame', () => {
      // Stood one eighth of a step out of time: each is still on a frame the other is not.
      const room = two({ map: L, x: 8, y: 12 }, 4, { map: L, x: 11, y: 12 }, 1);
      const a = room.actor(1)!, b = room.actor(2)!;
      expect(room.sightsWalker(a)).toBe(false);
      b.m.action = { kind: 'step', t: 3, len: 16, speed: 1, dir: 1 };
      expect(room.sightsWalker(a), 'it stands for the step').toBe(true);
      b.calm = room.tick + 100;
      expect(room.sightsWalker(a), 'not for one in its grace').toBe(false);
      b.calm = 0;
      room.simBots = false;
      expect(room.sightsWalker(a), 'and not when a page has to fight them, one at a time').toBe(false);
    });
  });

  it('a hunter does not go and stand by two in a fight', async () => {
    const room = stage();
    room.apply({ c: 'join', id: 3, bot: true, name: 'THREE', skin: 4, spot: { map: L, x: 11, y: 16 }, facing: 1 });
    const host = new Host(room, 0, MAPS, 0);
    host.brains.set(3, { rng: 1, wait: 0, dir: 1 });
    room.apply({ c: 'lock' });
    room.results.entrants = [[1, 'ONE'], [2, 'TWO'], [3, 'THREE']];
    // Stood in a fight of a page's, for all this test sees of it.
    const [one, two] = [room.actor(1)!, room.actor(2)!];
    one.battling = two.battling = true;
    one.foe = 2;
    two.foe = 1;
    one.judge = two.judge = 7;
    one.since = two.since = room.tick;
    let beside = 0, frames = 0;
    room.actor(3)!.calm = 0;
    for (let i = 0; i < 60 * 60; i++) {
      host.advance();
      const t = room.actor(3)!.m.spot;
      frames++;
      if (t.map === L && Math.min(Math.abs(t.x - one.m.spot.x) + Math.abs(t.y - one.m.spot.y), Math.abs(t.x - two.m.spot.x) + Math.abs(t.y - two.m.spot.y)) <= 1) beside++;
    }
    expect(beside / frames).toBeLessThan(0.2);
  }, 60_000);

  it('with the switch off, it is one page\'s, one at a time, as ever', () => {
    const room = stage(99, false);
    room.apply({ c: 'join', id: 3, bot: true, name: 'THREE', skin: 4, spot: { map: L, x: 9, y: 4 }, facing: 4 });
    room.apply({ c: 'join', id: 4, bot: true, name: 'FOUR', skin: 5, spot: { map: L, x: 11, y: 4 }, facing: 3 });
    for (let i = 0; i < 400; i++) expect(room.step(new Map())).toEqual([]);
    room.apply({ c: 'join', id: 7, bot: false, name: 'A', skin: 0, spot: { map: L, x: 3, y: 3 }, facing: 1 });
    const handed: { id: number }[] = [];
    for (let i = 0; i < 400; i++) handed.push(...room.step(new Map()).filter((e) => e.type === 'bots'));
    expect(handed).toMatchObject([{ id: 7 }]);
    expect(room.duelAfter).toBeGreaterThan(0);
    expect(room.state().simBots).toBeUndefined();
  });

  it('the host fights it, holds them for the log\'s length, and answers: a mirror agrees', async () => {
    const room = stage();
    const logs: [number, BattleEvent[]][] = [];
    const host = new Host(room, 0, MAPS, 0, { onLog: (seat, ev) => logs.push([seat, ev]) });
    await host.simReady();
    room.apply({ c: 'lock' });
    const mirror = makeRoom(MAPS, PATCHES, room.seed);
    mirror.load(structuredClone(room.state()));
    expect(mirror.simBots).toBe(true);
    let met = 0, answered = 0, frames = 0;
    while (!answered && frames++ < 60 * 60 * 11) {
      const { frame, events } = host.advance();
      play(mirror, frame);
      expect(mirror.tick).toBe(room.tick);
      if (events.some((e) => e.type === 'bots')) met = room.tick;
      if (frame.cmds?.some((c) => c.c === 'bots')) answered = room.tick;
    }
    expect(met).toBeGreaterThan(0);
    expect(logs.map(([seat]) => seat)).toEqual([1, 2]);
    const log = logs[0][1];
    expect(log.at(-1)?.e).toBe('end');
    const held = answered - met;
    // Its real time at sixty frames a second, a frame or two for the answer to land.
    expect(Math.abs(held - (logMs(log) / 1000) * 60)).toBeLessThan(4);
    expect(logs.length).toBe(2);
    // The winner walks, the loser is out with a bag (or nobody won, and both do).
    const winner = (log.at(-1) as { winner: number }).winner;
    if (winner) {
      expect(room.actor(winner)?.battling).toBe(false);
      expect(room.actor(winner === 1 ? 2 : 1)).toBeUndefined();
    } else {
      expect(room.actor(1)?.battling).toBe(false);
    }
    expect(mirror.hash()).toBe(room.hash());
  });

  it('a ring that closes on a fight under way reaches it (Cam, 11-03: "it starts hurting when the fog arrives")', async () => {
    const room = stage();
    const logs: BattleEvent[][] = [];
    const host = new Host(room, 0, MAPS, 0, { onLog: (seat, ev) => { if (seat === 1) logs.push(ev); } });
    await host.simReady();
    // Clear of the fog when they meet, and fogged eight seconds into the fight, by the room's own clock.
    const FOG_AT = 8 * 60;
    const real = room.ring.bind(room);
    room.ring = (tick = room.tick) => {
      const since = room.actor(1)?.battling ? room.actor(1)!.since : undefined;
      return { ...real(tick), r: since !== undefined && tick >= since + FOG_AT ? 0 : Infinity };
    };
    room.apply({ c: 'lock' });
    for (let frames = 0; !logs.length && frames < 60 * 60; frames++) host.advance();
    expect(logs).toHaveLength(1);
    let t = 0;
    const lines: number[] = [];
    for (const e of logs[0]) {
      if (e.e === 'text' && /is hurt by the fog!$/.test(e.text)) lines.push(t);
      t += eventMs(e);
    }
    expect(lines.length, 'it bit them').toBeGreaterThan(0);
    expect(lines[0], 'after it got there, not from the start').toBeGreaterThanOrEqual((FOG_AT / 60) * 1000);
  });

  it('a solo page: the log reaches its own watcher once, where the fight stands, and the bots stay busy for it', async () => {
    const link = soloLink(MAPS, PATCHES, new WorldIndex(MAPS).world, 99, { bots: 12, simBots: true, ringFrames: 7200, openingFrames: 0 });
    const room = link.room;
    await import('./battlesim');
    const heard: { from: number; f: number; events: BattleEvent[]; ago?: number }[] = [];
    link.onBattleLog = (from, f, events, ago) => heard.push({ from, f, events, ago });
    // Two bots: one on a marked spot has a fight too (bot-rules.test.ts).
    const fighters = () => room.actors.filter((a) => a.bot && a.judge && a.foe > 0);
    const step = () => { link.frame(0); };
    for (let i = 0; i < 60 * 600 && !fighters().length; i++) step();
    const a = fighters()[0];
    expect(a, 'bots met').toBeTruthy();
    const [ida, idb, since] = [a.id, a.foe, a.since!];
    link.watch(idb);
    for (let i = 0; i < 300 && !heard.length; i++) step();
    expect(heard, 'one fight, though the host says it for each seat').toHaveLength(1);
    expect(heard[0].ago).toBeCloseTo(Math.max(0, room.tick - since) * (1000 / 60), 3);
    expect(heard[0].events[0].e).toBe('start');
    const frames = Math.ceil((logMs(heard[0].events) / 1000) * 60);
    // A watcher who comes later is told how far in it is, and it is the same fight.
    while (room.tick < since + Math.floor(frames / 2)) step();
    link.watch(0);
    link.watch(ida);
    expect(heard).toHaveLength(2);
    expect(heard[1].f).toBe(heard[0].f);
    expect(heard[1].ago).toBeCloseTo((room.tick - since) * (1000 / 60), 3);
    // Busy until the log has played out, and not long after.
    while (room.tick < since + frames - 2) { expect(room.actor(ida)?.foe, 'held for the whole log').toBe(idb); step(); }
    for (let i = 0; i < 6; i++) step();
    expect(room.actor(ida)?.foe === idb && room.actor(ida)?.since === since).toBe(false);
  }, 60_000);

  it('runs the same fight for the same match', async () => {
    const fight = async () => {
      const room = stage(1234);
      const logs: BattleEvent[][] = [];
      const host = new Host(room, 0, MAPS, 0, { onLog: (_s, ev) => logs.push(ev) });
      await host.simReady();
      for (let i = 0; i < 400 && !logs.length; i++) host.advance();
      return logs[0];
    };
    expect(await fight()).toEqual(await fight());
  });

  it('an answer for a meeting the room has let go of is dropped', async () => {
    const room = stage();
    const logs: BattleEvent[][] = [];
    const host = new Host(room, 0, MAPS, 0, { onLog: (_s, ev) => logs.push(ev) });
    await host.simReady();
    for (let i = 0; i < 400 && !logs.length; i++) host.advance();
    expect(logs.length).toBe(2); // once for each seat
    // The round moves on under it.
    room.apply({ c: 'bots', id: HOST_JUDGE, a: 1, b: 2, winner: 0 });
    expect(room.actor(1)?.battling).toBe(false);
    for (let i = 0; i < 60; i++) {
      const { frame } = host.advance();
      expect(frame.cmds?.some((c) => c.c === 'bots') ?? false).toBe(false);
    }
  });
});
