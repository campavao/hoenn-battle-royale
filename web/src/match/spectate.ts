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
//
// It also keeps every live fight's stream, not just the one being watched. A `bstart`
// is sent once, at the start; somebody who decides to watch two minutes in would
// otherwise have nothing to replay. Holding the bstart and the turns since means
// starting a watch is handing the ROM the fight from the top -- it catches up in the
// seconds it takes to play the turns out, and is a turn behind from there.
import type { BstartMsg, Msg } from '../net/wire';
import { encodeGen3 } from '../text/gen3';

/** How much of one fight's stream to hold for a late watcher. A turn is a handful of
 *  bytes, so this is a long fight; past it, that fight is no longer joinable rather
 *  than growing without bound. */
export const CACHE_MAX_BYTES = 8192;

interface LiveFight {
  bstart: Msg;
  turns: Msg[];
  bytes: number;
}

/** How often a spectator re-asks while watching (Kanto's `Peek.SECONDS`). */
export const PEEK_INTERVAL_MS = 3000;

/** A bstart names its two trainers in bytes 8..23 of its data, straight out of
 *  gLinkPlayers -- which the proxy duel instance never fills (POK-300). The bots' names
 *  are the page's, so they go in here: seven Gen 3 characters and an EOS, the low seat
 *  first, the way the ROM lays them out for a link battle. */
export function nameBstart(msg: BstartMsg, nameOf: (seat: number) => string): BstartMsg {
  const data = msg.data.slice();
  const seats = [msg.battle & 0xff, (msg.battle >> 8) & 0xff];
  for (let i = 0; i < 2; i++) {
    const name = encodeGen3(nameOf(seats[i]).toUpperCase(), 7);
    for (let j = 0; j < 8; j++) data[8 + 8 * i + j] = j < name.length ? name[j] : 0xff;
  }
  return { ...msg, data };
}
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
  /** battle id -> its stream so far, for whoever starts watching mid-fight. */
  private readonly live = new Map<number, LiveFight>();

  watchingSeat(): number | null {
    return this.seat;
  }

  watchingBattle(): number | null {
    return this.battle;
  }

  /** Start watching a seat, or stop with null. Returns what the caller should hand to
   *  its own ROM -- none of it goes to the relay: the `follow`, and, if that seat is
   *  already fighting, the fight from its `bstart` and every turn since. */
  follow(seat: number | null): Msg[] {
    if (seat !== this.seat) {
      this.battle = null;
      this.lastPeek = Number.NEGATIVE_INFINITY;
    }
    this.seat = seat;
    const out: Msg[] = [{ t: 'follow', seat }];
    if (seat === null) return out;
    for (const [battle, fight] of this.live) {
      const [lo, hi] = battleSeats(battle);
      if (lo !== seat && hi !== seat) continue;
      this.battle = battle;
      out.push(fight.bstart, ...fight.turns);
      break;
    }
    return out;
  }

  /** The `peek` to send now, or null if it is not due yet. Kanto re-asks on a timer
   *  rather than once, so a party that changes mid-fight stays current. */
  duePeek(mySeat: number, now: number): Msg | null {
    if (this.seat === null) return null;
    if (now - this.lastPeek < PEEK_INTERVAL_MS) return null;
    this.lastPeek = now;
    return { t: 'peek', seat: mySeat, target: this.seat };
  }

  /** Everything our own ROM sent, so a fighter's page holds its own fight too -- it
   *  never sees those come back over the relay. */
  noteOutgoing(msg: Msg): void {
    this.remember(msg);
    if (msg.t === 'result') this.noteResult(msg.seat);
  }

  /** The fight `seat` is in, from its `bstart` and every turn since, for a spectator
   *  who asked after it started. A relay only delivers to who was in the room at the
   *  time, so a watcher who joined mid-fight has nothing of its own to replay -- this
   *  is the answer to their peek. */
  streamFor(seat: number): Msg[] {
    for (const [battle, fight] of this.live) {
      const [lo, hi] = battleSeats(battle);
      if (lo === seat || hi === seat) return [fight.bstart, ...fight.turns];
    }
    return [];
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
        this.remember(msg);
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

  /** Holds a fight's stream for a late watcher, whether we are watching it or not. */
  private remember(msg: Msg): void {
    if (msg.t === 'bstart') {
      this.live.set(msg.battle, { bstart: msg, turns: [], bytes: msg.data.length });
      return;
    }
    if (msg.t !== 'turn') return;
    const fight = this.live.get(msg.battle);
    if (!fight) return;
    fight.turns.push(msg);
    fight.bytes += msg.data.length;
    // Too long to replay from the top: drop it rather than grow. Anyone already
    // watching keeps getting turns; only joining late is off the table.
    if (fight.bytes > CACHE_MAX_BYTES) this.live.delete(msg.battle);
  }

  /** A fight ended: the stream for it is over, so a later fight between other seats
   *  cannot be mistaken for it, and there is nothing left to join. */
  noteResult(seat: number): void {
    for (const battle of [...this.live.keys()]) {
      const [lo, hi] = battleSeats(battle);
      if (seat === lo || seat === hi) this.live.delete(battle);
    }
    if (this.battle === null) return;
    const [lo, hi] = battleSeats(this.battle);
    if (seat === lo || seat === hi) this.battle = null;
  }
}
