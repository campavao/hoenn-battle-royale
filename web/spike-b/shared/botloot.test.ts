// Bots on the field go and take things: balls in their normal walk, and a legendary, in a fight
// (Cam, 11-02, video 2 at 1:37: "the bots are not picking up the legendaries"), and a bag that
// falls never hides a piece (POK-388).
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { botKeys, type Brain } from './bots';
import { Host, play } from './host';
import type { BattleEvent } from './battlelog';
import { cleanEvents } from './logwire';
import { HOST_JUDGE, KEY_A, KEY_B, KEY_RIGHT, LEGEND_FOE, SPILL_KEY, botParty, makeRoom, type Room } from './room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const OLDALE = 'MAP_OLDALE_TOWN';
const KEY = 1 << 20;

function stage(simBots = true): Room {
  const room = makeRoom(MAPS, PATCHES, 4242);
  (room as unknown as { opening: number }).opening = 0;
  room.simBots = simBots;
  room.apply({ c: 'join', id: 7, bot: true, name: 'BOT', skin: 0, spot: { map: OLDALE, x: 10, y: 12 }, facing: 1 });
  room.actor(7)!.calm = 0;
  return room;
}

const legendAt = (room: Room, x: number, y: number) =>
  room.spills.set(KEY, { key: KEY, map: OLDALE, x, y, name: '', legend: true, bag: { items: [], money: 0, mons: [{ species: 404, level: 5 }] } });

const walk = (room: Room, brain: Brain, frames: number, until: () => boolean) => {
  const bot = room.actor(7)!;
  for (let i = 0; i < frames && !until(); i++) {
    bot.keys = bot.battling ? 0 : botKeys(room, bot, brain);
    room.step();
  }
};

/** Thinking until it means to go for what `wanted` says: it does one thought in four, here. */
function thinkOf(room: Room, brain: Brain, wanted: (s: { x: number; y: number }) => boolean): void {
  const bot = room.actor(7)!;
  for (let i = 0; i < 60 * 60 && !(brain.goal && wanted(brain.goal)); i++) {
    brain.goal = null;
    brain.steps = undefined;
    brain.plan = undefined;
    botKeys(room, bot, brain);
    room.step();
  }
  expect(brain.goal, 'it means to go').toBeTruthy();
}

describe('a bot on the field', () => {
  it('walks to a ball near it and takes it, on foot', () => {
    const room = stage();
    const bot = room.actor(7)!;
    const near = [...room.ground().values()].filter((g) => g.map === OLDALE && !g.gift);
    expect(near.length, 'a dealt ball in Oldale').toBeGreaterThan(0);
    const brain: Brain = { rng: 7, wait: 0, dir: 1 };
    let walking = true;
    thinkOf(room, brain, (s) => near.some((g) => g.x === s.x && g.y === s.y));
    walk(room, brain, 60 * 60, () => {
      if (bot.keys && !(bot.keys & KEY_B)) walking = false; // B held: the townsperson's walk
      return near.some((g) => room.picked.get(g.key) === 7);
    });
    expect(near.some((g) => room.picked.get(g.key) === 7)).toBe(true);
    expect(bot.loot?.items.length).toBeGreaterThan(0);
    expect(walking).toBe(true);
  });

  it('leaves a gift, and a bag with nothing but Pokemon in it, alone', () => {
    const room = stage();
    room.spills.set(KEY, { key: KEY, map: OLDALE, x: 12, y: 12, name: 'X', bag: { items: [], money: 0, mons: [{ species: 25, level: 5 }] } });
    for (const g of room.ground().values()) if (g.map === OLDALE) room.picked.set(g.key, 99);
    const brain: Brain = { rng: 7, wait: 0, dir: 1 };
    const bot = room.actor(7)!;
    bot.keys = botKeys(room, bot, brain);
    for (let i = 0; i < 120; i++) { bot.keys = botKeys(room, bot, brain); room.step(); }
    expect(brain.goal === undefined || brain.goal === null || brain.goal.x !== 12 || brain.goal.y !== 12).toBe(true);
    expect(room.spillAt(OLDALE, 12, 12)?.bag.mons?.length).toBe(1);
  });
});

describe('a bot at a legendary', () => {
  it('goes for one on its map, and pressing A starts a fight the host runs, off the ground meanwhile', () => {
    const room = stage();
    legendAt(room, 13, 12);
    for (const g of room.ground().values()) if (g.map === OLDALE) room.picked.set(g.key, 99);
    const brain: Brain = { rng: 7, wait: 0, dir: 1 };
    const bot = room.actor(7)!;
    const events: ReturnType<Room['step']> = [];
    thinkOf(room, brain, (s) => s.x === 13 && s.y === 12);
    for (let i = 0; i < 60 * 60 && !bot.battling; i++) { bot.keys = botKeys(room, bot, brain); events.push(...room.step()); }
    expect(events).toContainEqual(expect.objectContaining({ type: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, legend: { key: KEY, species: 404 } }));
    expect(bot).toMatchObject({ battling: true, foe: LEGEND_FOE, judge: HOST_JUDGE });
    expect(room.spillAt(OLDALE, 13, 12)).toBeUndefined();
  });

  it('no page free and no simulator: it waits, and the piece stays', () => {
    const room = stage(false);
    legendAt(room, 11, 12);
    room.actor(7)!.m.facing = 4;
    const bot = room.actor(7)!;
    bot.keys = 0;
    room.apply({ c: 'bots', id: 0, a: 7, b: LEGEND_FOE, winner: 7 });
    bot.keys = KEY_RIGHT | KEY_A | KEY_B;
    expect(room.step()).toEqual([]);
    expect(bot.battling).toBe(false);
    expect(room.spillAt(OLDALE, 11, 12)?.legend).toBe(true);
  });

  const atIt = (room: Room) => {
    legendAt(room, 11, 12);
    const bot = room.actor(7)!;
    (room as unknown as { botLegend(a: unknown, s: unknown, e: unknown[]): void }).botLegend(bot, room.spills.get(KEY), []);
    expect(bot.battling).toBe(true);
    return bot;
  };

  it('beaten, it is the bot\'s: first in its team, off the map for good, even when the bot falls', () => {
    const room = stage();
    const bot = atIt(room);
    room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: 7, hp: [0.25] });
    expect(bot.battling).toBe(false);
    expect(bot.caught).toEqual([404]);
    expect(botParty(room.seed, bot, 1)[0].species).toBe(404);
    expect(bot.wear).toEqual([0.5, 0.25]);
    expect(room.spillAt(OLDALE, 11, 12)).toBeUndefined();
    room.apply({ c: 'join', id: 8, bot: true, name: 'FOE', skin: 0, spot: { map: OLDALE, x: 3, y: 3 }, facing: 1 });
    (room as unknown as { botOut(a: unknown, by: string): void }).botOut(bot, 'FOE');
    expect(room.spillAt(OLDALE, 11, 12), 'not back on the ground').toBeUndefined();
    expect(room.spills.get(SPILL_KEY + 7)?.bag.mons?.[0].species).toBe(404);
  });

  it('lost, the bot gets away hurt, never tries that one again, and it stands as worn as it was left', () => {
    const room = stage();
    const bot = atIt(room);
    room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: LEGEND_FOE, hp: [0.6] });
    expect(room.actor(7)).toBeDefined();
    expect(bot.battling).toBe(false);
    expect(bot.wear?.every((w) => w === 0.15)).toBe(true);
    expect(bot.tried).toEqual([KEY]);
    expect(room.spillAt(OLDALE, 11, 12)).toMatchObject({ legend: true, worn: 0.6 });
    bot.calm = 0;
    bot.keys = KEY_RIGHT | KEY_A | KEY_B;
    expect(room.step()).toEqual([]);
    expect(bot.battling).toBe(false);
  });

  it('a new round starts it again: nothing caught, nothing tried', () => {
    const room = stage();
    const bot = atIt(room);
    room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: 7 });
    expect(bot.caught).toEqual([404]);
    (room as unknown as { newRound(n: number): void }).newRound(room.results.round + 1);
    expect(room.actor(7)?.caught).toBeUndefined();
    expect(room.actor(7)?.tried).toBeUndefined();
  });

  it('no answer: it stands, and the bot walks on', () => {
    const room = stage();
    const bot = atIt(room);
    room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: 0 });
    expect(bot.battling).toBe(false);
    expect(bot.wear).toBeUndefined();
    expect(room.spillAt(OLDALE, 11, 12)?.legend).toBe(true);
  });

  it('the host fights it and answers, and a mirror agrees', async () => {
    const room = stage();
    room.apply({ c: 'lock' });
    const host = new Host(room, 0, MAPS, 0);
    host.brains.set(7, { rng: 7, wait: 0, dir: 1 });
    await host.simReady();
    legendAt(room, 13, 12);
    for (const g of room.ground().values()) if (g.map === OLDALE) room.picked.set(g.key, 99);
    const mirror = makeRoom(MAPS, PATCHES, room.seed);
    mirror.load(structuredClone(room.state()));
    let answered = false;
    for (let i = 0; i < 60 * 60 * 11 && !answered; i++) {
      const { frame } = host.advance();
      play(mirror, frame);
      answered = !!frame.cmds?.some((c) => c.c === 'bots' && c.b === LEGEND_FOE);
    }
    expect(answered).toBe(true);
    expect(mirror.hash()).toBe(room.hash());
    expect(mirror.actor(7)?.caught).toEqual(room.actor(7)?.caught);
  });

  it('its log is one the relay keeps for a watcher: the legendary has a seat it can read', async () => {
    const room = stage();
    room.apply({ c: 'lock' });
    const logs: BattleEvent[][] = [];
    const host = new Host(room, 0, MAPS, 0, { onLog: (_seat, log) => logs.push(log) });
    host.brains.set(7, { rng: 7, wait: 0, dir: 1 });
    await host.simReady();
    legendAt(room, 13, 12);
    for (const g of room.ground().values()) if (g.map === OLDALE) room.picked.set(g.key, 99);
    for (let i = 0; i < 60 * 60 * 11 && !logs.length; i++) host.advance();
    expect(logs, 'the fight was worked out, once, for the bot alone').toHaveLength(1);
    // What WorldService.publishLog does with it first (logwire.ts): a seat and a winner are read
    // as non-negative, and a log whose `start` is dropped is refused whole.
    const kept = cleanEvents(logs[0]);
    expect(kept[0]?.e).toBe('start');
    expect(kept.at(-1)?.e).toBe('end');
    expect(kept.length).toBe(logs[0].length);
  });
});

describe('POK-388: a bag that falls', () => {
  it('lands beside a bag of Pokemon the bot stood on, not over it', () => {
    const room = stage();
    const other = { key: KEY, map: OLDALE, x: 10, y: 12, name: 'X', bag: { items: [], money: 0, mons: [{ species: 25, level: 5 }] } };
    room.spills.set(KEY, other);
    const bot = room.actor(7)!;
    room.apply({ c: 'join', id: 8, bot: true, name: 'FOE', skin: 0, spot: { map: OLDALE, x: 3, y: 3 }, facing: 1 });
    (room as unknown as { botOut(a: unknown, by: string): void }).botOut(bot, 'FOE');
    const fell = room.spills.get(SPILL_KEY + 7)!;
    expect([fell.x, fell.y]).not.toEqual([10, 12]);
    expect(room.spillAt(OLDALE, 10, 12)?.key).toBe(KEY);
    expect(Math.abs(fell.x - 10) + Math.abs(fell.y - 12)).toBe(1);
  });

  it('lands beside a legendary out being fought, which comes back to its cell', () => {
    const room = stage();
    room.apply({ c: 'join', id: 9, bot: true, name: 'NEAR', skin: 0, spot: { map: OLDALE, x: 10, y: 11 }, facing: 1 });
    legendAt(room, 10, 11);
    room.picked.set(KEY, 7);
    const near = room.actor(9)!;
    (room as unknown as { botOut(a: unknown, by: string): void }).botOut(near, 'FOE');
    const fell = room.spills.get(SPILL_KEY + 9)!;
    expect([fell.x, fell.y]).not.toEqual([10, 11]);
  });
});
