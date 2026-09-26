// What the room's drawn views show of each seat, as one key (POK-330 #33).
//
// renderRoom (app.ts) runs on every roster change and on the spectate loop's 500 ms tick,
// and repaints the room screen or the in-match sheet only when the key moves: a copy
// rebuilt between a finger's pointerdown and its click loses the tap. So the key holds
// what the view shows and nothing else: where a seat stands is not on a seat, and in a
// match every step, turn and door moves it, bots' included.
import type { RosterEntry } from '../match/roster';

type NameOf = (seat: number) => string;

/** The drawn room: each seat's name, sprite, you and out -- and where the seat whose card
 *  is open was last seen, since the card says it. Nobody else's place is on screen. */
export function stageKey(entries: readonly RosterEntry[], nameOf: NameOf, cardSeat: number | null): string {
  return JSON.stringify(
    entries.map((e) => [
      e.seat,
      nameOf(e.seat),
      e.skin ?? null,
      e.isMe,
      e.alive,
      e.seat === cardSeat ? [e.map?.group ?? null, e.map?.num ?? null] : null,
    ]),
  );
}
