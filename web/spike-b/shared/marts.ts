// The MARTs' clerks and shelves (br_levels.c's sMarts and sDeptStore): where each clerk
// stands, from the maps' object events, and what each shelf sells at each rung.

/** A clerk: map, cell, the way they face (sim.ts: 1 down, 2 up, 3 left, 4 right), and
 *  the LILYCOVE DEPARTMENT STORE's whole shelf (POK-309) or the rung's. */
export interface Clerk { map: string; x: number; y: number; facing: number; store: boolean }

const MARTS = ['FALLARBOR_TOWN', 'FORTREE_CITY', 'LAVARIDGE_TOWN', 'MAUVILLE_CITY', 'MOSSDEEP_CITY', 'OLDALE_TOWN',
  'PETALBURG_CITY', 'RUSTBORO_CITY', 'SLATEPORT_CITY', 'SOOTOPOLIS_CITY', 'VERDANTURF_TOWN'];
const STORE = 'MAP_LILYCOVE_CITY_DEPARTMENT_STORE_';

export const CLERKS: readonly Clerk[] = [
  ...MARTS.map((t) => ({ map: `MAP_${t}_MART`, x: 1, y: 3, facing: 4, store: false })),
  ...([[2, 10, 6, 2], [2, 7, 6, 2], [3, 8, 2, 1], [3, 10, 2, 1], [4, 7, 6, 2], [4, 9, 6, 2], [5, 7, 2, 1], [5, 9, 2, 1], [5, 15, 6, 3], [5, 17, 6, 2]] as const)
    .map(([f, x, y, facing]) => ({ map: `${STORE}${f}F`, x, y, facing, store: true })),
];

const AT = new Map(CLERKS.map((c) => [`${c.map}:${c.x}:${c.y}`, c]));

export function clerkAt(map: string, x: number, y: number): Clerk | undefined {
  return AT.get(`${map}:${x}:${y}`);
}

// include/constants/items.h
const MASTER_BALL = 1, POKE_BALL = 4, POTION = 13, FULL_RESTORE = 19, MAX_POTION = 20, HYPER_POTION = 21,
  SUPER_POTION = 22, REVIVE = 24, MAX_REVIVE = 25, GUARD_SPEC = 73, DIRE_HIT = 74, X_ATTACK = 75, X_DEFEND = 76,
  X_SPEED = 77, X_ACCURACY = 78, X_SPECIAL = 79, POKE_DOLL = 80, SUN_STONE = 93, MOON_STONE = 94, FIRE_STONE = 95,
  THUNDER_STONE = 96, WATER_STONE = 97, LEAF_STONE = 98, LINK_CABLE = 52;

const TOP = [MASTER_BALL, POKE_BALL, MAX_POTION, FULL_RESTORE, REVIVE, MAX_REVIVE, X_ATTACK, X_DEFEND, X_SPEED, X_SPECIAL, X_ACCURACY, GUARD_SPEC, DIRE_HIT, POKE_DOLL];
const SHELVES: readonly (readonly number[])[] = [
  [POKE_BALL, POTION, POKE_DOLL],
  [POKE_BALL, POTION, SUPER_POTION, X_ATTACK, X_DEFEND, POKE_DOLL],
  [POKE_BALL, SUPER_POTION, HYPER_POTION, REVIVE, X_ATTACK, X_DEFEND, X_SPEED, X_SPECIAL, POKE_DOLL],
  [POKE_BALL, HYPER_POTION, MAX_POTION, REVIVE, X_ATTACK, X_DEFEND, X_SPEED, X_SPECIAL, X_ACCURACY, GUARD_SPEC, DIRE_HIT, POKE_DOLL],
  TOP,
  TOP,
];
const DEPT_STORE = [...TOP, FIRE_STONE, WATER_STONE, THUNDER_STONE, LEAF_STONE, SUN_STONE, MOON_STONE, LINK_CABLE];

/** What a clerk sells at ring phase `phase` (the room's: 0 before the first ring;
 *  br_levels.c's TierForPhase on the ROM's, which is one more). */
export function shelf(clerk: Clerk, phase: number): readonly number[] {
  return clerk.store ? DEPT_STORE : SHELVES[Math.min(Math.max(phase, 0), SHELVES.length - 1)];
}

/** BrLevels_ItemPrice: the prices a match puts on what Emerald never sells. */
export function priceOf(item: number, table: number): number {
  if (item === MASTER_BALL) return 5000;
  if (item === MOON_STONE) return 2100;
  return table;
}
