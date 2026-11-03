// Room.simBots: the host fights a bot meeting itself, off the room's step (battlesim.ts).
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { Host, play } from './host';
import { soloLink } from '../net';
import { WorldIndex } from '../../src/bots/hoenn';
import { logMs, type BattleEvent } from './battlelog';
import { HOST_JUDGE, makeRoom, BOT_DUEL_GAP, type Room } from './room';

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

  it('a solo page: the log reaches its own watcher once, where the fight stands, and the bots stay busy for it', async () => {
    const link = soloLink(MAPS, PATCHES, new WorldIndex(MAPS).world, 99, { bots: 12, simBots: true, ringFrames: 7200, openingFrames: 1 });
    const room = link.room;
    await import('./battlesim');
    const heard: { from: number; f: number; events: BattleEvent[]; ago?: number }[] = [];
    link.onBattleLog = (from, f, events, ago) => heard.push({ from, f, events, ago });
    const fighters = () => room.actors.filter((a) => a.bot && a.battling);
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
