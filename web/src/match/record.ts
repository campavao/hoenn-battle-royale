// What you actually did in there (POK-303).
//
// Cam, live: "in the Hall of Fame screen, which is great and definitely works,
// afterwards you should see your stats, such as how many rings you survived, how many
// trainers you beat." The parade says who won; this says what the match was.
//
// Counted from the wire, not sent over it. Every number here is something the page
// already watches go past -- an `npcout` names the seat that beat the trainer, a
// `dresult` names both sides and the winner, a `pickup` names who took the piece -- so
// there is no new message, no ROM counter, and no EWRAM (there are eighty bytes left).
// `card.ts` set the house rule and it holds here: **say only what the room actually
// knows**. That is why there is no CAUGHT row -- a Safari catch never crosses the wire,
// and a card that guesses is worse than a card with one fewer line.
//
// RINGS is the one worth saying out loud: the ring phase this seat was still standing
// at, which is "rings survived" in the sense Cam asked for -- the fog closed this many
// times and you were still there.
import type { Msg } from '../net/wire';

export interface SeatRecord {
  /** The ring phase this seat was still alive at. 0 before the fog's first move. */
  rings: number;
  /** Hoenn's own route trainers this seat beat. */
  trainers: number;
  /** Duels against another trainer: fought, and of those, won. */
  duels: number;
  duelsWon: number;
  /** Pieces of loot taken off the ground -- balls, bags and the Zone's item balls. */
  took: number;
}

export interface RecordLine {
  label: string;
  value: string;
}

/** Everything but `rings`, which is not a tally -- it is read off the clock at the end. */
interface Tally {
  trainers: number;
  duels: number;
  duelsWon: number;
  took: number;
}

function empty(): Tally {
  return { trainers: 0, duels: 0, duelsWon: 0, took: 0 };
}

export class MatchRecord {
  private readonly rows = new Map<number, Tally>();
  /** Seat -> the ring phase it went out on. Absent means still in. */
  private readonly outAt = new Map<number, number>();
  private phase = 0;

  /** A fresh match. Called from the same place `Results.start` is. */
  start(): void {
    this.rows.clear();
    this.outAt.clear();
    this.phase = 0;
  }

  private row(seat: number): Tally {
    let row = this.rows.get(seat);
    if (row === undefined) {
      row = empty();
      this.rows.set(seat, row);
    }
    return row;
  }

  note(msg: Msg): void {
    switch (msg.t) {
      case 'ring':
        // The host resends the current ring; only a new one moves the count.
        if (msg.phase > this.phase) this.phase = msg.phase;
        return;
      case 'out':
        // Where the fog was when they stopped. First `out` wins: a seat does not go out
        // twice, and a duplicate must not backdate a record.
        if (!this.outAt.has(msg.seat)) this.outAt.set(msg.seat, this.phase);
        return;
      case 'npcout':
        if (!msg.fog) this.row(msg.seat).trainers++; // the fog's sweep is nobody's win
        return;
      case 'pickup':
        // An `item` named is one stack coming out of a bag that stays on the ground
        // (POK-237, a bot raiding it), not a piece leaving -- the same distinction
        // `giveBag` makes, and the reason taking one bag is not counted six times.
        if (msg.item === undefined) this.row(msg.seat).took++;
        return;
      case 'dresult': {
        const a = this.row(msg.seatA);
        const b = this.row(msg.seatB);
        a.duels++;
        b.duels++;
        // 2 is a draw, or a fight that never resolved: fought, won by nobody.
        if (msg.winner === 0) a.duelsWon++;
        else if (msg.winner === 1) b.duelsWon++;
        return;
      }
      default:
        return;
    }
  }

  /** Never undefined: a seat that did nothing has a record of doing nothing, and a card
   *  of zeroes is still the truth. */
  forSeat(seat: number): SeatRecord {
    return { rings: this.outAt.get(seat) ?? this.phase, ...(this.rows.get(seat) ?? empty()) };
  }
}

/** The card, as label/value pairs for whoever is drawing it. A row that is zero is left
 *  out -- except RINGS, which is the question Cam asked and reads as an answer at 0. */
export function recordLines(rec: SeatRecord): RecordLine[] {
  const lines: RecordLine[] = [{ label: 'RINGS', value: String(rec.rings) }];
  if (rec.trainers > 0) lines.push({ label: 'TRAINERS', value: String(rec.trainers) });
  if (rec.duels > 0) lines.push({ label: 'DUELS', value: `${rec.duelsWon} of ${rec.duels}` });
  if (rec.took > 0) lines.push({ label: 'TOOK', value: `${rec.took} ${rec.took === 1 ? 'piece' : 'pieces'}` });
  return lines;
}
