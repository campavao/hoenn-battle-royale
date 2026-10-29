// The shared world's messages (relay/world.js <-> net.ts), one JSON object a text frame.

import type { Frame } from './host';
import type { Bag, RoomState } from './room';
import type { FameMon } from '../../src/ui/results';

/** Phone to relay. */
export type WorldUp =
  /** In: who I am, and which room -- a code, a new one of my own (`host`), or, with
   *  neither, quick play. Answered by `room` (or `no_room`, `full`). */
  | { t: 'join'; name: string; skin: number; code?: string; host?: boolean; again?: Again; pass?: string; rec?: CardRecord }
  /** START (the room's host): the match begins for everybody in the room. */
  | { t: 'start' }
  /** The host's settings for the room's next match (the live room's options). */
  | { t: 'set'; set: Partial<Settings> & { pass?: string } }
  /** LEAVE: out of the room for good, and out of its match (the standings say "left");
   *  the socket stays for the menu. */
  | { t: 'leave' }
  /** The host takes a trainer out of the room, before its match. */
  | { t: 'kick'; id: number }
  /** LOBBIES: the rooms somebody hosted, answered by `rooms` (before a join, or in one). */
  | { t: 'list' }
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
  | { t: 'sail'; to: string }
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
  | { t: 'sp'; m: SpMsg }
  /** My team as it stands (after a battle, a catch, a trade): the results screen's hall
   *  of fame when I win. */
  | { t: 'team'; mons: FameMon[] };

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
export interface Member { id: number; name: string; skin: number; rec?: CardRecord }

/** A trainer's career as their device keeps it (career.ts), for the card on their seat. */
export interface CardRecord { wins: number; played: number; best?: number }

/** What the host sets for a match (the live room's options): bots in it or none, how
 *  long a ring phase lasts (FOG), and the Safari it opens with (0: none). */
export interface Settings {
  bots: boolean; fogSecs: number; safariSecs: number;
  /** Trainers the room lets in (match/room.ts MAX_STEPS). */
  max: number;
  /** On LOBBIES (open), off it (private), or on it behind a passcode (pass). */
  door: 'open' | 'private' | 'pass';
  /** The battles' pace (the live room's TEXT and ANIM): SLOW 1, MID 3, FAST 5. */
  textSpeed: 1 | 3 | 5;
  animations: boolean;
}

/** A room on LOBBIES' list. */
export interface Listed { code: string; host: string; skin: number; players: number; seats: number; playing: boolean; pass: boolean }

/** Relay to phone. */
export type WorldDown =
  /** The room as it is now, whenever anything in it changes: its code, who is in it, who
   *  has START (`owner`), whether a match is on, and a quick room's count to its start. */
  | { t: 'room'; code: string; quick: boolean; you: number; owner: number; members: Member[]; playing: boolean; startsIn?: number; set: Settings; pass?: string }
  /** The hosted rooms (LOBBIES): whose, how many in it of ROOM_MAX, and whether its
   *  match is on (joining one under way watches it until the next). */
  | { t: 'rooms'; rooms: Listed[] }
  /** The host took me out of the room: back to the menu, the socket still open. */
  | { t: 'kicked' }
  /** No room by that code (or it is full, or its passcode was wrong: `pass`). */
  | { t: 'no_room'; code: string; pass?: boolean }
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
  /** Trainer `id`'s team as they last told it. */
  | { t: 'team'; id: number; mons: FameMon[] }
  | { t: 'full' };

export const HASH_EVERY = 60;
