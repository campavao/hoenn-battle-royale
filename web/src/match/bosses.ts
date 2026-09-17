// Gym leaders as one-shot bosses: the page's half (POK-295).
//
// Kanto announces a fallen leader across the map, because a gym is a contested landmark
// and the point of one is that everybody else now knows it is gone. The ROM already says
// so: a beaten trainer crosses the wire as `npcout` (POK-287) so the sprite leaves every
// map, and a leader is a trainer. So nothing new is sent -- each page recognises the
// leader by where they stood and draws the line itself, the way the DAY CARE's chest does
// (ticker.ts, chest()).
//
// The ROM's half is src/br/br_gym.c: one page of speech, the purse, no ceremony. This
// table is pinned against pret's own map data by bosses.test.ts, so a map edit that moves
// a leader down the object list fails a test instead of silencing the line.
import type { MapRef } from '../net/wire';

export interface Boss {
  name: string; // as the ticker says it
  dir: string; // data/maps/<dir>/map.json
  leader: string; // the tail of the object's script label
  map: MapRef;
  localIds: number[]; // TATE and LIZA are two sprites and either can be the one talked to
}

export const BOSSES: Boss[] = [
  { name: 'ROXANNE', dir: 'RustboroCity_Gym', leader: 'Roxanne', map: { group: 11, num: 3 }, localIds: [1] },
  { name: 'BRAWLY', dir: 'DewfordTown_Gym', leader: 'Brawly', map: { group: 3, num: 3 }, localIds: [1] },
  { name: 'WATTSON', dir: 'MauvilleCity_Gym', leader: 'Wattson', map: { group: 10, num: 0 }, localIds: [1] },
  { name: 'FLANNERY', dir: 'LavaridgeTown_Gym_1F', leader: 'Flannery', map: { group: 4, num: 1 }, localIds: [1] },
  { name: 'NORMAN', dir: 'PetalburgCity_Gym', leader: 'Norman', map: { group: 8, num: 1 }, localIds: [1] },
  { name: 'WINONA', dir: 'FortreeCity_Gym', leader: 'Winona', map: { group: 12, num: 1 }, localIds: [1] },
  { name: 'TATE&LIZA', dir: 'MossdeepCity_Gym', leader: 'TateAndLiza', map: { group: 14, num: 0 }, localIds: [1, 9] },
  { name: 'JUAN', dir: 'SootopolisCity_Gym_1F', leader: 'Juan', map: { group: 15, num: 0 }, localIds: [1] },
];

/** The leader an `npcout` names, or null for one of Hoenn's ordinary trainers. */
export function bossAt(map: MapRef, localId: number): string | null {
  const hit = BOSSES.find((b) => b.map.group === map.group && b.map.num === map.num && b.localIds.includes(localId));
  return hit ? hit.name : null;
}
