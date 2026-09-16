// The Safari opening's own cells (POK-256/257).
//
// The same sixteen the ROM has in `sSafariCells` (src/br/br_match.c), and for the same
// reason: they are the cells the exported collision grid says are open ground or tall
// grass with open ground on all four sides, spread over MAP_SAFARI_ZONE_SOUTH by
// farthest-point sampling so nobody starts boxed in and no two people start together.
//
// Two copies of a table is a parity risk, so it is worth saying which is which: the
// ROM's copy places the player it is running on, this one places the bots the host
// walks. They are generated from the same world.json grid and `safari.test.ts` holds
// them to it -- if the map data ever changes, the test fails rather than the bots
// quietly walking into a wall.
export const SAFARI_MAP_ID = 'MAP_SAFARI_ZONE_SOUTH';

export const SAFARI_CELLS: readonly { x: number; y: number }[] = [
  { x: 29, y: 2 }, { x: 15, y: 5 }, { x: 2, y: 7 }, { x: 23, y: 7 },
  { x: 36, y: 9 }, { x: 10, y: 13 }, { x: 26, y: 15 }, { x: 35, y: 16 },
  { x: 18, y: 19 }, { x: 4, y: 20 }, { x: 26, y: 26 }, { x: 9, y: 29 },
  { x: 17, y: 33 }, { x: 31, y: 35 }, { x: 3, y: 36 }, { x: 23, y: 38 },
];
