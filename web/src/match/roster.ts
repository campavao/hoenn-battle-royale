// The page's own mirror of who is where (POK-219/220): one row per seat, kept in
// sync from two sources that never agree on vocabulary --
//
//  - the relay's `roster` message (net/relay.ts): who is in the room at all, keyed
//    by the relay's own connection `id`. That id doubles as this wire's `seat`
//    (docs/WIRE.md: "a fixed roster slot", same idea, assigned by different code),
//    so a relay roster event both creates/removes rows and is the only source for
//    `name`.
//  - `place`/`step`/`face`/`out` messages (net/wire.ts's `Msg`), whether they came
//    from our own ROM (bridge.ts, stamped with our seat) or another seat over the
//    relay: where that seat is, which way it's facing, and whether it's still alive.
//
// ...and a third, the match's own deal: its bots (`seatBots`), which walk like anybody
// else but are never relay members, so only the seed can name them.
//
// Nothing here talks to the network or the emulator -- bridge.ts owns both and
// calls into this class.

import type { Dir, MapRef } from '../net/wire';

export interface RosterEntry {
  seat: number;
  name: string;
  skin?: string;
  alive: boolean;
  map?: MapRef;
  x?: number;
  y?: number;
  dir: Dir;
  /** The gait its last step said (StepMsg.p), absent when that step did not say. */
  pace?: 0 | 1 | 2;
  isMe: boolean;
  /** Their career as they said it (a `card`, POK-339); absent for a bot, and for a
   *  page older than the message. */
  record?: { wins: number; matches: number; best?: number; battles?: number; caught?: number; fav?: number };
}

