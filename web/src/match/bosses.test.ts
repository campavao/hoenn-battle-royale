import { describe, expect, it } from 'vitest';
import mapGroups from '../../../data/maps/map_groups.json';
import gymSource from '../../../src/br/br_gym.c?raw';
import { bossAt, BOSSES } from './bosses';
import { felled, LINE_MAX } from './ticker';

// Vite resolves these at build time, so the table is checked against the same files the
// ROM is assembled from.
const MAPS = import.meta.glob('../../../data/maps/*_Gym*/map.json', { eager: true, import: 'default' }) as Record<
  string,
  { id: string; object_events: { script: string }[] }
>;

/** map_groups.h is made from map_groups.json by the build, and CI's web job runs no make:
 *  a map's group is its group's place in group_order, and its num its place in the group. */
const GROUPS = mapGroups as unknown as { group_order: string[] } & Record<string, string[]>;

function mapFor(dir: string) {
  const key = Object.keys(MAPS).find((k) => k.endsWith(`/${dir}/map.json`));
  expect(key, dir).toBeDefined();
  return MAPS[key!];
}

describe('the gym leaders the page announces', () => {
  it('are the eight the ROM pays out for', () => {
    const rom = [...gymSource.matchAll(/\{ TRAINER_(\w+?)_1,/g)].map((m) => m[1]);
    expect(rom).toHaveLength(8);
    expect(BOSSES.map((b) => b.leader.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase())).toEqual(rom);
  });

  it('stand where the table says, on the map it says', () => {
    for (const boss of BOSSES) {
      const map = mapFor(boss.dir);
      const group = GROUPS.group_order.findIndex((g) => GROUPS[g].includes(boss.dir));
      expect(group, map.id).toBeGreaterThanOrEqual(0);
      expect({ group, num: GROUPS[GROUPS.group_order[group]].indexOf(boss.dir) }).toEqual(boss.map);
      // A local id is the object's place in the list, from 1.
      const found = map.object_events
        .map((o, i) => (o.script.endsWith(`EventScript_${boss.leader}`) ? i + 1 : 0))
        .filter((i) => i > 0);
      expect(found, boss.name).toEqual(boss.localIds);
    }
  });

  it('are found by where they stood, and nobody else is', () => {
    expect(bossAt({ group: 11, num: 3 }, 1)).toBe('ROXANNE');
    expect(bossAt({ group: 11, num: 3 }, 2)).toBeNull(); // JOSH
    expect(bossAt({ group: 14, num: 0 }, 9)).toBe('TATE&LIZA');
    expect(bossAt({ group: 0, num: 19 }, 1)).toBeNull();
  });

  it('fit the ticker with the longest names on both sides', () => {
    for (const boss of BOSSES) {
      const line = felled(0, 'WWWWWWWWWW', boss.name);
      expect(line).not.toBeNull();
      expect(line!.text.length).toBeLessThanOrEqual(LINE_MAX);
      expect(line!.text.endsWith(`${boss.name}!`)).toBe(true);
    }
  });
});
