// POK-438: indoor pickups on desks and tables, up to three in a notable building, taken with A as
// any ball is. Cam, 10-19: "Instead of on the ground, this could sit on the desk. This place can
// have three, because it's more notable. If the house is not as notable, this is fine."
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
const TABLE = tableBallsJson as [string, number, number][];
/** Cam's room painting (11-01): each room's first ball and its person, by hand. */
const PAINT = paintJson as Record<string, { item: [number, number] | null; person: [number, number] }>;
const room = makeRoom(MAPS, PATCHES, 4242);
const SIDES = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const FACE_DOWN = 1, FACE_UP = 2, FACE_LEFT = 3, FACE_RIGHT = 4;
const dealt = () => [...room.ground().values()].filter((g) => !room.places.has(g.map) && !g.map.startsWith('MAP_SAFARI'));

describe('balls on the furniture', () => {
  it('holds br_balls.c\'s table balls, and nothing more', () => {
    const body = ballsC.slice(ballsC.indexOf('static const struct BrTableBall sTableBalls[] ='));
    const rows = [...body.slice(0, body.indexOf('};')).matchAll(/\{ (\d+), (\d+), (\d+) \}/g)];
    expect(rows.length).toBeGreaterThan(20);
    // Not a ball more on a table Cam's painting moved a room's first ball off: 11-03 put 28 back,
    // each on the very cell he had moved it from ("no longer where I had placed them", 11-22).
    expect(TABLE).toEqual(rows.map((r) => [ROOMS[Number(r[1])][0], Number(r[2]), Number(r[3])]));
  });

  it('every painted room has its ball and its person where Cam put them', () => {
    const g = [...room.ground().values()];
    const homes = room as unknown as { dealHomes(round: number): { map: string; x: number; y: number }[] };
    let balls = 0;
    for (const [map, p] of Object.entries(PAINT)) {
      const row = ROOMS.find(([m]) => m === map)!;
      expect([row[1], row[2], row[4], row[5], row[6]], map).toEqual([...(p.item ?? [row[1], row[2]]), p.item !== null, ...p.person]);
      if (!p.item || !room.maps.has(map) || room.places.has(map)) continue;
      expect(g.some((b) => b.map === map && b.x === p.item![0] && b.y === p.item![1]), `${map} ${p.item}`).toBe(true);
      balls++;
    }
    expect(balls).toBeGreaterThan(140);
    for (let round = 0; round < 16; round++) {
      for (const h of homes.dealHomes(round)) if (PAINT[h.map]) expect([h.x, h.y], h.map).toEqual(PAINT[h.map].person);
    }
  });

  it('a table ball sits on the table\'s top, not on its front row', () => {
    // The WEATHER INSTITUTE's tables are three rows deep: Cam put the room's ball on the middle
    // one (11,6 to 11,5), and the table ball beside it is on that row too, not at the table's foot.
    expect(TABLE.filter(([m]) => m === 'MAP_ROUTE119_WEATHER_INSTITUTE_1F')).toEqual([['MAP_ROUTE119_WEATHER_INSTITUTE_1F', 16, 5]]);
    expect(PAINT.MAP_ROUTE119_WEATHER_INSTITUTE_1F.item).toEqual([11, 5]);
    // Everywhere: a free-standing table's cell with the same table behind it and the floor in
    // front of it is the table's front (floors.py, Floor.on_tables).
    const solid = (m: string, x: number, y: number) => room.world.cell(m, x, y) !== 0;
    let checked = 0;
    for (const [m, x, y] of TABLE) {
      const map = MAPS.find((q) => q.id === m)!;
      const comp = new Set<string>([`${x},${y}`]);
      const todo = [[x, y]];
      let edge = false;
      while (todo.length && comp.size <= 12) {
        const [cx, cy] = todo.pop()!;
        edge ||= cx === 0 || cy === 0 || cx === map.w - 1 || cy === map.h - 1;
        for (const [dx, dy] of SIDES) {
          const n = `${cx + dx},${cy + dy}`;
          if (!comp.has(n) && solid(m, cx + dx, cy + dy)) { comp.add(n); todo.push([cx + dx, cy + dy]); }
        }
      }
      if (edge || comp.size > 12) continue;
      checked++;
      expect(comp.has(`${x},${y - 1}`) && !solid(m, x, y + 1), `${m} ${x},${y}: on the table's front`).toBe(false);
    }
    expect(checked).toBeGreaterThan(15);
  });

  it('a house keeps its one; a notable building has up to three, its first included', () => {
    const counts = new Map<string, number>();
    for (const b of dealt()) counts.set(b.map, (counts.get(b.map) ?? 0) + 1);
    for (const [m, , , house] of ROOMS) if (house) expect(counts.get(m) ?? 0, m).toBeLessThanOrEqual(1);
    for (const [m, n] of counts) expect(n, m).toBeLessThanOrEqual(3);
    expect([...counts.values()].filter((n) => n === 3).length).toBeGreaterThan(5);
  });

  it('each is a machine or gold, on a table you can stand beside', () => {
    const dealtHere = dealt();
    let onTables = 0;
    for (const [m, x, y] of TABLE) {
      const g = dealtHere.find((b) => b.map === m && b.x === x && b.y === y);
      if (!g) continue;
      onTables++;
      expect(room.world.cell(m, x, y), `${m} ${x},${y}`).toBe(1);
      expect(isTm(g.item) || GOLD.includes(g.item)).toBe(true);
      expect(SIDES.some(([dx, dy]) => room.world.cell(m, x + dx, y + dy) === 0), `${m} ${x},${y}`).toBe(true);
    }
    expect(onTables).toBe(TABLE.length);
  });

  it('none on anybody: not the room\'s person, nor another ball', () => {
    const cells = new Set(TABLE.map(([m, x, y]) => `${m}:${x}:${y}`));
    expect(cells.size).toBe(TABLE.length);
    for (const [m, x, y, , cache, px, py] of ROOMS) {
      expect(cells.has(`${m}:${px}:${py}`), `${m}: a person on a ball`).toBe(false);
      if (cache) expect(cells.has(`${m}:${x}:${y}`), `${m}: two balls on one cell`).toBe(false);
    }
  });

  it('A takes it, from the floor in front, as any ball', () => {
    const r = makeRoom(MAPS, PATCHES, 4242);
    const [map, x, y] = TABLE.find(([m]) => m === 'MAP_ROUTE119_WEATHER_INSTITUTE_1F')!;
    const g = r.groundAt(map, x, y)!;
    expect(g).toBeTruthy();
    const side = SIDES.find(([dx, dy]) => r.world.cell(map, x + dx, y + dy) === 0)!;
    const facing = side[1] === 1 ? FACE_UP : side[1] === -1 ? FACE_DOWN : side[0] === 1 ? FACE_LEFT : FACE_RIGHT;
    r.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map, x: x + side[0], y: y + side[1] }, facing });
    r.actor(1)!.m.facing = facing;
    const e = r.step(new Map([[1, [KEY_A]]]));
    expect(e).toContainEqual(expect.objectContaining({ type: 'item', id: 1, key: g.key, item: g.item }));
    expect(r.groundAt(map, x, y)).toBeUndefined();
  });
});
