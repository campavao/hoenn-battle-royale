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
  /** A row of its own: a name, which two to a row would cut short. */
  wide?: boolean;
}

