// Where FLY lands in each town: region_map.c's sMapFlyDestinations, each its heal location
// (src/data/heal_locations.json), just outside the POKeMON CENTER. LITTLEROOT's table entry is the
// bed in the house, so a flight uses the house's door instead, as SetFlyDestination does.
// flyspots.test.ts reads those files and pins this.
export const FLY_SPOTS: Readonly<Record<string, readonly [number, number]>> = {
  MAP_LITTLEROOT_TOWN: [5, 9],
  MAP_OLDALE_TOWN: [6, 17],
  MAP_DEWFORD_TOWN: [2, 11],
  MAP_LAVARIDGE_TOWN: [9, 7],
  MAP_FALLARBOR_TOWN: [14, 8],
  MAP_VERDANTURF_TOWN: [16, 4],
  MAP_PACIFIDLOG_TOWN: [8, 16],
  MAP_PETALBURG_CITY: [20, 17],
  MAP_SLATEPORT_CITY: [19, 20],
  MAP_MAUVILLE_CITY: [22, 6],
  MAP_RUSTBORO_CITY: [16, 39],
  MAP_FORTREE_CITY: [5, 7],
  MAP_LILYCOVE_CITY: [24, 15],
  MAP_MOSSDEEP_CITY: [28, 17],
  MAP_SOOTOPOLIS_CITY: [43, 32],
  MAP_EVER_GRANDE_CITY: [27, 49],
};
