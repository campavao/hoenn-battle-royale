// The Safari opening's own cells (POK-256, POK-261).
//
// The same twenty-four the ROM has in `sSafariCells` (src/br/br_match.c), and for the
// same reasons: four per area, open ground or tall grass with open ground on all eight
// sides, three tiles clear of every edge (a seam is a map away, and a spawn on top of
// one is a warp nobody asked for), two clear of every warp, spread within the area by
// farthest-point sampling.
//
// All six areas, not just the south one: the Zone's areas are joined by seams, so a
// trainer can walk the whole of it from wherever they start, and an opening that used
// one sixth of the map was an opening where everybody met in the same corner.
//
// Two copies of a table is a parity risk, so it is worth saying which is which: the
// ROM's copy places the player it is running on, this one places the bots the host
// walks. They are generated from the same world.json grid and `safari.test.ts` holds
// them to it -- if the map data ever changes, the test fails rather than the bots
// quietly walking into a wall.
export const SAFARI_MAPS = [
  'MAP_SAFARI_ZONE_NORTHWEST',
  'MAP_SAFARI_ZONE_NORTH',
  'MAP_SAFARI_ZONE_NORTHEAST',
  'MAP_SAFARI_ZONE_SOUTHWEST',
  'MAP_SAFARI_ZONE_SOUTH',
  'MAP_SAFARI_ZONE_SOUTHEAST',
] as const;

/** Where the ROM's own boot lands when nothing has dealt it a cell. */
export const SAFARI_MAP_ID = 'MAP_SAFARI_ZONE_SOUTH';

export const SAFARI_CELLS: readonly { map: string; x: number; y: number }[] = [
  { map: 'MAP_SAFARI_ZONE_NORTHWEST', x: 6, y: 7 },
  { map: 'MAP_SAFARI_ZONE_NORTHWEST', x: 36, y: 15 },
  { map: 'MAP_SAFARI_ZONE_NORTHWEST', x: 13, y: 22 },
  { map: 'MAP_SAFARI_ZONE_NORTHWEST', x: 29, y: 32 },
  { map: 'MAP_SAFARI_ZONE_NORTH', x: 5, y: 11 },
  { map: 'MAP_SAFARI_ZONE_NORTH', x: 29, y: 19 },
  { map: 'MAP_SAFARI_ZONE_NORTH', x: 19, y: 32 },
  { map: 'MAP_SAFARI_ZONE_NORTH', x: 3, y: 36 },
  { map: 'MAP_SAFARI_ZONE_NORTHEAST', x: 3, y: 3 },
  { map: 'MAP_SAFARI_ZONE_NORTHEAST', x: 27, y: 9 },
  { map: 'MAP_SAFARI_ZONE_NORTHEAST', x: 21, y: 26 },
  { map: 'MAP_SAFARI_ZONE_NORTHEAST', x: 7, y: 36 },
  { map: 'MAP_SAFARI_ZONE_SOUTHWEST', x: 8, y: 5 },
  { map: 'MAP_SAFARI_ZONE_SOUTHWEST', x: 36, y: 7 },
  { map: 'MAP_SAFARI_ZONE_SOUTHWEST', x: 16, y: 25 },
  { map: 'MAP_SAFARI_ZONE_SOUTHWEST', x: 34, y: 36 },
  { map: 'MAP_SAFARI_ZONE_SOUTH', x: 29, y: 3 },
  { map: 'MAP_SAFARI_ZONE_SOUTH', x: 5, y: 5 },
  { map: 'MAP_SAFARI_ZONE_SOUTH', x: 24, y: 26 },
  { map: 'MAP_SAFARI_ZONE_SOUTH', x: 4, y: 36 },
  { map: 'MAP_SAFARI_ZONE_SOUTHEAST', x: 31, y: 3 },
  { map: 'MAP_SAFARI_ZONE_SOUTHEAST', x: 15, y: 14 },
  { map: 'MAP_SAFARI_ZONE_SOUTHEAST', x: 14, y: 32 },
  { map: 'MAP_SAFARI_ZONE_SOUTHEAST', x: 31, y: 36 },
];
