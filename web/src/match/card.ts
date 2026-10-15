// A trainer's card (POK-268).
//
// Kanto's lobby is drawn, and A on somebody opens their card (v0.45.0). Hoenn's lobby
// and room are drawn too, so this is the same idea: press a name, read who they are.
//
// It says only what the room actually knows. Career wins are on Kanto's card and are
// NOT here: a career lives in each player's own localStorage and nothing on the wire
// carries it. What they look like is drawn beside the lines, not spelled out (POK-343),
// and STATUS and LAST SEEN are gone with it: a card opened in the room before a match
// said IN THE MATCH and a town nobody had been to, and the seats already say who is out
// (Cam's 2026-10-14 play-test: "I don't think we need status... I don't need a last
// seen here").
import type { RosterEntry } from './roster';

export interface CardLine {
  label: string;
  value: string;
}

export function cardFor(entry: RosterEntry): CardLine[] {
  const lines: CardLine[] = [{ label: 'TRAINER', value: entry.name || `P${entry.seat}` }];
  if (entry.isMe) lines.push({ label: '', value: 'THIS IS YOU' });
  return lines;
}
