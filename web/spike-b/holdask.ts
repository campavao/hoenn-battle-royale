// Cam, 2026-11-21: "Picking up a berry should prompt you to give to a pokemon to hold."
// A berry off the ground asks first, YES or NO, before the party: the GIFTS (the held items
// a person hands over) and TMs go straight to the party as before, and everything else
// straight to the bag.

/** include/constants/items.h. */
const ITEM_CHERI_BERRY = 133, ITEM_IAPAPA_BERRY = 147, ITEM_LIECHI_BERRY = 168, ITEM_STARF_BERRY = 174;

/** A berry a POKeMON does something with when it holds it: CHERI..IAPAPA (a cure, HP, PP, the
 *  confusing five) and LIECHI..STARF (a stat at a pinch). src/data/items.h gives these a
 *  holdEffect; RAZZ..BELUE are Pokeblock berries and ENIGMA's is the e-Reader's, none in
 *  Emerald, so held they do nothing and are not asked about. */
export function asksToHold(item: number): boolean {
  return (item >= ITEM_CHERI_BERRY && item <= ITEM_IAPAPA_BERRY) || (item >= ITEM_LIECHI_BERRY && item <= ITEM_STARF_BERRY);
}

/** The question, as party_menu.c would put it. */
export const holdQuestion = (item: string): string => `Give the ${item} to a POKéMON to hold?`;
/** party_menu.c's gText_PkmnAlreadyHoldingItemSwitch, cut to the askbox's two lines: its own
 *  "Would you like to switch..." is a second page there, and the box has one. */
export const switchQuestion = (mon: string, held: string): string => `${mon} is already holding one ${held}. Switch the two items?`;
/** gText_PkmnWasGivenItem. */
export const givenLine = (mon: string, item: string): string => `${mon} was given the ${item} to hold.`;
/** gText_SwitchedPkmnItem. */
export const switchedLine = (item: string, held: string): string => `The ${held} was taken and replaced with the ${item}.`;
