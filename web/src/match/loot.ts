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
import type { MapRef, Msg, SpillBag, SpillMon, SpillMsg } from '../net/wire';

interface Piece {
  seat: number;
  map: MapRef;
  mon?: SpillMon;
  bag?: SpillBag;
}

function sameMap(a: MapRef, b: MapRef): boolean {
  return a.group === b.group && a.num === b.num;
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
   *  the same rule the ROM plays by. */
  notePickup(key: number, item?: number): void {
    if (item !== undefined) {
      const piece = this.pieces.get(key);
      if (piece?.bag) return;
    }
    this.pieces.delete(key);
  }

  /** How many pieces are still on the ground anywhere. */
  size(): number {
    return this.pieces.size;
  }

  /** The loot standing on one map, as a `spill` the ROM can be handed, or null when
   *  there is nothing there. Mons past the ROM's six-a-message limit are dropped:
   *  the ROM has room for eight pieces in total and this is a redelivery, not a record.
   *  One spill can only speak for one seat, so this picks the seat with the most on
   *  that map and leaves the rest for a later arrival to ask about. */
  forMap(map: MapRef): SpillMsg | null {
    const bySeat = new Map<number, Piece[]>();
    for (const piece of this.pieces.values()) {
      if (!sameMap(piece.map, map)) continue;
      const list = bySeat.get(piece.seat);
      if (list) list.push(piece);
      else bySeat.set(piece.seat, [piece]);
    }
    let best: { seat: number; pieces: Piece[] } | null = null;
    for (const [seat, pieces] of bySeat) {
      if (!best || pieces.length > best.pieces.length) best = { seat, pieces };
    }
    if (!best) return null;
    const mons = best.pieces.filter((p) => p.mon).map((p) => p.mon as SpillMon).slice(0, 6);
    const bag = best.pieces.find((p) => p.bag)?.bag;
    const msg: SpillMsg = { t: 'spill', seat: best.seat, map, mons };
    if (bag) msg.bag = bag;
    return msg;
  }

  /** Every piece still on the ground, for anyone who needs to walk to one. */
  /** What is under this key, in the words a ticker line would use -- or null when this
   *  page never saw it land (POK-268). A watcher uses it to say what the trainer it is
   *  following just picked up. */
  describe(key: number): string | null {
    const piece = this.pieces.get(key);

    if (!piece) return null;
    if (piece.mon) {
      // speciesName only knows the species the bots deal from (party.ts's POOL) and
      // answers with the number for anything else. A number in a ticker line is noise
      // to a player, so an unknown one is just a Pokemon.
      const name = speciesName(piece.mon.species);
      return /^\d+$/.test(name) ? 'A POKéMON' : `A ${name}`;
    }
    if (piece.bag) return 'A BAG';
    return 'SOMETHING';
  }

  all(): { key: number; map: MapRef; x: number; y: number }[] {
    const out: { key: number; map: MapRef; x: number; y: number }[] = [];
    for (const [key, piece] of this.pieces) {
      const cell = piece.mon ?? piece.bag;
      if (cell) out.push({ key, map: piece.map, x: cell.x, y: cell.y });
    }
    return out;
  }

  /** The piece standing on this cell, if any. */
  at(map: MapRef, x: number, y: number): number | undefined {
    for (const [key, piece] of this.pieces) {
      if (!sameMap(piece.map, map)) continue;
      const cell = piece.mon ?? piece.bag;
      if (cell && cell.x === x && cell.y === y) return key;
    }
    return undefined;
  }

  /** Feeds the table from anything that crosses this page, either way. */
  note(msg: Msg): void {
    if (msg.t === 'spill') this.noteSpill(msg);
    else if (msg.t === 'pickup') this.notePickup(msg.key, msg.item);
  }
}
