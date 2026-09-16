// A trainer's card (POK-268).
//
// Kanto's lobby is drawn, and A on somebody opens their card (v0.45.0). Hoenn's lobby
// and room are HTML, so this is the same idea in the shape this front end has: press a
// name, read who they are.
//
// It says only what the room actually knows. Career wins are on Kanto's card and are
// NOT here: a career lives in each player's own localStorage and nothing on the wire
// carries it, so putting it on the card would mean inventing a number or adding a
// message. The honest card is name, skin, whether they are still in, and where they
// were last seen.
import type { RosterEntry } from './roster';

export interface CardLine {
  label: string;
  value: string;
}

/** Turns a map id like MAP_ROUTE_104 into ROUTE 104. */
function placeOf(mapId: string | undefined): string | null {
  if (!mapId) return null;
  return mapId.replace(/^MAP_/, '').replace(/_/g, ' ');
}

export function cardFor(entry: RosterEntry, mapId?: string): CardLine[] {
  const lines: CardLine[] = [{ label: 'TRAINER', value: entry.name || `P${entry.seat}` }];

  if (entry.skin) lines.push({ label: 'LOOKS LIKE', value: entry.skin.toUpperCase() });
  lines.push({ label: 'STATUS', value: entry.alive ? 'IN THE MATCH' : 'OUT' });
  const place = placeOf(mapId);
  // Where somebody is, is worth knowing only while they are still in it.
  if (place && entry.alive) lines.push({ label: 'LAST SEEN', value: place });
  if (entry.isMe) lines.push({ label: '', value: 'THIS IS YOU' });
  return lines;
}
