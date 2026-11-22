import { describe, expect, it } from 'vitest';
import { World, type WorldMap } from '../src/bots/world';
import rooms from './data/rooms.json';
import worldJson from './data/world.json';
import { asTabled, blocks, changed, fromDraft, placeable, standable, type RoomRow } from './roompaint';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const ROWS = rooms as RoomRow[];
const world = new World(MAPS);
const at = (id: string) => MAPS.find((m) => m.id === id)!;

describe('the room painter', () => {
  const house = at('MAP_DEWFORD_TOWN_HOUSE1');
  const stand = standable(world, house);

  it('stands on the floor walked to from the door, and not in the walls', () => {
    expect(stand.size).toBeGreaterThan(10);
    expect(stand.has('3,6')).toBe(true);
    expect(stand.has('0,0')).toBe(false);
  });

  it('places on the floor and beside it, never on a door, in a wall out of reach or off the map', () => {
    expect(placeable(house, stand, 3, 6)).toBe(true);
    expect(placeable(house, stand, 3, 7), 'the door').toBe(false);
    expect(placeable(house, stand, 0, 0), 'the corner of the wall').toBe(false);
    expect(placeable(house, stand, -1, 3)).toBe(false);
    expect(placeable(house, stand, house.w, 3)).toBe(false);
  });

  it('can place where every house has its ball and its person today', () => {
    const missed: string[] = [];
    for (const row of ROWS.filter((r) => r[3] && MAPS.some((m) => m.id === r[0]))) {
      const m = at(row[0]);
      const s = standable(world, m);
      if (!s.size) continue;
      if (row[4] && !placeable(m, s, row[1], row[2])) missed.push(`${row[0]} item`);
      if (!placeable(m, s, row[5], row[6])) missed.push(`${row[0]} person`);
    }
    expect(missed.length, missed.join()).toBeLessThan(ROWS.length / 10);
  });

  it('sends only what differs from the table', () => {
    const [a, b] = ROWS;
    const paint = new Map([
      [a[0], asTabled(a)],
      [b[0], { item: null, person: [1, 2] as [number, number] }],
    ]);
    expect(changed(ROWS, paint)).toEqual({ [b[0]]: { item: null, person: [1, 2] } });
  });

  it('reads a draft back, dropping what it cannot be', () => {
    const [a] = ROWS;
    const text = JSON.stringify({ [a[0]]: { item: [1, 2], person: [3, 4] }, MAP_NOWHERE: { item: null, person: [0, 0] }, [ROWS[1][0]]: { item: 'x', person: [0, 0] } });
    expect([...fromDraft(text, ROWS)]).toEqual([[a[0], { item: [1, 2], person: [3, 4] }]]);
    expect(fromDraft('not json', ROWS).size).toBe(0);
    expect(fromDraft(null, ROWS).size).toBe(0);
  });

  it('knows a person who blocks the way from one in a nook (Cam, 11-22)', () => {
    const shuts = (id: string, x: number, y: number) => { const m = at(id); return blocks(world, m, standable(world, m), [x, y]); };
    // the one gap between Magma Hideout 3F's halves, and beside it where the floor is two wide
    expect(shuts('MAP_MAGMA_HIDEOUT_3F_1R', 15, 10)).toBe(true);
    expect(shuts('MAP_MAGMA_HIDEOUT_3F_1R', 19, 11)).toBe(false);
    // on the one tile a door steps onto
    expect(shuts('MAP_ABANDONED_SHIP_CORRIDORS_1F', 11, 10)).toBe(true);
    // in the mouth of a two-tile nook: nobody walks through it
    expect(shuts('MAP_SEAFLOOR_CAVERN_ROOM3', 12, 6)).toBe(false);
    expect(shuts('MAP_DEWFORD_TOWN_HOUSE1', 3, 6)).toBe(false);
  });
});
