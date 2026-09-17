// The seven tiles between the page's map and the ROM's (POK-219/236).
//
// Emerald keeps two coordinate spaces for the same tile. A map's own data -- the
// blockdata grid, a warp's destination, an object event's template -- counts from the
// top-left of the map itself. Everything *running* counts from seven tiles further out,
// because `fieldmap.c` surrounds the loaded map with a border of MAP_OFFSET tiles:
// `gObjectEvents[].currentCoords`, `MapGridGetElevationAt`, and every engine call that
// takes a live position are all in that outer space.
//
// The page works in the inner one. `world.json` and `landing.json` are the exporter's
// grids, so the bot brain, the walkability, the seams and the drop's landing cells all
// count from the map. The ROM works in the outer one: `WatchOwn` reads the player's
// `currentCoords`, and `BrGhosts_Spawn` hands its cell to
// `SpawnSpecialObjectEventParameterized`, which takes it off again.
//
// So the wire is the outer space, and this is the door. `world.ts` has said "the wire
// adds MAP_OFFSET on its way to the ROM" since POK-236 and nothing ever did -- which
// put every bot seven tiles up and seven left of where its brain had walked it, through
// trees, over cliffs and across water, while a player's own ghost (which comes from the
// ROM already in the outer space) was exactly right. That is the play-test's "they are
// not respecting collision in general".
//
// What does NOT shift: a warp is map data, so `start`'s spawns and `land`'s cell are
// the inner space on both sides -- `SetWarpDestination` wants them that way. The ring
// is region-map sections, not tiles.
import type { Msg } from './wire';

export const MAP_OFFSET = 7;

/** Messages whose x/y are a live tile, and so belong to the ROM's outer space. */
const HAS_CELL = new Set<string>(['place', 'step', 'spill']);

/** The same message with its live cells moved by `by` tiles. Returns the message
 *  untouched when it carries none, so callers can pass everything through. */
export function shiftCells(msg: Msg, by: number): Msg {
  if (!HAS_CELL.has(msg.t)) return msg;
  const m = msg as unknown as {
    x?: number;
    y?: number;
    mons?: { x: number; y: number }[];
    bag?: { x: number; y: number };
  };
  const out = { ...m } as typeof m;

  if (typeof m.x === 'number') out.x = m.x + by;
  if (typeof m.y === 'number') out.y = m.y + by;
  if (Array.isArray(m.mons)) out.mons = m.mons.map((d) => ({ ...d, x: d.x + by, y: d.y + by }));
  if (m.bag) out.bag = { ...m.bag, x: m.bag.x + by, y: m.bag.y + by };
  return out as unknown as Msg;
}

/** A page cell (the exporter's space) as the ROM wants it. */
export function toRomCells(msg: Msg): Msg {
  return shiftCells(msg, MAP_OFFSET);
}

/** A ROM cell as the page's world graph wants it. */
export function toPageCells(msg: Msg): Msg {
  return shiftCells(msg, -MAP_OFFSET);
}
