// The shared world's messages (relay/world.js <-> net.ts), one JSON object a text frame.

import type { Frame } from './host';
import type { RoomState } from './room';

/** Phone to relay. */
export type WorldUp =
  /** In: who I am. Answered by `hello`, or `full`. */
  | { t: 'join'; name: string; skin: number }
  /** My keys for frames `s`, `s`+1, ... (numbered from 1, never reset). */
  | { t: 'in'; s: number; k: number[] }
  /** My battle is over. */
  | { t: 'end' }
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
