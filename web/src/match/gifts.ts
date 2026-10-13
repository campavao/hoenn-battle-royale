// Gift-givers (Cam, 2026-10-13: "we can add some gift giving NPCs"). The host deals one to
// every town and city at the buzzer: a person standing on a free cell, holding one held
// item. On the wire he is a `spill` of a one-item bag under a gift key, so the ROM stands
// him there (br_loot.c draws a gift key as a person), A on him takes it like any bag, and
// the PICKUP of his key takes him off every map -- first trainer there, Cam's rule for the
// traders too. A late joiner gets the ones still standing with the rest of the ground, and
// a bot walks up to one on its map like any other piece.
import { MAP_OFFSET } from '../net/cells';
import type { MapRef, Msg } from '../net/wire';
import { pickIndex } from './clock';

/** `BR_LOOT_KEY_GIFT_BASE` (include/br/br_loot.h). */
export const GIFT_KEY_BASE = 0xc000;
export const giftKey = (i: number): number => GIFT_KEY_BASE | i;
export const isGiftKey = (key: number): boolean => (key & 0xf000) === GIFT_KEY_BASE;

// include/constants/items.h: the held items a trainer would walk into a town for.
const ITEM_BRIGHT_POWDER = 179;
const ITEM_WHITE_HERB = 180;
const ITEM_QUICK_CLAW = 183;
const ITEM_CHOICE_BAND = 186;
const ITEM_KINGS_ROCK = 187;
const ITEM_FOCUS_BAND = 196;
const ITEM_SCOPE_LENS = 198;
const ITEM_LEFTOVERS = 200;
const ITEM_SHELL_BELL = 219;
export const GIFTS: readonly number[] = [
  ITEM_BRIGHT_POWDER,
  ITEM_WHITE_HERB,
  ITEM_QUICK_CLAW,
  ITEM_CHOICE_BAND,
  ITEM_KINGS_ROCK,
  ITEM_FOCUS_BAND,
  ITEM_SCOPE_LENS,
  ITEM_LEFTOVERS,
  ITEM_SHELL_BELL,
];

/** The sections a gift-giver stands in: every town and city on the region map. */
export const isGiftSection = (id: string): boolean => /^MAPSEC_\w+_(TOWN|CITY)$/.test(id);

/** One gift: where he stands, in the page's space (landing.json's), and on which map. */
export interface GiftSpot {
  map: MapRef;
  x: number;
  y: number;
}

/** The gifts, as the messages that put them on the ground: one `spill` each, a bag of one
 *  item, under the host's seat. `spots[i]` is the i-th town's, and its key is giftKey(i). */
export function giftDrop(rng: () => number, seat: number, spots: GiftSpot[]): Msg[] {
  return spots.map((s, i) => ({
    t: 'spill',
    seat,
    map: s.map,
    mons: [],
    bag: {
      key: giftKey(i),
      x: s.x + MAP_OFFSET,
      y: s.y + MAP_OFFSET,
      items: [{ id: GIFTS[pickIndex(rng, GIFTS.length)], n: 1 }],
      money: 0,
    },
  }));
}
