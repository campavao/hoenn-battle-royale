// What a bot says (POK-239).
//
// Kanto deals every bot three lines from the seed -- one for walking up, one for
// winning, one for losing -- and they are most of what makes a room of eight strangers
// feel like eight people rather than eight sprites. The pool here keeps that voice and
// drops the Gen 1 references.
//
// They reach the screen as ticker `say` lines, which is the one text channel the ROM
// already draws (POK-226). Kanto put them in the battle intro; Hoenn's battle text is
// Emerald's own, so the feed is where they go until a fight has somewhere to put them.
import { mulberry32, pickIndex } from '../match/clock';
import minedLines from '../data/lines.json';

/** Every line fits the ticker with a name and a colon in front of it: BR_HUD_LINE_MAX
 *  is 40, a name is at most 7, so these stay under 30. Exported (POK-243) so a real
 *  player's profile can cycle through the same pool a bot is dealt from, rather than
 *  keeping a second copy of it. */
export const INTRO = [
  'YOU LOOK LOST.',
  'NICE TEAM. SHAME.',
  'I WAS HERE FIRST.',
  'THE FOG IS COMING.',
  'LET ME THROUGH!',
  'NO HARD FEELINGS.',
  'I NEED YOUR BALLS.',
  'THIS ROUTE IS MINE.',
  'YOU AGAIN?',
  'MAKE IT QUICK.',
  'I HAVE BEEN WALKING.',
  'FOUND YOU.',
];

export const WIN = [
  'TOLD YOU.',
  'THAT IS ONE MORE.',
  'BAD LUCK.',
  'I NEEDED THAT.',
  'STILL STANDING.',
  'NEXT!',
  'GOOD RUN THOUGH.',
  'THE RING IS MINE.',
];

export const LOSE = [
  'NOT LIKE THIS...',
  'TAKE THEM THEN.',
  'I WAS CLOSE.',
  'GOOD FIGHT.',
  'WATCH THE FOG.',
  'SEE YOU NEXT ONE.',
  'AT LEAST I WALKED.',
  'THAT IS ME DONE.',
];

export interface BotVoice {
  intro: string;
  win: string;
  lose: string;
}

/** A bot's three lines, dealt from the match seed and its seat -- so the same bot says
 *  the same things all match, and every client that cares can work them out without
 *  being told. */
export function voiceFor(seed: number, seat: number): BotVoice {
  const rng = mulberry32((seed ^ (seat * 0x2545f4)) >>> 0);
  return {
    intro: INTRO[pickIndex(rng, INTRO.length)],
    win: WIN[pickIndex(rng, WIN.length)],
    lose: LOSE[pickIndex(rng, LOSE.length)],
  };
}

/** What a POK-243 career's single `voice` number meant. Kept only so one can be read
 *  back as the three lines it resolved to (POK-283 split it); nothing picks one now. */
export const VOICE_COUNT = Math.max(INTRO.length, WIN.length, LOSE.length);

/** The voice at this index -- wraps, same as `nextSkin`. */
export function voiceOf(index: number): BotVoice {
  const i = ((index % VOICE_COUNT) + VOICE_COUNT) % VOICE_COUNT;
  return { intro: INTRO[i % INTRO.length], win: WIN[i % WIN.length], lose: LOSE[i % LOSE.length] };
}

// There is no nextVoice any more: MY VOICE cycles one line at a time now (POK-283's
// nextLine below), and a dead cycler over a pool nothing cycles is exactly the trap
// POK-303's `fame` was.

// ---- MY VOICE, the player's own three (POK-283) -----------------------------------
//
// Cam: "it should have three voices: your intro text, your win text -- what you say when
// you win -- and your lose text. And these should be a big list of essentially any NPC
// text in the game, so that you can use them however you want. But it's not like free
// text or anything."
//
// So: three INDEPENDENT picks out of ONE pool, rather than one index into three curated
// lists the way a bot is dealt. A bot keeps the curated lists above -- a bot should sound
// like a trainer, and a stray line from a shopkeeper is funnier on a person who chose it.
//
// `data/lines.json` is mined from the game's own text by tools/br/mine-lines.py; the
// hand-written pools go in front of it so the openers a bot might say are pickable too.
// Deduplicated, because a list with the same line twice reads as a bug while you cycle.
export const LINES: string[] = [...new Set([...INTRO, ...WIN, ...LOSE, ...(minedLines as string[])])];

export const LINE_COUNT = LINES.length;

/** The line at this index, wrapping -- the same shape as `voiceOf`. */
export function lineAt(index: number): string {
  return LINES[((index % LINE_COUNT) + LINE_COUNT) % LINE_COUNT];
}

export function nextLine(index: number): number {
  return (index + 1) % LINE_COUNT;
}

/** Where a line sits in the pool, for turning an old single-`voice` career into three
 *  (POK-283). -1 when the line is not in there at all, which a caller reads as 0. */
export function lineIndexOf(text: string): number {
  return LINES.indexOf(text);
}
