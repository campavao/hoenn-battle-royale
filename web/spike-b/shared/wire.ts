// The shared world's messages (relay/world.js <-> net.ts), one JSON object a text frame.

import type { Frame } from './host';
import type { Bag, RoomState } from './room';

/** Phone to relay. */
export type WorldUp =
  /** In: who I am. Answered by `hello`, or `full`. */
  | { t: 'join'; name: string; skin: number }
  /** My keys for frames `s`, `s`+1, ... (numbered from 1, never reset). */
  | { t: 'in'; s: number; k: number[] }
  /** My battle is over (`fled`: it never got going, or was run from). */
  | { t: 'end'; fled?: boolean }
  /** The ball or bag `k` would not go in my bag: put it back (a bag holding `rest`). */
  | { t: 'drop'; k: number; rest?: Bag }
  /** My team is down: take my trainer off the map, my bag where I stood; I keep watching. */
  | { t: 'out'; bag?: Bag }
  /** My copy went wrong (a hash or a gap): send me the room again. */
  | { t: 'sync' }
  /** A link block from my ROM's battle, for the trainer I am fighting (br_netlink.c's BT:
   *  its counter and bytes). */
  | { t: 'bt'; q: number; d: number[] };

/** A frame as one phone gets it: `a` is that phone's last input the frame used; `h` the
 *  room's hash after it, every HASH_EVERY frames. */
export type WireFrame = Frame & { a?: number; h?: number };

/** Relay to phone. */
export type WorldDown =
  | { t: 'hello'; id: number; state: RoomState }
  | { t: 'state'; state: RoomState }
  | { t: 'f'; f: WireFrame[] }
  /** A link block from the trainer I am fighting. */
  | { t: 'bt'; q: number; d: number[] }
  | { t: 'full' };

export const HASH_EVERY = 60;
