// The ticker's lines (POK-226's window, finally given something to say).
//
// The ROM has drawn a ticker since POK-226 and nothing has ever sent it a line, so a
// match has been silent: people vanish, the fog closes, somebody wins, and the only way
// to know any of it was to be looking at the right corner of the HUD. Kanto's ticker is
// where a battle royale gets its pulse -- who just beat whom, how many are left, the
// fog about to move -- and this is that, as lines.
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

/** The drop: the opening is over and the match proper starts. */
export function dropped(seat: number, count: number): TickerMsg | null {
  return line(seat, `${count} TRAINERS ARE LOOSE IN HOENN!`);
}

/** The fog moved. Phase 1 is the first close; the last one closes on everything. */
export function fog(seat: number, phase: number, last: boolean): TickerMsg | null {
  return line(seat, last ? 'THE FOG TAKES EVERYTHING!' : `THE FOG CLOSES IN! (${phase})`);
}

/** One trainer beat another. The kill feed, which is the line people actually read. */
export function beat(seat: number, winner: string, loser: string): TickerMsg | null {
  return line(seat, `${short(winner)} BEAT ${short(loser)}!`, 'kill');
}

/** A trainer's own words -- a bot's dealt line (POK-239), or a player's chat. The
 *  ticker's `say` kind, which is the one text channel that reaches the ROM's screen. */
export function said(seat: number, name: string, text: string): TickerMsg | null {
  return line(seat, `${short(name)}: ${text}`, 'say');
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
  if (left <= 0) return line(seat, `${short(name)} IS OUT!`, 'kill');
  return line(seat, `${short(name)} IS OUT - ${left} LEFT`, 'kill');
}

/** Down to the last few: the match's own countdown, and the cue to go hunting. */
export function fewLeft(seat: number, left: number): TickerMsg | null {
  return line(seat, `${left} LEFT!`);
}

/** The winner. */
export function won(seat: number, name: string): TickerMsg | null {
  return line(seat, `${short(name)} WINS!`);
}
