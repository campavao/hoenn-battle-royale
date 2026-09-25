// Where the page's match meets the bots' brain (POK-238, POK-330).
//
// A bot has no ROM, so its fights run in somebody else's: whoever fought it reports how
// it went, and the page that walks it has to hear. This is that hearing, written once
// and called from every road a ROM's words arrive by -- the room's relay, the host's own
// ROM, and solo's, which has no relay at all and for a long time heard none of it.
import type { Msg } from '../net/wire';
import type { Bots } from './brain';

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
