// The two tile spaces, as types (POK-330 #14).
//
// net/cells.ts has the story: Emerald counts a live tile seven further out than the map's
// own data does, the wire carries the live one, and the page's world graph walks the
// other. A cell has crossed from one to the other without the shift twice now -- every
// bot's ghost drawn seven tiles off (POK-236), and then every piece of loot a bot walked
// to, and every bot a promoted host stood back up. Both sides were a plain `{ x, y }`, so
// nothing could tell them apart.
//
// These are the same `{ x, y }` with a tag only the compiler sees: handing a ROM cell to
// something that wants a page one is a type error rather than a play-test.
import { MAP_OFFSET } from '../net/cells';

declare const space: unique symbol;

/** A live tile: the ROM's space, and so what the wire carries -- `place`, `step`,
 *  `spill`, and the roster rows built from them. */
export type RomCell = { readonly x: number; readonly y: number; readonly [space]: 'rom' };

/** A map-data tile: the exporter's space, which world.json, landing.json and the bots'
 *  brain all count in. */
export type PageCell = { readonly x: number; readonly y: number; readonly [space]: 'page' };

/** Says which space a bare x/y is in. The only way to make either kind -- so every place
 *  a cell is born says where it came from. */
export function romCell(x: number, y: number): RomCell {
  return { x, y } as RomCell;
}

export function pageCell(x: number, y: number): PageCell {
  return { x, y } as PageCell;
}

/** Off the wire and onto the page's grid. */
export function toPage(cell: RomCell): PageCell {
  return pageCell(cell.x - MAP_OFFSET, cell.y - MAP_OFFSET);
}

/** And back. */
export function toRom(cell: PageCell): RomCell {
  return romCell(cell.x + MAP_OFFSET, cell.y + MAP_OFFSET);
}
