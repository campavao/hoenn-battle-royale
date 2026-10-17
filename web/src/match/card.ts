// A trainer's card (POK-268).
//
// Kanto's lobby is drawn, and A on somebody opens their card (v0.45.0). Hoenn's lobby
// and room are drawn too, so this is the same idea: press a name, read who they are.
//
// It says only what the room actually knows. A career lives in each player's own
// localStorage, and each page says its record to the room in a `card` (POK-339, Cam:
// "save on device, and share when in the game"), so another trainer's card has their
// WINS and PLAYED as Kanto's does, and their BEST once they have finished one. A bot has
// no career, and a page older than the message says none. What they look like is drawn beside the lines, not spelled out (POK-343),
// and STATUS and LAST SEEN are gone with it: a card opened in the room before a match
// said IN THE MATCH and a town nobody had been to, and the seats already say who is out
// (Cam's 2026-10-14 play-test: "I don't think we need status... I don't need a last
// seen here").
import { ordinal } from './career';
import type { RosterEntry } from './roster';

export interface CardLine {
  label: string;
  value: string;
}

export function cardFor(entry: RosterEntry): CardLine[] {
  const lines: CardLine[] = [{ label: 'TRAINER', value: entry.name || `P${entry.seat}` }];
  if (entry.isMe) lines.push({ label: '', value: 'THIS IS YOU' });
  else if (entry.record) {
    lines.push({ label: 'WINS', value: String(entry.record.wins) }, { label: 'PLAYED', value: String(entry.record.matches) });
    if (entry.record.best !== undefined) lines.push({ label: 'BEST', value: ordinal(entry.record.best) });
  }
  return lines;
}
