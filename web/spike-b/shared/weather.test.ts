// POK-384: SOOTOPOLIS's weather and the legendaries, on the room: no KYOGRE in GROUDON's drought,
// one weather for both sides of a duel, and no first second without it.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { LEGENDS, WEATHER_DOWNPOUR, WEATHER_DROUGHT, legendOf } from '../../src/match/events';
import { STORIES } from '../../src/match/story';
import { makeRoom, type Room } from './room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const KYOGRE = 404, GROUDON = 405;
const CITY = 'MAP_SOOTOPOLIS_CITY';
const SOOTOPOLIS = STORIES.find((s) => s.id === 'sootopolis')!;
const SPOT = { map: CITY, x: 31, y: 30 };

const told = (room: Room, rng = () => 0.1) => (room as unknown as { tellStory(n: number, r: unknown, s: unknown, g: () => number): void }).tellStory(3, room.ring(), SOOTOPOLIS, rng);

describe('the clash', () => {
  it('the legendary is the weather\'s, whatever the dice, for an event and for the story', () => {
    const clash = LEGENDS.find((l) => l.includes(KYOGRE))!;
    for (const roll of [0, 0.5, 0.99]) {
      expect(legendOf(clash, 2, () => roll)).toBe(KYOGRE);
      expect(legendOf(clash, 3, () => roll)).toBe(GROUDON);
    }
    // Anything else, the dice as ever.
    expect(legendOf([1, 2], 2, () => 0.99)).toBe(2);
    for (const [seed, species] of [[6, KYOGRE], [7, GROUDON]]) {
      for (const roll of [0.1, 0.9]) {
        const room = makeRoom(MAPS, PATCHES, seed);
        told(room, () => roll);
        expect(room.spillAt(CITY, 31, 34)?.bag.mons?.[0].species).toBe(species);
      }
    }
  });

  it('the rain or the drought from the very frame the story drops, and only in the city', () => {
    const room = makeRoom(MAPS, PATCHES, 6);
    expect(room.weatherAt(SPOT)).toBe(0);
    told(room);
    expect(room.weatherAt(SPOT)).toBe(WEATHER_DOWNPOUR);
    expect(room.weatherAt({ map: 'MAP_ROUTE126', x: 5, y: 5 })).toBe(0);
    const dry = makeRoom(MAPS, PATCHES, 7);
    told(dry);
    expect(dry.weatherAt(SPOT)).toBe(WEATHER_DROUGHT);
  });

  it('a fight for its legendary is fought in it; caught, or put down elsewhere, it clears', () => {
    const room = makeRoom(MAPS, PATCHES, 6);
    told(room);
    const key = room.events[0].key;
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: CITY, x: 31, y: 33 }, facing: 1 });
    const a = room.actor(1)!;
    room.picked.set(key, 1);
    a.battling = true;
    expect(room.weatherAt(SPOT)).toBe(WEATHER_DOWNPOUR);
    a.battling = false;
    expect(room.weatherAt(SPOT)).toBe(0);
    room.picked.delete(key);
    expect(room.weatherAt(SPOT)).toBe(WEATHER_DOWNPOUR);
  });

  it('two trainers who meet there get one weather in their events, on the same frame, on either side', () => {
    const room = makeRoom(MAPS, PATCHES, 6);
    room.opening = 0;
    told(room);
    // A clear run of the street to see each other along.
    const m = MAPS.find((q) => q.id === CITY)!;
    let row: { x: number; y: number } | null = null;
    for (let y = 2; y < m.h - 2 && !row; y++) for (let x = 2; x < m.w - 6 && !row; x++) {
      if ([0, 1, 2, 3].every((d) => room.world.cell(CITY, x + d, y) === 0 && !room.world.warpAt(CITY, x + d, y) && !room.groundAt(CITY, x + d, y) && !room.spillAt(CITY, x + d, y))) row = { x, y };
    }
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: CITY, x: row!.x, y: row!.y }, facing: 1 });
    room.apply({ c: 'join', id: 2, bot: false, name: 'B', skin: 0, spot: { map: CITY, x: row!.x + 3, y: row!.y }, facing: 3 });
    const duels: { id: number; weather?: number }[] = [];
    for (let i = 0; i < 900 && !duels.length; i++) for (const e of room.step(new Map())) if (e.type === 'duel') duels.push(e);
    expect(duels.map((d) => d.weather)).toEqual([WEATHER_DOWNPOUR, WEATHER_DOWNPOUR]);
  });

  it('the whole Kyogre-or-Groudon event pool honours the seed, over many rounds', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const room = makeRoom(MAPS, PATCHES, seed);
      const n = LEGENDS.findIndex((l) => l.includes(KYOGRE));
      (room as unknown as { dropEvent(n: number, r: unknown): void }).dropEvent(n, room.ring());
      const legend = [...room.spills.values()].find((s) => s.legend)?.bag.mons?.[0].species;
      if (legend === KYOGRE || legend === GROUDON) expect(legend, `seed ${seed}`).toBe(seed & 1 ? GROUDON : KYOGRE);
    }
  }, 60_000);
});
