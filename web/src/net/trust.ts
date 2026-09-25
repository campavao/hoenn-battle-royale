// Who may say what (POK-330 #24). The relay stamps every `recv` with `from`, the sender's
// own member id, and it is the one thing on the wire a peer cannot forge -- and nothing
// read it. Any member of a room could send `duel` (every ROM in the room zeroes its party
// for a proxy fight), `give` (items into every bag), `again` (everybody out of the match),
// `win`, `ring`, a `start`: one line from a devtools console, in a quick-play room that
// seats strangers. It also let a stale page -- an ex-host still running a director --
// talk over the real one, and nothing could tell the two apart.
//
// So every message a page takes off the relay passes this table first (bridge.ts), once,
// before anything acts on it:
//
//   never  a page's word to its own ROM. Nobody else has any business sending one.
//   host   the room's, and only the host speaks for the room: the relay's own `host`,
//          which moves on a roster event before an heir can send anything.
//   self   about the sender itself: its `seat` must be `from`. The host is the exception,
//          because the host speaks for the bots it walks and for a seat that has gone.
//   battle a fight's stream, which names a seat pair rather than a seat: from either
//          fighter, or the host, whose proxy instance fights two bots.
//   bot    a report on a fight with a bot, which only the ROM that ran it saw, so it
//          arrives under the bot's seat from whoever fought it (bridge.ts's
//          SPEAKS_FOR_ANOTHER). `self` otherwise: a seat the relay lists is a person,
//          and nobody reports on a person but that person.
//
// This contains impersonation, not cheating: a peer's own ROM decides its own fights, and
// a modified client can still lie about those. What it cannot do any more is speak as
// somebody else, or as the room.
import { battleSeats } from '../match/spectate';
import type { Msg } from './wire';

export type Trust = 'never' | 'host' | 'self' | 'battle' | 'bot';

/** Every type the wire decodes, and who may send it. A `Record` over the whole union, so
 *  a new message type does not compile until somebody has said who may send it. */
export const TRUST: Record<Msg['t'], Trust> = {
  duel: 'never',
  give: 'never',
  follow: 'never',

  start: 'host',
  late: 'host',
  ring: 'host',
  clock: 'host',
  win: 'host',
  again: 'host',
  land: 'host',
  trainer: 'host',
  ticker: 'host',
  dresult: 'host',
  botout: 'host',
  botrec: 'host',

  place: 'self',
  step: 'self',
  face: 'self',
  challenge: 'self',
  accept: 'self',
  decline: 'self',
  bt: 'self',
  fled: 'self',
  pick: 'self',
  faint: 'self',
  out: 'self',
  pickup: 'self',
  spill: 'self',
  npcout: 'self',
  busy: 'self',
  shot: 'self',
  peek: 'self',
  ready: 'self',
  ping: 'self',
  pong: 'self',

  bstart: 'battle',
  turn: 'battle',

  party: 'bot',
  spent: 'bot',
  result: 'bot',
};

export interface TrustContext {
  /** The room's host, as the relay last said. Null with no room. */
  host: number | null;
  /** Who the relay lists in the room: anybody else a message names is a bot, or gone. */
  members: ReadonlySet<number>;
}

function seatOf(msg: Msg): number | undefined {
  return 'seat' in msg && typeof msg.seat === 'number' ? msg.seat : undefined;
}

/** May `from` have sent this? FALSE is a message to drop and count, not to act on. */
export function admits(msg: Msg, from: number, ctx: TrustContext): boolean {
  const host = ctx.host !== null && from === ctx.host;
  switch (TRUST[msg.t]) {
    case 'never':
      return false;
    case 'host':
      return host;
    case 'self':
      return host || seatOf(msg) === from;
    case 'battle': {
      if (msg.t !== 'bstart' && msg.t !== 'turn') return false;
      return host || battleSeats(msg.battle).includes(from);
    }
    case 'bot': {
      const seat = seatOf(msg);
      return host || seat === from || (seat !== undefined && !ctx.members.has(seat));
    }
    default:
      return false; // a type this table has never heard of
  }
}
