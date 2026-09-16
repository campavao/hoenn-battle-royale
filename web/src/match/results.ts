// How a match ended, from where any client is sitting (POK-228).
//
// The host's Director already knows the elimination order -- it is the thing deciding
// it -- but a guest never runs one, and a guest still has to be told where it came.
// Both can work it out from what crosses the relay: every `out` in the order it
// arrived, and the `win` that closes the match. That is the whole input.
//
// Placement counts back from the end: the winner is 1st, the last one out 2nd, and the
// first one out is last. It is the only ordering a battle royale has, and it does not
// need a scoreboard to produce it.
import type { Msg } from '../net/wire';

export interface MatchResult {
  /** 1 = won. Undefined until this seat is out or the match ends. */
  placement?: number;
  /** Seconds this seat lasted, from the start to its own `out` (or to the end). */
  survived?: number;
  winner?: number;
  ended: boolean;
}

export class Results {
  /** Seats in the order they went out, first out first. */
  private readonly order: number[] = [];
  private readonly outAt = new Map<number, number>();
  private winner: number | undefined;
  private ended = false;
  private startedAt: number | undefined;
  private endedAt: number | undefined;
  /** Everyone the match started with; placement is counted against this. */
  private field = 0;

  /** The match is on, with this many seats in it. */
  start(seats: number, now: number): void {
    this.order.length = 0;
    this.outAt.clear();
    this.winner = undefined;
    this.ended = false;
    this.endedAt = undefined;
    this.startedAt = now;
    this.field = seats;
  }

  note(msg: Msg, now: number): void {
    if (msg.t === 'out') {
      if (this.ended || this.outAt.has(msg.seat)) return;
      this.order.push(msg.seat);
      this.outAt.set(msg.seat, now);
      if (this.field < this.order.length) this.field = this.order.length;
    } else if (msg.t === 'win') {
      if (this.ended) return;
      this.ended = true;
      this.endedAt = now;
      this.winner = msg.seat;
      if (msg.seat !== undefined && this.field < this.order.length + 1) {
        this.field = this.order.length + 1;
      }
    }
  }

  /** Where `seat` came, and how long it lasted. */
  forSeat(seat: number, now: number): MatchResult {
    const result: MatchResult = { ended: this.ended, winner: this.winner };
    if (this.winner === seat) result.placement = 1;
    else {
      const idx = this.order.indexOf(seat);
      // The field counts the winner too, so the last one out is 2nd, not 1st.
      if (idx >= 0) result.placement = this.field - idx;
    }
    if (this.startedAt !== undefined) {
      const until = this.outAt.get(seat) ?? this.endedAt ?? now;
      result.survived = Math.max(0, Math.round((until - this.startedAt) / 1000));
    }
    return result;
  }

  eliminationOrder(): number[] {
    return [...this.order];
  }
}
