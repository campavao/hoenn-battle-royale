// The page half of spectating (POK-233). The ROM does the watching -- it rides a
// ghost's camera and replays a fight as a BATTLE_TYPE_RECORDED -- but it only ever
// sees what this page hands it, and this is what decides.
//
// Three jobs, none of which the ROM can do for itself:
//
//   - the gate. `bstart` and `turn` are broadcasts: every client in the room gets the
//     challenger's stream whether it asked for it or not. A ROM that is handed a
//     bstart starts replaying, so a client that is not watching must not be handed
//     one. `wantsFromRelay` is that filter.
//   - the ask. Kanto's peek is a pull (lib/peek.lua): the spectator asks every few
//     seconds, and only the trainer being watched answers. Re-asking is also how a
//     party stays current while they fight.
//   - the tally. A spectator's `follow` never leaves its own page, so nobody else can
//     count watchers. The peeks are the count: whoever asked recently is watching,
//     which is exactly the number the HUD's corner eye wants.
import type { Msg } from '../net/wire';

/** How often a spectator re-asks while watching (Kanto's `Peek.SECONDS`). */
export const PEEK_INTERVAL_MS = 3000;
/** How long a peek counts as "still watching me" -- two intervals plus slack, so one
 *  dropped ask does not blink the eye off. */
export const EYE_WINDOW_MS = 8000;

/** A battle id as BR_MSG_BSTART carries it: the seat pair, low seat then high. */
export function battleId(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return (lo | (hi << 8)) >>> 0;
}

/** The two seats in a battle id. */
export function battleSeats(battle: number): [number, number] {
  return [battle & 0xff, (battle >> 8) & 0xff];
}

export class Spectate {
  /** The seat this client is watching, or null. */
  private seat: number | null = null;
  /** The fight we have accepted a `bstart` for, so its `turn`s keep flowing even if
   *  the seat's own row goes quiet mid-battle. */
  private battle: number | null = null;
  // Negative infinity, not 0: a new watch asks at once rather than after a gap.
  private lastPeek = Number.NEGATIVE_INFINITY;
  /** seat -> when they last asked about us. */
  private readonly peekers = new Map<number, number>();

  watchingSeat(): number | null {
    return this.seat;
  }

  watchingBattle(): number | null {
    return this.battle;
  }

  /** Start watching a seat, or stop with null. Returns the `follow` the caller should
   *  hand to its own ROM -- it never goes to the relay. */
  follow(seat: number | null): Msg {
    if (seat !== this.seat) {
      this.battle = null;
      this.lastPeek = Number.NEGATIVE_INFINITY;
    }
    this.seat = seat;
    return { t: 'follow', seat };
  }

  /** The `peek` to send now, or null if it is not due yet. Kanto re-asks on a timer
   *  rather than once, so a party that changes mid-fight stays current. */
  duePeek(mySeat: number, now: number): Msg | null {
    if (this.seat === null) return null;
    if (now - this.lastPeek < PEEK_INTERVAL_MS) return null;
    this.lastPeek = now;
    return { t: 'peek', seat: mySeat, target: this.seat };
  }

  /** Somebody asked what we are carrying: they are watching us from now on. */
  notePeek(from: number, now: number): void {
    this.peekers.set(from, now);
  }

  /** How many are watching us -- the corner eye's number. */
  eyes(now: number): number {
    let n = 0;
    for (const [seat, at] of this.peekers) {
      if (now - at <= EYE_WINDOW_MS) n++;
      else this.peekers.delete(seat);
    }
    return n;
  }

  /** Should this relay message reach our ROM?
   *
   *  `bstart`/`turn` only while we are watching one of the two seats in that fight --
   *  a ROM handed a bstart starts a replay, and the broadcast reaches everyone.
   *  `party` only when it is the seat we are watching answering, since the ROM keeps
   *  one party for the peek box and a bot roster's party would overwrite it.
   *  `follow` never: it is a page's word to its own ROM and has no business arriving
   *  from anyone else. Everything else passes. */
  wantsFromRelay(msg: Msg): boolean {
    switch (msg.t) {
      case 'follow':
        return false;
      case 'bstart':
      case 'turn': {
        if (this.seat === null) return false;
        if (this.battle !== null && msg.battle === this.battle) return true;
        const [lo, hi] = battleSeats(msg.battle);
        if (lo !== this.seat && hi !== this.seat) return false;
        if (msg.t === 'bstart') this.battle = msg.battle;
        return this.battle === msg.battle;
      }
      case 'party':
        return this.seat !== null && msg.seat === this.seat;
      default:
        return true;
    }
  }

  /** A fight ended: the stream for it is over, so a later fight between other seats
   *  cannot be mistaken for it. */
  noteResult(seat: number): void {
    if (this.battle === null) return;
    const [lo, hi] = battleSeats(this.battle);
    if (seat === lo || seat === hi) this.battle = null;
  }
}
