// The shared world's messages (relay/world.js <-> net.ts), one JSON object a text frame.

import type { Frame } from './host';
import type { Bag, RoomState } from './room';

/** Phone to relay. */
export type WorldUp =
  /** In: who I am. Answered by `hello`, or `full`. */
  | { t: 'join'; name: string; skin: number }
  /** My keys for frames `s`, `s`+1, ... (numbered from 1, never reset). */
  | { t: 'in'; s: number; k: number[] }
  /** My battle is over. */
  | { t: 'end' }
  /** The ball or bag `k` would not go in my bag: put it back (a bag holding `rest`). */
  | { t: 'drop'; k: number; rest?: Bag }
  /** My team is down: take my trainer off the map, my bag where I stood; I keep watching. */
  | { t: 'out'; bag?: Bag }
  /** My copy went wrong (a hash or a gap): send me the room again. */
  | { t: 'sync' };

/** A frame as one phone gets it: `a` is that phone's last input the frame used; `h` the
 *  room's hash after it, every HASH_EVERY frames. */
export type WireFrame = Frame & { a?: number; h?: number };

/** Relay to phone. */
export type WorldDown =
  | { t: 'hello'; id: number; state: RoomState }
  | { t: 'state'; state: RoomState }
  | { t: 'f'; f: WireFrame[] }
  | { t: 'full' };

export const HASH_EVERY = 60;
