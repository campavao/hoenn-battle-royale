// Emerald's fishing (field_player_avatar.c's Task_Fishing), on the page's own field: the
// rod out, a second's wait, the dots, the bite (or not), A in time, another round or two
// for a better rod, and what came of it -- in the field's message box. The hidden ROM is
// only asked for the battle a hooked POKeMON starts (br_wild.h BR_WILD_ASKED_FISH).

/** wild_encounter.h's rods, as the ROM's fishing table takes them. */
export const OLD_ROD = 0, GOOD_ROD = 1, SUPER_ROD = 2;
export type Rod = 0 | 1 | 2;

/** items.h: ITEM_OLD_ROD, ITEM_GOOD_ROD, ITEM_SUPER_ROD. */
const ROD_ITEMS = [262, 263, 264];
/** The rod an item is, or -1 for none (gBrLevels.rod, what the bag holds). */
export function rodOf(item: number): Rod | -1 {
  const i = ROD_ITEMS.indexOf(item);
  return i < 0 ? -1 : (i as Rod);
}

// Fishing_GetRodOut's rounds, Fishing_WaitForA's reel time, Fishing_CheckMoreDots's odds
// (read with the rounds already counted, so a rod's first column is never the one asked).
const MIN_ROUNDS = [1, 3, 6];
const REEL = [36, 33, 30];
const MORE_DOTS = [[0, 0], [40, 10], [70, 30]];

export const TEXT_BITE = 'Oh! A bite!';
export const TEXT_HOOKED = "A POKéMON's on the hook!";
export const TEXT_NIBBLE = 'Not even a nibble…';
export const TEXT_AWAY = 'It got away…';

export type FishEnd = 'hooked' | 'nibble' | 'away';
/** The player's sprite: the rod coming out (and staying), the bite's tug, the rod away. */
export type FishAnim = 'out' | 'hooked' | 'away';

type Step = 'wait' | 'dots' | 'bite' | 'said';

export class Fishing {
  private step: Step = 'wait';
  private t = 0;
  private rounds = 0;
  private readonly minRounds: number;
  private dots = 0;
  private dotsWanted = 0;
  private bitten = false;
  private end: FishEnd | null = null;
  /** The sprite's animation and how many frames it has run. */
  anim: FishAnim = 'out';
  animT = 0;

  /** `hasMons`: the map has a fishing table (DoesCurrentMapHaveFishingMons). `random`:
   *  a 16-bit roll, as Random() gives. */
  constructor(private readonly rod: Rod, private readonly hasMons: boolean, private readonly random: () => number) {
    this.minRounds = 1 + (random() % MIN_ROUNDS[rod]);
  }

  /** The message box is up (Fishing_InitDots opens it, empty, for the dots). */
  get boxed(): boolean {
    return this.step !== 'wait';
  }

  /** The message box's words. */
  get text(): string {
    if (this.step === 'wait') return '';
    if (this.step === 'said') return this.end === 'hooked' ? TEXT_HOOKED : this.end === 'nibble' ? TEXT_NIBBLE : TEXT_AWAY;
    const dots = Array(this.dots).fill('·').join(' ');
    return this.bitten ? `${dots}\n${TEXT_BITE}` : dots;
  }

  /** One frame; `a` is A pressed this frame, `ok` A or B (a message's close). What the
   *  cast came to, once its message is closed; null while it is still going. */
  frame(a: boolean, ok = a): FishEnd | null {
    this.animT++;
    this.t++;
    switch (this.step) {
      case 'wait':
        // Fishing_WaitBeforeDots: one second with the rod out.
        if (this.t >= 60) this.round();
        return null;
      case 'dots':
        // Fishing_ShowDots: A too soon is nothing, or (a round on) the one that got away.
        if (a) { this.say(this.rounds === 0 ? 'nibble' : 'away'); return null; }
        if (this.t >= 20) {
          this.t = 0;
          if (this.dots < this.dotsWanted) { this.dots++; return null; }
          const first = this.rounds === 0;
          this.rounds++;
          // Fishing_CheckForBite, the first round only: no table, or the coin, is nothing.
          if (first && (!this.hasMons || this.random() & 1)) { this.say('nibble'); return null; }
          if (first) this.anim = 'hooked', this.animT = 0;
          this.bitten = true;
          this.step = 'bite';
        }
        return null;
      case 'bite':
        // Fishing_WaitForA, then Fishing_CheckMoreDots.
        if (this.t >= REEL[this.rod]) { this.say('away'); return null; }
        if (!a) return null;
        if (this.rounds < this.minRounds) this.round();
        else if (this.rounds < 2 && MORE_DOTS[this.rod][this.rounds] > this.random() % 100) this.round();
        else this.say('hooked');
        return null;
      case 'said':
        return ok && this.t > 1 ? this.end : null;
    }
  }

  /** Fishing_InitDots: a few more dots each round, four to ten the first. */
  private round(): void {
    const r = this.random() % 10;
    this.dotsWanted = Math.min(10, this.rounds === 0 ? r + 4 : r + 1);
    this.dots = 0;
    this.bitten = false;
    this.step = 'dots';
    this.t = 0;
  }

  private say(end: FishEnd): void {
    this.end = end;
    this.step = 'said';
    this.t = 0;
    // Fishing_NotEvenNibble / _GotAway put the rod away; a POKeMON on the hook keeps it out.
    if (end !== 'hooked') { this.anim = 'away'; this.animT = 0; }
  }
}

/** One frame of the fishing sheet (OBJ_EVENT_GFX_BRENDAN_FISHING: west 0-3, north 4-7,
 *  south 8-11; east is west flipped), and the sprite's nudge toward the water
 *  (AlignFishingAnimationFrames). Facing 1 S, 2 N, 3 W, 4 E. */
export function fishPose(anim: FishAnim, t: number, facing: number): { frame: number; flip: boolean; dx: number; dy: number } {
  const base = facing === 1 ? 8 : facing === 2 ? 4 : 0;
  let f: number;
  if (anim === 'out') {
    // sAnim_TakeOutRod*: four frames of four, then the last one held.
    f = base + Math.min(3, t >> 2);
  } else if (anim === 'away') {
    // sAnim_PutAwayRod*: back the other way, south and north slower after the first.
    const slow = facing === 1 || facing === 2;
    const at = slow ? (t < 4 ? 0 : Math.min(3, 1 + ((t - 4) / 6) | 0)) : Math.min(3, t >> 2);
    f = base + 3 - at;
  } else {
    // sAnim_HookedPokemon*: the tug twice, then held, round again.
    const c = t % 54;
    f = base + (c < 24 ? 2 + ((c / 6) & 1) : 3);
  }
  let dx = 0, dy = 0;
  if (f >= 1 && f <= 3) dx = facing === 3 ? -8 : 8;
  if (f === 5) dy = -8;
  if (f === 10 || f === 11) dy = 8;
  return { frame: f, flip: facing === 4, dx, dy };
}
