import { describe, expect, it } from 'vitest';
import regionMap from '../../src/region_map.c?raw';
import healJson from '../../src/data/heal_locations.json';
import { FLY_SPOTS } from './flyspots';
import { couldFly } from './carry';
import { makeRoom } from './shared/room';
import { MAPS, PATCHES } from './shared/relay-entry';

const heal = new Map((healJson as { heal_locations: { id: string; map: string; x: number; y: number }[] }).heal_locations.map((h) => [h.id, h]));

describe('where FLY lands', () => {
  it("is region_map.c's table, each town's heal location", () => {
    const rows = [...regionMap.matchAll(/\[MAPSEC_\w+\]\s*=\s*\{MAP_GROUP\((MAP_\w+)\),\s*MAP_NUM\(MAP_\w+\),\s*(HEAL_LOCATION_\w+)\}/g)].filter((m) => m[2] !== 'HEAL_LOCATION_NONE');
    expect(rows).toHaveLength(16);
    for (const [, map, id] of rows) {
      // LITTLEROOT's row is the bed upstairs; SetFlyDestination flies to the house's door.
      const h = heal.get(id.replace(/_2F$/, ''))!;
      expect(h.map, id).toBe(map);
      expect(FLY_SPOTS[map], map).toEqual([h.x, h.y]);
    }
    expect(Object.keys(FLY_SPOTS)).toHaveLength(16);
  });

  it('is somewhere room.ts will let a trainer land', () => {
    const room = makeRoom(MAPS, PATCHES, 7);
    const off = Object.keys(FLY_SPOTS).filter((m) => !room.places.has(m));
    // SOOTOPOLIS isn't joined to the rest of the plane (room.ts layout): the MAP greys it.
    expect(off).toEqual(['MAP_SOOTOPOLIS_CITY']);
    for (const [map, [x, y]] of Object.entries(FLY_SPOTS)) {
      if (off.includes(map)) continue;
      expect(room.world.cell(map, x, y), `${map} ${x},${y}`).toBe(0);
    }
  });
});

describe('who could FLY', () => {
  it('knows it, or could learn HM02', () => {
    const PIDGEOT = 18, WEEDLE = 13;
    expect(couldFly([])).toBe(false);
    expect(couldFly([{ species: WEEDLE, moves: [] }])).toBe(false);
    expect(couldFly([{ species: WEEDLE, moves: [{ id: 19 }] }])).toBe(true);
    expect(couldFly([{ species: WEEDLE, moves: [] }, { species: PIDGEOT, moves: [] }])).toBe(true);
  });
});
