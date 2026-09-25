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

import type { Dir, MapRef, Msg } from '../net/wire';
import type { RosterEvent } from '../net/relay';

export interface RosterEntry {
  seat: number;
  name: string;
  skin?: string;
  alive: boolean;
  map?: MapRef;
  x?: number;
  y?: number;
  dir: Dir;
  isMe: boolean;
}

const DEFAULT_DIR: Dir = 1; // DIR_SOUTH

function sameMap(a: MapRef | undefined, b: MapRef): boolean {
  return !!a && a.group === b.group && a.num === b.num;
}

export class Roster {
  private entries = new Map<number, RosterEntry>();
  private mySeat: number | null = null;
  /** Seats the match dealt to bots (POK-330 #51): the third source. No relay roster will
   *  ever list one, so these are the rows a relay roster event must leave alone. */
  private readonly bots = new Set<number>();
  /** Seats that have gone out this match (POK-330 #25), kept apart from the rows: a
   *  relay roster event drops a player's row the moment their socket goes, and the row
   *  that comes back with them used to be standing again -- on every page, for the rest
   *  of the match -- and so did their next `place`, from a ROM that never heard it was
   *  out. Out is for the match; only endMatch() or the next `start` stands them up. */
  private readonly fallen = new Set<number>();

  /** Which seat is "us" -- flips `isMe` on the matching row, if it already exists. */
  setMySeat(seat: number): void {
    this.mySeat = seat;
    for (const [s, e] of this.entries) e.isMe = s === seat;
  }

  mySeatNumber(): number | null {
    return this.mySeat;
  }

  private entry(seat: number): RosterEntry {
    let e = this.entries.get(seat);
    if (!e) {
      e = { seat, name: '', alive: !this.fallen.has(seat), dir: DEFAULT_DIR, isMe: seat === this.mySeat };
      this.entries.set(seat, e);
    }
    return e;
  }

  /** Applies the relay's `roster` event: creates/updates a row per member (seat =
   *  the relay's own connection id) and drops rows for anyone no longer listed --
   *  except the match's bots, which the relay never lists (seatBots). Position/facing/
   *  alive state is left alone -- the relay roster doesn't carry it -- until a
   *  place/step/face/out message fills it in. */
  applyRoster(msg: RosterEvent): void {
    const seen = new Set<number>();
    for (const m of msg.members) {
      seen.add(m.id);
      const e = this.entry(m.id);
      e.name = m.name;
    }
    for (const seat of Array.from(this.entries.keys())) {
      if (!seen.has(seat) && !this.bots.has(seat)) this.entries.delete(seat);
    }
  }

  /** The match's bots, dealt from its seed (match/lifecycle.ts's botRows): every client
   *  can work them out, and none of them is ever a relay member. Their rows used to have
   *  no name -- the ticker, the results and the saved round all said P21..P31 -- and were
   *  wiped by every roster event, skin, `alive` and all. */
  seatBots(bots: readonly { seat: number; name: string; skin: number }[]): void {
    for (const bot of bots) {
      this.bots.add(bot.seat);
      const e = this.entry(bot.seat);
      e.name = bot.name;
      e.skin ??= String(bot.skin);
    }
  }

  /** The match is over (PLAY AGAIN): its bots leave the roster, and everybody still in
   *  the room is standing again for the next one. */
  endMatch(): void {
    for (const seat of this.bots) this.entries.delete(seat);
    this.bots.clear();
    this.standAll();
  }

  private standAll(): void {
    this.fallen.clear();
    for (const e of this.entries.values()) e.alive = true;
  }

  /** One of the match's bots (seatBots), which no relay roster lists. */
  isBot(seat: number): boolean {
    return this.bots.has(seat);
  }

  /** What to call a seat: its name, or `P<seat>` for one nobody has named. */
  nameOf(seat: number): string {
    return this.entries.get(seat)?.name || `P${seat}`;
  }

  /** Applies one wire Msg that names a seat and moves/marks it. Anything else
   *  (chat, lobby-only chatter, ...) is ignored -- this is a position/status
   *  mirror, not a general message log. */
  applyMsg(msg: Msg): void {
    switch (msg.t) {
      case 'start':
        // A new match: whoever fell in the last one is standing in this one.
        this.standAll();
        return;
      case 'place': {
        const e = this.entry(msg.seat);
        if (msg.sprite !== undefined) e.skin = msg.sprite;
        if (msg.map) {
          e.map = msg.map;
          e.x = msg.x;
          e.y = msg.y;
        }
        e.dir = msg.f;
        if (msg.st === 'out') this.fallen.add(msg.seat);
        e.alive = !this.fallen.has(msg.seat);
        return;
      }
      case 'step': {
        const e = this.entry(msg.seat);
        e.map = msg.map;
        e.x = msg.x;
        e.y = msg.y;
        e.dir = msg.d;
        return;
      }
      case 'face': {
        const e = this.entry(msg.seat);
        e.map = msg.map;
        e.dir = msg.f;
        return;
      }
      case 'out': {
        this.fallen.add(msg.seat);
        this.entry(msg.seat).alive = false;
        return;
      }
      default:
        return;
    }
  }

  get(seat: number): RosterEntry | undefined {
    return this.entries.get(seat);
  }

  me(): RosterEntry | undefined {
    return this.mySeat === null ? undefined : this.entries.get(this.mySeat);
  }

  all(): RosterEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => a.seat - b.seat);
  }

  alive(): RosterEntry[] {
    return this.all().filter((e) => e.alive);
  }

  /** Everyone sharing a seat's current map -- for "who else is on screen" views. */
  onMap(map: MapRef): RosterEntry[] {
    return this.all().filter((e) => sameMap(e.map, map));
  }
}
