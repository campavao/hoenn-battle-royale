// POK-438: indoor pickups on desks and tables, taken with A as any ball is. Cam, 10-19: "Instead of
// on the ground, this could sit on the desk." Then Cam painted every room's ball and person by hand
// (11-01, room-paint.json), and 11-22, of the table balls dealt beside his: "Yeah just use item
// spots that I had painted by hand." A painted room holds his ball and nothing else.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import roomsJson from '../data/rooms.json';
import tableBallsJson from '../data/table-balls.json';
import ballsC from '../../../src/br/br_balls.c?raw';
import paintJson from '../../../tools/br/room-paint.json';
import { KEY_A, makeRoom } from './room';
import { isTm } from './items';
import { GOLD } from '../../src/match/events';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const ROOMS = roomsJson as [string, number, number, boolean, boolean, number, number, boolean][];
const TABLE = tableBallsJson as unknown as [string, number, number][];
/** Cam's room painting (11-01): each room's first ball and its person, by hand. */
const PAINT = paintJson as unknown as Record<string, { item: [number, number] | null; person: [number, number] }>;
const room = makeRoom(MAPS, PATCHES, 4242);
const FACE_RIGHT = 4;

describe('balls in the rooms', () => {
  it('holds br_balls.c\'s table balls, and none in a painted room', () => {
    const body = ballsC.slice(ballsC.indexOf('static const struct BrTableBall sTableBalls[] ='));
    const rows = [...body.slice(0, body.indexOf('};')).matchAll(/\{ (\d+), (\d+), (\d+) \}/g)];
    expect(TABLE).toEqual(rows.map((r) => [ROOMS[Number(r[1])][0], Number(r[2]), Number(r[3])]));
    expect(Number(/#define BR_TABLE_BALLS (\d+)/.exec(ballsC)![1])).toBe(TABLE.length);
    for (const [m] of TABLE) expect(PAINT[m], m).toBeUndefined();
  });

  it('every painted room holds its painted ball and person, and nothing else', () => {
    const g = [...room.ground().values()];
    const homes = room as unknown as { dealHomes(round: number): { map: string; x: number; y: number }[] };
    let balls = 0;
    for (const [map, p] of Object.entries(PAINT)) {
      const row = ROOMS.find(([m]) => m === map)!;
      expect([row[1], row[2], row[4], row[5], row[6]], map).toEqual([...(p.item ?? [row[1], row[2]]), p.item !== null, ...p.person]);
      if (!room.maps.has(map) || room.places.has(map)) continue;
      const here = g.filter((b) => b.map === map).map((b) => [b.x, b.y]);
      expect(here, map).toEqual(p.item ? [p.item] : []);
      if (p.item) {
        expect(p.item, `${map}: a person on the ball`).not.toEqual(p.person);
        balls++;
      }
    }
    expect(balls).toBeGreaterThan(140);
    for (let round = 0; round < 16; round++) {
      for (const h of homes.dealHomes(round)) if (PAINT[h.map]) expect([h.x, h.y], h.map).toEqual(PAINT[h.map].person);
    }
  });

  it('A takes a ball Cam put on a table, from the chair beside it', () => {
    // The WEATHER INSTITUTE 1F: Cam's ball is on the left table's top (11,5), a wall cell; the
    // chair at (10,5) faces it.
    const r = makeRoom(MAPS, PATCHES, 4242);
    const map = 'MAP_ROUTE119_WEATHER_INSTITUTE_1F';
    const [x, y] = PAINT[map].item!;
    expect([x, y]).toEqual([11, 5]);
    expect(r.world.cell(map, x, y)).toBe(1);
    const g = r.groundAt(map, x, y)!;
    expect(isTm(g.item) || GOLD.includes(g.item)).toBe(true);
    r.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map, x: x - 1, y }, facing: FACE_RIGHT });
    r.actor(1)!.m.facing = FACE_RIGHT;
    const e = r.step(new Map([[1, [KEY_A]]]));
    expect(e).toContainEqual(expect.objectContaining({ type: 'item', id: 1, key: g.key, item: g.item }));
    expect(r.groundAt(map, x, y)).toBeUndefined();
  });
});
