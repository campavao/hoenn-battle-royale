// The eight gym leaders as one-shot bosses (br_gym.c, DESIGN: "Gyms are one-shot bosses,
// first-to-beat closes them"). Where each stands is the gym's own map (bosses.ts pins the
// same local ids against pret's map data); the battle is the leader's own, in the hidden
// ROM (BrGym_StartBoss), and the purse and TM are the gym's.

/** A leader: br_gym.c's sBosses order (the ROM is asked for `n`), the ticker's name, and
 *  the cells and sprites (OBJ_EVENT_GFX_*) they stand on -- TATE and LIZA are two. */
export interface Leader { n: number; name: string; map: string; cells: [number, number][]; gfx: number[] }

export const LEADERS: readonly Leader[] = [
  { n: 0, name: 'ROXANNE', map: 'MAP_RUSTBORO_CITY_GYM', cells: [[5, 2]], gfx: [125] },
  { n: 1, name: 'BRAWLY', map: 'MAP_DEWFORD_TOWN_GYM', cells: [[4, 3]], gfx: [126] },
  { n: 2, name: 'WATTSON', map: 'MAP_MAUVILLE_CITY_GYM', cells: [[5, 2]], gfx: [127] },
  { n: 3, name: 'FLANNERY', map: 'MAP_LAVARIDGE_TOWN_GYM_1F', cells: [[13, 9]], gfx: [128] },
  { n: 4, name: 'NORMAN', map: 'MAP_PETALBURG_CITY_GYM', cells: [[4, 2]], gfx: [129] },
  { n: 5, name: 'WINONA', map: 'MAP_FORTREE_CITY_GYM', cells: [[15, 2]], gfx: [130] },
  { n: 6, name: 'TATE&LIZA', map: 'MAP_MOSSDEEP_CITY_GYM', cells: [[23, 7], [24, 7]], gfx: [132, 131] },
  { n: 7, name: 'JUAN', map: 'MAP_SOOTOPOLIS_CITY_GYM_1F', cells: [[8, 2]], gfx: [218] },
];

const AT = new Map(LEADERS.flatMap((l) => l.cells.map(([x, y]) => [`${l.map}:${x}:${y}`, l] as const)));

export function leaderAt(map: string, x: number, y: number): Leader | undefined {
  return AT.get(`${map}:${x}:${y}`);
}
