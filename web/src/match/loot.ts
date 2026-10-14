// What is lying on the ground, match-wide (POK-232).
//
// The ROM holds only what fits on one map -- eight pieces, because the object event
// table is sixteen slots and the ghosts want most of them -- and it forgets everything
// when the map changes. That is the right trade for the ROM and the wrong one for the
// match: a ball dropped in Petalburg is still there when somebody walks in an hour
// later, and a `spill` is broadcast once, to whoever happened to be listening.
//
// So the page keeps the whole table and hands the ROM back the piece of it that
// matters: every time our own trainer arrives on a map, the loot standing on that map
// goes into the in-ring as a fresh `spill`. The ROM cannot tell the difference between
// that and the original, which is the point.
import { speciesName } from '../bots/party';

/** A patch of grass a wild battle started on (include/br/br_patch.h): its PICKUP takes it
 *  off every ROM's map, and it was never a piece on this table. */
export const PATCH_KEY_BASE = 0x2000;
export const isPatchKey = (key: number): boolean => (key & 0xe000) === PATCH_KEY_BASE;

// include/constants/items.h
const TM01 = 289;
const HM01 = 339;
import { romCell, type RomCell } from '../bots/space';
import type { World } from '../bots/world';
import type { MapRef, Msg, SpillBag, SpillMon, SpillMsg } from '../net/wire';

/** One piece on the ground, where the wire put it: the ROM's space (bots/space.ts). */
export type LootCell = { key: number; map: MapRef } & RomCell;

/** Where the pieces of one spill land, walked in this order: the cell they fell on, then
 *  the ring around it, then two out. Kanto scatters within two tiles; this is the same
 *  list the ROM uses for a player's own spill (`sSpillDx`/`sSpillDy` in br_loot.c) and it
 *  has to stay that list, because both sides describe the same event and a spill that
 *  landed differently depending on who dropped it is two different worlds. */
const SPILL_DX = [0, 1, -1, 0, 0, 1, -1, 1, -1, 2, -2, 0, 0];
const SPILL_DY = [0, 0, 0, 1, -1, 1, 1, -1, -1, 0, 0, 2, -2];

/** Cells for `n` pieces dropped at (x, y), skipping anything the ROM's `CellFree` would
 *  skip -- collision, and nothing else (World.clear) -- and never using one twice. Fewer
 *  than `n` when the ring runs out -- a trainer who falls in a doorway leaves what fits.
 *
 *  A bot's spill used to put every ball on the dropper's own cell. That is one visible
 *  ball (BrLoot_At returns the first row it matches) with the rest of the team stacked
 *  underneath it, and the BAG under those -- which is why a beaten bot looked like it
 *  dropped one Pokemon and no bag at all. The ROM has always scattered its own.
 *
 *  And on the same cells the ROM would pick. This used to skip anything nobody could
 *  stand on, which is water too: a player beaten at sea drops their team on the waves,
 *  and a bot beaten at sea dropped nothing at all (POK-330 #67). Should nothing in the
 *  ring be clear, the dropper's own cell takes the first piece: nothing leaves a match. */
export function spillCells(world: World, mapId: string, x: number, y: number, n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];

  for (let i = 0; i < SPILL_DX.length && out.length < n; i++) {
    const cx = x + SPILL_DX[i];
    const cy = y + SPILL_DY[i];
    if (!world.clear(mapId, cx, cy)) continue;
    if (out.some((c) => c.x === cx && c.y === cy)) continue;
    out.push({ x: cx, y: cy });
  }
  if (out.length === 0 && n > 0) out.push({ x, y });
  return out;
}

interface Piece {
  seat: number;
  map: MapRef;
  mon?: SpillMon;
  bag?: SpillBag;
}

function sameMap(a: MapRef, b: MapRef): boolean {
  return a.group === b.group && a.num === b.num;
}

/** One map's pieces as the `spill`s the ROM can be handed: one for each seat with
 *  something down there (more when it has more than six mons or more than one bag), the
 *  seat with the most first.
 *
 *  Six mons and one bag a message, as many messages as a seat needs. A seat used to get
 *  one, its first six mons and its first bag: a winner now puts each beaten team down
 *  under their own seat (br_loot.c's spoils), so two fights on one map, or spoils beside a
 *  ball the winner released, is more than six -- and a table that has let pieces go to
 *  make room (br_loot.c's Evict) gets them back only from here. */
function spillsOf(map: MapRef, pieces: Piece[]): SpillMsg[] {
  const bySeat = new Map<number, Piece[]>();
  for (const piece of pieces) {
    const list = bySeat.get(piece.seat);
    if (list) list.push(piece);
    else bySeat.set(piece.seat, [piece]);
  }
  const seats = [...bySeat].sort((a, b) => b[1].length - a[1].length);
  return seats.flatMap(([seat, mine]) => {
    const mons = mine.filter((p) => p.mon).map((p) => p.mon as SpillMon);
    const bags = mine.filter((p) => p.bag).map((p) => p.bag as SpillBag);
    const out: SpillMsg[] = [];
    for (let i = 0; i < Math.max(Math.ceil(mons.length / 6), bags.length); i++) {
      const msg: SpillMsg = { t: 'spill', seat, map, mons: mons.slice(i * 6, i * 6 + 6) };
      if (bags[i]) msg.bag = bags[i];
      out.push(msg);
    }
    return out;
  });
}

export class Loot {
  /** key -> the piece standing under it. The ROM's keys are a u16 with the dropper's
   *  seat in the high byte, so they do not collide between trainers. */
  private readonly pieces = new Map<number, Piece>();

  /** Everything a `spill` put down. Re-reading a spill we already hold is harmless:
   *  the keys are the same, so it replaces rather than duplicates. */
  noteSpill(msg: SpillMsg): void {
    for (const mon of msg.mons) this.pieces.set(mon.key, { seat: msg.seat, map: msg.map, mon });
    if (msg.bag) this.pieces.set(msg.bag.key, { seat: msg.seat, map: msg.map, bag: msg.bag });
  }

  /** Somebody took it. An `item` named is part of a bag going, not the bag itself --
   *  the same rule the ROM plays by -- so the stack goes down by one and the bag stays
   *  where it is until it is empty (POK-237). Before that the table kept the bag
   *  whole, which a player never noticed (their own ROM holds the real list) and a bot
   *  standing on it did: it took the same POTION every step, for ever. */
  notePickup(key: number, item?: number): void {
    if (item !== undefined) {
      const piece = this.pieces.get(key);
      if (piece?.bag) {
        const i = piece.bag.items.findIndex((s) => s.id === item);
        if (i >= 0 && --piece.bag.items[i].n <= 0) piece.bag.items.splice(i, 1);
        if (piece.bag.items.length > 0) return;
      }
    }
    this.pieces.delete(key);
  }

  /** What the next item out of this piece would be, when it is a bag. Undefined for a
   *  mon, for an empty bag, and for a key this page never saw land. */
  bagAt(key: number): number | undefined {
    return this.pieces.get(key)?.bag?.items[0]?.id;
  }

  /** Everything in this bag, for handing to a ROM that has just taken the whole piece
   *  (POK-280). A copy, because the caller is about to see the piece deleted. Undefined
   *  for a mon and for a key this page never saw land; an empty array for a bag whose
   *  stacks have all been picked off one at a time by bots. */
  bagItems(key: number): { id: number; n: number }[] | undefined {
    const bag = this.pieces.get(key)?.bag;

    return bag ? bag.items.map((s) => ({ ...s })) : undefined;
  }

  /** How many pieces are still on the ground anywhere. */
  size(): number {
    return this.pieces.size;
  }

  /** The loot standing on one map, as the `spill`s the ROM can be handed: one for each
   *  seat with something down there (more when it has more than six mons or more than one
   *  bag), the seat with the most first, and none when the map is bare.
   *
   *  One spill speaks for one seat, and this used to hand over only the seat with the
   *  most. A bag whose rest would not fit goes back on the ground under the taker's seat
   *  (br_loot.c's HandleGive, POK-331 #6), usually beside the fallen trainer's balls, so
   *  anybody arriving after it dropped was sent the balls and never the bag. The ROM's
   *  ParseSpill ignores the seat byte and takes each spill as it comes. */
  forMap(map: MapRef): SpillMsg[] {
    return spillsOf(map, [...this.pieces.values()].filter((piece) => sameMap(piece.map, map)));
  }

  /** The pieces whose keys `want` picks, wherever they lie, as `spill`s: one map's at a
   *  time, as forMap gives them. A seat back from a blip is handed an event's this way
   *  (match/events.ts), since it heard none of it land. */
  matching(want: (key: number) => boolean): SpillMsg[] {
    const byMap = new Map<string, Piece[]>();
    for (const [key, piece] of this.pieces) {
      if (!want(key)) continue;
      const id = `${piece.map.group}:${piece.map.num}`;
      const list = byMap.get(id);
      if (list) list.push(piece);
      else byMap.set(id, [piece]);
    }
    return [...byMap.values()].flatMap((pieces) => spillsOf(pieces[0].map, pieces));
  }

  /** Is this key still on the ground somewhere? */
  has(key: number): boolean {
    return this.pieces.has(key);
  }

  /** What is under this key, in the words a ticker line would use -- or null when this
   *  page never saw it land (POK-268). A watcher uses it to say what the trainer it is
   *  following just picked up. */
  describe(key: number): string | null {
    const piece = this.pieces.get(key);

    if (!piece) return null;
    if (piece.mon) {
      // speciesName answers with the number for an id the ROM has no name for. A
      // number in a ticker line is noise to a player, so an unknown one is just a
      // Pokemon.
      const name = speciesName(piece.mon.species);
      return /^\d+$/.test(name) ? 'A POKéMON' : `A ${name}`;
    }
    if (piece.bag) {
      // A TM dropped back on the ground travels as a bag of one (br_loot.c's DropItem), and
      // the ROM draws it as a ball.
      const { items, money } = piece.bag;
      if (money === 0 && items.length === 1 && items[0].n === 1) {
        return items[0].id >= TM01 && items[0].id < HM01 ? 'A TM' : 'AN ITEM';
      }
      return 'A BAG';
    }
    return 'SOMETHING';
  }

  /** Every piece still on the ground, for anyone who needs to walk to one -- in the
   *  wire's space, which is not the one a bot walks in (bots/adapt.ts's lootView). */
  all(): LootCell[] {
    const out: LootCell[] = [];
    for (const [key, piece] of this.pieces) {
      const cell = piece.mon ?? piece.bag;
      if (cell) out.push({ key, map: piece.map, ...romCell(cell.x, cell.y) });
    }
    return out;
  }

  /** The piece standing on this cell, if any. */
  at(map: MapRef, at: RomCell): number | undefined {
    for (const [key, piece] of this.pieces) {
      if (!sameMap(piece.map, map)) continue;
      const cell = piece.mon ?? piece.bag;
      if (cell && cell.x === at.x && cell.y === at.y) return key;
    }
    return undefined;
  }

  /** Feeds the table from anything that crosses this page, either way. */
  note(msg: Msg): void {
    if (msg.t === 'spill') this.noteSpill(msg);
    else if (msg.t === 'pickup') this.notePickup(msg.key, msg.item);
  }
}
