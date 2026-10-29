// The shared world's messages (relay/world.js <-> net.ts), one JSON object a text frame.

import type { Frame } from './host';
import type { Bag, RoomState } from './room';

/** Phone to relay. */
export type WorldUp =
  /** In: who I am, and which room -- a code, a new one of my own (`host`), or, with
   *  neither, quick play. Answered by `room` (or `no_room`, `full`). */
  | { t: 'join'; name: string; skin: number; code?: string; host?: boolean; again?: Again }
  /** START (the room's host): the match begins for everybody in the room. */
  | { t: 'start' }
  /** My keys for frames `s`, `s`+1, ... (numbered from 1, never reset). */
  | { t: 'in'; s: number; k: number[] }
  /** My battle is over (`fled`: it never got going, or was run from). */
  | { t: 'end'; fled?: boolean; won?: boolean }
  | { t: 'field'; bits: number }
  /** The two bots the room gave me to fight (a `bots` event), and who won: 0, nobody. */
  | { t: 'bots'; a: number; b: number; w: number }
  /** My trade with event `n`'s trader is over: I gave him `sp` (0, nothing). */
  | { t: 'traded'; n: number; sp: number }
  | { t: 'open'; n: number }
  /** Drop me on this map when the Safari ends. */
  | { t: 'pick'; map: string }
  /** The ball or bag `k` would not go in my bag: put it back (a bag holding `rest`). */
  | { t: 'drop'; k: number; rest?: Bag }
  /** My team is down: take my trainer off the map, my bag where I stood; I keep watching.
   *  `by` who beat me, `wild` a wild POKeMON did; neither, the fog. */
  | { t: 'out'; bag?: Bag; by?: number; wild?: boolean }
  /** My copy went wrong (a hash or a gap): send me the room again. */
  | { t: 'sync' }
  /** A link block from my ROM's battle, for the trainer I am fighting (br_netlink.c's BT:
   *  its counter and bytes). */
  | { t: 'bt'; q: number; d: number[] }
  /** I am watching trainer `id` now (0: nobody): their battles come to me as they are
   *  fought, and they see one more eye. */
  | { t: 'watch'; id: number }
  /** What my ROM published of the battle I am in (a BSTART, then its TURNs), for whoever
   *  watches me or the one I fight. */
  | { t: 'sp'; m: SpMsg };

/** A published battle's message as it left the fighter's ROM (web/src/net/wire.ts's
 *  BstartMsg and TurnMsg): opaque bytes, for the watcher's ROM to replay. */
export type SpMsg = { t: 'bstart' | 'turn'; battle: number; data: number[] };

/** A frame as one phone gets it: `a` is that phone's last input the frame used; `h` the
 *  room's hash after it, every HASH_EVERY frames. */
export type WireFrame = Frame & { a?: number; h?: number };

/** Back in after a reload (Cam, 2026-10-20: within a minute): the room, my trainer's id
 *  in its match, and the key the relay gave me with it. */
export interface Again { code: string; id: number; key: string }

/** A trainer in a room, as the roster shows them. */
export interface Member { id: number; name: string; skin: number }

/** Relay to phone. */
export type WorldDown =
  /** The room as it is now, whenever anything in it changes: its code, who is in it, who
   *  has START (`owner`), whether a match is on, and a quick room's count to its start. */
  | { t: 'room'; code: string; quick: boolean; you: number; owner: number; members: Member[]; playing: boolean; startsIn?: number }
  /** No room by that code (or it is full). */
  | { t: 'no_room'; code: string }
  /** A match: my trainer's id in it and the Room as it starts (or as it is, joining late). */
  | { t: 'hello'; id: number; state: RoomState; key?: string }
  | { t: 'state'; state: RoomState }
  | { t: 'f'; f: WireFrame[] }
  /** A link block from the trainer I am fighting. */
  | { t: 'bt'; q: number; d: number[] }
  /** The battle the trainer I watch is in, from its start (`from`: whose ROM it is). */
  | { t: 'sp'; from: number; m: SpMsg }
  /** How many are watching me now. */
  | { t: 'eyes'; n: number }
  | { t: 'full' };

export const HASH_EVERY = 60;
