// Where the page's match meets the bots' brain (POK-238, POK-330).
//
// The brain walks the page's grid and hears nothing by itself. What it knows of the
// match comes through here: the loot on the ground and where a bot was last seen, both
// off the wire in the ROM's space (bots/space.ts), and what a ROM said about a fight
// with a bot. A bot has no ROM, so its fights run in somebody else's, and the page that
// walks it only ever hears how they went -- written once, and called from every road a
// ROM's words arrive by: the room's relay, the host's own ROM, and solo's, which has no
// relay at all and for a long time heard none of it.
import type { Loot } from '../match/loot';
import type { MapRef, Msg } from '../net/wire';
import type { Bots, BotsOptions } from './brain';
import type { Bot } from './roster';
import { toPage, toRom, type RomCell } from './space';

/** The match's loot table as the brain sees it (POK-232, POK-330 #14). The table holds
 *  what the wire said, which is the ROM's space; the brain walks the page's. `at` was
 *  converted and `all` was not, so bots walked to the cell seven tiles right and seven
 *  down of every piece -- a wall as often as not -- and with two pieces on a map
 *  shuttled between the two wrong cells for the rest of the match. */
export function lootView(
  loot: Loot,
  refOf: (mapId: string) => MapRef | undefined,
  idOf: (map: MapRef) => string | undefined,
): NonNullable<BotsOptions['loot']> {
  return {
    all: () =>
      loot.all().flatMap((piece) => {
        const mapId = idOf(piece.map);
        return mapId ? [{ key: piece.key, mapId, ...toPage(piece) }] : [];
      }),
    at: (mapId, cell) => {
      const ref = refOf(mapId);
      return ref ? loot.at(ref, toRom(cell)) : undefined;
    },
    bagAt: (key) => loot.bagAt(key),
  };
}

/** A bot picked up by a promoted host (POK-252), stood where the room last saw it. That
 *  is a roster row, which came off the wire -- the ROM's space -- and a bot stands on
 *  the page's grid, so it used to come back seven tiles off, often inside a wall. No
 *  row, or a map the world does not know, leaves it where the deal put it. */
export function resumeAt(
  bot: Bot,
  seen: ({ map: MapRef } & RomCell) | undefined,
  idOf: (map: MapRef) => string | undefined,
): Bot {
  const mapId = seen ? idOf(seen.map) : undefined;
  if (!seen || !mapId) return bot;
  const cell = toPage(seen);
  return { ...bot, map: seen.map, mapId, x: cell.x, y: cell.y };
}

/** Hands the brain whatever a ROM said about a fight with a bot. `from` is the seat
 *  whose ROM said it: the relay's own `from` for a message that crossed the wire, and
 *  our own seat for one our ROM sent. It is the only thing that tells the ROM that ran
 *  a fight from anybody else talking about it, because the Bridge stamps a ROM's own
 *  seat on nearly everything it sends -- including the `result` the ROM wrote under
 *  the bot's. */
export function routeToBots(bots: Bots, msg: Msg, from: number): void {
  switch (msg.t) {
    case 'challenge':
      // Somebody's ROM challenged one of our bots (POK-238). A ROM cannot tell a bot
      // from a person, so it has parked the challenge waiting to find out, and only the
      // page walking the bot has its team to answer with. The challenger is the one
      // whose ROM sent it.
      if (msg.seat === from) bots.challenged(msg.opponent, msg.seat);
      return;
    case 'party':
      // What the bot has left, under the bot's own seat (SPEAKS_FOR_ANOTHER): only the
      // ROM that fought it saw the fight. Its arrival is also the fight ending.
      bots.setParty(msg.seat, msg.mons, from);
      return;
    case 'spent':
      // And what it spent out of its bag in there (POK-237), for the same reason.
      bots.noteSpent(msg.seat, msg.items, from);
      return;
    case 'result':
      bots.noteResult(msg.seat, from);
      return;
    default:
      return;
  }
}
