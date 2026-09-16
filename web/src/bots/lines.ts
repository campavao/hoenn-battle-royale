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

/** How many voices a real player can cycle through in their profile (POK-243). A bot
 *  gets its three lines dealt independently from the match seed; a player is picking
 *  one ahead of any match, with nothing to seed off, so this is one index into all
 *  three pools at once rather than three separate rerolls. Sized to the longest pool
 *  so cycling reaches every line in it at least once. */
export const VOICE_COUNT = Math.max(INTRO.length, WIN.length, LOSE.length);

/** The voice at this index -- wraps, same as `nextSkin`. */
export function voiceOf(index: number): BotVoice {
  const i = ((index % VOICE_COUNT) + VOICE_COUNT) % VOICE_COUNT;
  return { intro: INTRO[i % INTRO.length], win: WIN[i % WIN.length], lose: LOSE[i % LOSE.length] };
}

export function nextVoice(index: number): number {
  return (index + 1) % VOICE_COUNT;
}
