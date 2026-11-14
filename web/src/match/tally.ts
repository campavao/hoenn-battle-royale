// What you did in a match that only your own ROM saw (POK-416): gBrTally, which the ROM
// zeroes as a match starts (START) and the page reads once it is decided -- the way it
// reads gBrJank.
//
// Cam: "record and show stats like how many battles won, favorite pokemon, favorite move,
// distance traveled, pokemon caught, items used, etc and save that for global profile and
// at the hall of fame." record.ts already counts what the room sees off the wire (rings,
// trainers, duels, loot); this is the rest. Layout: include/br/br_tally.h.

import type { TallyMsg } from '../net/wire';

export const TALLY_BYTES = 52;
const MONS = 6;
const MOVES = 8;
const SPECIES = 8;
const MOVE_IDS = 20;
const SPECIES_N = 36;
const MOVES_N = 42;

export interface MatchTally {
  steps: number;
  won: number;
  caught: number;
  items: number;
  /** How many moves each species used, and how many times each move was used: species
   *  and move id -> count. What "favourite" means here is the one you fought with most. */
  mons: Record<number, number>;
  moves: Record<number, number>;
}

type Read = (addr: number, bits: 8 | 16 | 32) => number;

function counts(read: Read, base: number, ids: number, ns: number, size: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 0; i < size; i++) {
    const n = read(base + ns + i, 8);
    if (n > 0) out[read(base + ids + i * 2, 16)] = n;
  }
  return out;
}

export function readTally(read: Read, base: number): MatchTally {
  return {
    steps: read(base, 16),
    won: read(base + 2, 16),
    caught: read(base + 4, 16),
    items: read(base + 6, 16),
    mons: counts(read, base, SPECIES, SPECIES_N, MONS),
    moves: counts(read, base, MOVE_IDS, MOVES_N, MOVES),
  };
}

/** The id with the highest count, or undefined for none. A tie goes to the lower id, so
 *  the same counts always name the same favourite. */
export function favourite(counts: Record<number, number>): number | undefined {
  let best: number | undefined;
  for (const [key, n] of Object.entries(counts)) {
    const id = Number(key);
    if (n <= 0) continue;
    if (best === undefined || n > counts[best] || (n === counts[best] && id < best)) best = id;
  }
  return best;
}

/** The counts as the results say them: the favourites named, the counts behind them not.
 *  What the room hears from a champion (TallyMsg), and what our own results draw from. */
export function tallyMsg(seat: number, t: MatchTally): TallyMsg {
  const msg: TallyMsg = { t: 'tally', seat, steps: t.steps, won: t.won, caught: t.caught, items: t.items };
  const mon = favourite(t.mons);
  const move = favourite(t.moves);
  if (mon !== undefined) msg.mon = mon;
  if (move !== undefined) msg.move = move;
  return msg;
}

export interface TallyNames {
  species(id: number): string;
  /** A move's name, or undefined when the page cannot read the ROM's table. */
  move(id: number): string | undefined;
}
