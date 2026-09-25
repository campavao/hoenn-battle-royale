// The one index of world.json (POK-331 #20): it answers what the four copies it
// replaced answered, and the World in it is built once, when something first walks.
import { describe, expect, it } from 'vitest';
import worldData from '../data/world.json';
import { HOENN, WorldIndex } from './hoenn';
import { botGround } from './host';
import type { WorldMap } from './world';

const MAPS = (worldData as { maps: WorldMap[] }).maps;

describe('the world index', () => {
  it('finds every map by id and by group:num, as a scan of world.json does', () => {
    expect(HOENN.maps).toBe(MAPS);
    for (const m of MAPS) {
      expect(HOENN.byId.get(m.id)).toBe(m);
      expect(HOENN.byRef.get(`${m.group}:${m.num}`)).toBe(m);
      // app.ts's old mapIdOf: the first map with that group and number.
      expect(HOENN.idOf({ group: m.group, num: m.num })).toBe(
        MAPS.find((o) => o.group === m.group && o.num === m.num)?.id,
      );
      expect(HOENN.refOf(m.id)).toEqual({ group: m.group, num: m.num });
    }
    expect(HOENN.idOf({ group: 99, num: 99 })).toBeUndefined();
    expect(HOENN.refOf('MAP_NOWHERE')).toBeUndefined();
  });

  it('builds its World on the first walk, not before, and only once', () => {
    let decoded = 0;
    const map = {
      id: 'M', group: 0, num: 1, w: 2, h: 1, section: '', outdoor: true, seams: [],
      get grid() {
        decoded++;
        return '2x0';
      },
    } as WorldMap;
    const index = new WorldIndex([map]);
    expect(index.idOf({ group: 0, num: 1 })).toBe('M');
    expect(decoded, 'the picture and the cards never decode a grid').toBe(0);
    const world = index.world;
    expect(decoded).toBe(1);
    expect(index.world).toBe(world);
    expect(world.standable('M', 1, 0)).toBe(true);
    expect(decoded).toBe(1);
  });

  it('is what every match of bots walks on: no second World per deal', () => {
    expect(botGround().world).toBe(HOENN.world);
    expect(botGround().world).toBe(botGround().world);
    expect(botGround().idOf({ group: MAPS[0].group, num: MAPS[0].num })).toBe(MAPS[0].id);
  });
});
