// The ticker's lines (POK-226's window, finally given something to say).
//
// The ROM has drawn a ticker since POK-226 and nothing has ever sent it a line, so a
// match has been silent: people vanish, the fog closes, somebody wins, and the only way
// to know any of it was to be looking at the right corner of the HUD. Kanto's ticker is
// where a battle royale gets its pulse -- who just beat whom, how many are left, the
// fog about to move -- and this is that, as lines.
//
// And then it said so much that nobody read it (POK-324): in one minute of Cam's
// play-test, two fog-sweep tallies, a level line, an out and the ring's box, and he
// ignored all of them. So a line is something the player acts on or would ask about:
// who is out and how many are left (outs that land together as one line), the ring
// (the ROM's one line and its box), a gym falling, the DAY CARE emptied, what the
// trainer you are watching picked up, the opening and the win. Tallies go to the log,
// a bot's intro goes to the player it walked up to, and two bots fighting is one line.
//
// Every line is at most BR_HUD_LINE_MAX (40) Gen 3 characters, because that is what the
// window draws; a longer one is not truncated somewhere clever, it is not written.
import type { TickerMsg } from '../net/wire';

/** BR_HUD_LINE_MAX in include/br/br_hud.h. */
export const LINE_MAX = 40;

/** A trainer's name as a line can carry it. Emerald's own limit is 7, and a ticker
 *  line with two names in it has to fit both. */
export function short(name: string): string {
  const trimmed = name.trim().toUpperCase();
  return (trimmed.length > 0 ? trimmed : 'TRAINER').slice(0, 7);
}

function line(seat: number, text: string, kind?: TickerMsg['kind']): TickerMsg | null {
  const t = text.slice(0, LINE_MAX);
  return t.length > 0 ? { t: 'ticker', seat, kind, text: t } : null;
}

/** The opening. Everybody is in the Zone with a few balls and a clock. */
export function opening(seat: number, secs: number): TickerMsg | null {
  return line(seat, `CATCH WHAT YOU CAN! ${secs}s`);
}

/** A trainer's own words -- a bot's dealt line (POK-239), or a player's chat. The
 *  ticker's `say` kind, which is the one text channel that reaches the ROM's screen. */
export function said(seat: number, name: string, text: string): TickerMsg | null {
  return line(seat, `${short(name)}: ${text}`, 'say');
}

/** BR_VOICE_LEN in include/br/br_battle.h: what the ROM keeps of each battle line. */
export const VOICE_MAX = 30;

/** A trainer's three lines for the player about to fight them (2026-10-05 play-test:
 *  "the chosen text should show in battle"). Not ticker lines: the ROM keeps them for
 *  that one seat, says the intro after "would like to battle!", and the win or the lose
 *  line when the fight ends (br_battle.c). */
export function voice(seat: number, lines: { intro?: string; win?: string; lose?: string }): TickerMsg[] {
  const out: TickerMsg[] = [];
  for (const kind of ['intro', 'win', 'lose'] as const) {
    const text = (lines[kind] ?? '').trim().slice(0, VOICE_MAX);
    if (text.length > 0) out.push({ t: 'ticker', seat, kind, text });
  }
  return out;
}

/** What the trainer you are watching just picked up (POK-268). Kanto tells a spectator
 *  when the bot they are following catches something (v0.48.0); Hoenn's bots are dealt
 *  their teams rather than catching, so the moment worth reporting is the one where
 *  they take something off the ground.
 *
 *  Drawn by the watcher's own page, not sent: a `pickup` reaches everybody, and only
 *  the page following that seat has any business saying so. */
export function took(seat: number, name: string, what: string): TickerMsg | null {
  return line(seat, `${short(name)} TOOK ${what}`, 'say');
}

/** BR_CHEST_KEY in src/br/br_zone.c: the one piece of loot a match starts with. */
export const CHEST_KEY = 0x8e00;

/** Somebody got to the DAY CARE first (POK-306). Everybody else finds an empty room, and
 *  this is how they learn whose fault that is before they cross the map for it.
 *
 *  Drawn by each page off the `pickup` that already reaches the room, like took(). It
 *  does not name what was in there: the chest is dealt inside the ROM off the match seed
 *  and the page's loot table never sees it land. */
export function chest(seat: number, name: string): TickerMsg | null {
  return line(seat, `${short(name)} EMPTIED THE DAY CARE!`);
}

/** A gym leader fell (POK-295). A gym is a contested landmark and the first to beat it
 *  closes it for everybody, so everybody hears: the beater's own page and every peer's
 *  draw this off the same `npcout` (match/bosses.ts). The boss's name is not cut -- it is
 *  ours, and TATE&LIZA is nine. */
export function felled(seat: number, name: string, boss: string): TickerMsg | null {
  return line(seat, `${short(name)} BEAT ${boss}!`, 'kill');
}

/** Somebody is out, however it happened, and how many are left after it. */
export function out(seat: number, name: string, left: number): TickerMsg | null {
  return outs(seat, [name], left);
}

/** Everybody who went out together, as one line (POK-324), and how many are left after
 *  them. `by` is who beat a lone one, when two bots fought it out: the kill feed and the
 *  count in one line, where it was four -- a win, two chat lines and the out -- for a
 *  fight nobody saw. Every name is cut before the line is built, so the worst case,
 *  `ABCDEFG AND HIJKLMN ARE OUT - 32 LEFT`, is 37. */
export function outs(seat: number, names: string[], left: number, by?: string): TickerMsg | null {
  if (names.length === 0) return null;
  const who =
    names.length === 1
      ? by !== undefined
        ? `${short(by)} BEAT ${short(names[0])}`
        : `${short(names[0])} IS OUT`
      : names.length === 2
        ? `${short(names[0])} AND ${short(names[1])} ARE OUT`
        : `${short(names[0])} AND ${names.length - 1} MORE ARE OUT`;
  return line(seat, left > 0 ? `${who} - ${left} LEFT` : `${who}!`, 'kill');
}

/** The winner. */
export function won(seat: number, name: string): TickerMsg | null {
  return line(seat, `${short(name)} WINS!`);
}

/** How long outs gather before they go out as one line (POK-324). */
export const OUT_BATCH_MS = 1500;

/** At this many left or fewer every out is its own line, at once: the endgame's count is
 *  the news, and the last out has to land before the win does. */
export const OUT_BATCH_UNTIL = 3;

/** The outs, as the ticker says them: gathered for OUT_BATCH_MS while more than
 *  OUT_BATCH_UNTIL are left, so a ring that takes five bots on one tick is one line, not
 *  five. The count is read when the line goes, so it is the count after all of them. */
export class OutFeed {
  private pending: number[] = [];
  private readonly by = new Map<number, number>();
  private cancel: (() => void) | null = null;

  constructor(
    private readonly o: {
      say: (msg: TickerMsg | null) => void;
      nameOf: (seat: number) => string;
      /** How many are still in, with every out so far counted. */
      left: () => number;
    },
  ) {}

  /** Two bots settled it: `loser`'s out says who did it, when it goes out alone. */
  beat(winner: number, loser: number): void {
    this.by.set(loser, winner);
  }

  /** Somebody is out. Held until settle(), which the caller runs once the director has
   *  counted it -- or until flush(), which the director's `win` runs first. */
  add(seat: number): void {
    this.pending.push(seat);
  }

  /** The line now, when few enough are left; otherwise the batch's timer, if it has none. */
  settle(): void {
    if (this.pending.length === 0) return;
    if (this.o.left() <= OUT_BATCH_UNTIL) {
      this.flush();
      return;
    }
    if (this.cancel) return;
    const id = setTimeout(() => {
      this.cancel = null;
      this.flush();
    }, OUT_BATCH_MS);
    this.cancel = () => clearTimeout(id);
  }

  /** Whatever is gathered, as one line, now. */
  flush(): void {
    this.cancel?.();
    this.cancel = null;
    if (this.pending.length === 0) return;
    const seats = this.pending;
    this.pending = [];
    const by = seats.length === 1 ? this.by.get(seats[0]) : undefined;
    for (const seat of seats) this.by.delete(seat);
    const { nameOf } = this.o;
    this.o.say(outs(seats[0], seats.map(nameOf), this.o.left(), by === undefined ? undefined : nameOf(by)));
  }

  /** Let go without a word: a page that stands down leaves the match's narration to its
   *  heir, whose catch-up carries the `out`s themselves. */
  dispose(): void {
    this.cancel?.();
    this.cancel = null;
    this.pending = [];
    this.by.clear();
  }
}

/** The page's end of the ticker: a line identical to the last one sent is dropped, as
 *  Kanto's Ticker.push drops one (lib/ticker.lua) -- a beat two paths both announce is
 *  one line. */
export function once(send: (msg: TickerMsg) => void): (msg: TickerMsg | null) => void {
  let last: string | undefined;
  return (msg) => {
    if (!msg || msg.text === last) return;
    last = msg.text;
    send(msg);
  };
}
