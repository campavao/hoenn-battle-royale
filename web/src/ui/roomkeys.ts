// What the room's two views show of each seat, as one key apiece (POK-330 #33).
//
// renderRoom (app.ts) runs on every roster change and on the spectate loop's 500 ms tick,
// and redraws a view only when its key moves. The drawer's list is rebuilt from scratch,
// and a button rebuilt between a finger's pointerdown and its click loses the tap. So a
// key holds what its view shows and nothing else: where a seat stands is on neither the
// list nor a seat, and in a match every step, turn and door moves it, bots' included.
import type { RosterEntry } from '../match/roster';

type NameOf = (seat: number) => string;

/** A drawer button's text: the name, and whether it is you or out. */
export function drawerLabel(entry: Pick<RosterEntry, 'isMe' | 'alive'>, name: string): string {
  return `${name}${entry.isMe ? ' (you)' : ''}${entry.alive ? '' : ' -- OUT'}`;
}

/** The drawer's #match-roster list: a button per seat, and what each one says. */
export function drawerKey(entries: readonly RosterEntry[], nameOf: NameOf): string {
  return JSON.stringify(entries.map((e) => [e.seat, drawerLabel(e, nameOf(e.seat))]));
}

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
