import { describe, expect, it } from 'vitest';
import { asksToHold, givenLine, switchQuestion, switchedLine } from './holdask';
import { wrapText } from '../src/ui/emerald';
import { GIFTS } from '../src/match/gifts';

// include/constants/items.h
const ITEM_POTION = 13, ITEM_ORAN_BERRY = 139, ITEM_CHERI_BERRY = 133, ITEM_IAPAPA_BERRY = 147, ITEM_RAZZ_BERRY = 148;
const ITEM_BELUE_BERRY = 167, ITEM_LIECHI_BERRY = 168, ITEM_SITRUS_BERRY = 142, ITEM_STARF_BERRY = 174, ITEM_ENIGMA_BERRY = 175;
const ITEM_BERRY_JUICE = 44, ITEM_ROYALE_BALL = 4, ITEM_TM06 = 294, ITEM_HM01 = 339, ITEM_NUGGET = 110;

describe('which pickups ask to hold', () => {
  it('a berry with a hold effect asks', () => {
    for (const id of [ITEM_ORAN_BERRY, ITEM_SITRUS_BERRY, ITEM_CHERI_BERRY, ITEM_IAPAPA_BERRY, ITEM_LIECHI_BERRY, ITEM_STARF_BERRY]) expect(asksToHold(id), String(id)).toBe(true);
  });
  it('a berry that does nothing held does not (RAZZ..BELUE, ENIGMA)', () => {
    for (const id of [ITEM_RAZZ_BERRY, ITEM_BELUE_BERRY, ITEM_ENIGMA_BERRY]) expect(asksToHold(id), String(id)).toBe(false);
  });
  it('nothing else asks: medicine, balls, machines, sell items, BERRY JUICE', () => {
    for (const id of [0, ITEM_POTION, ITEM_BERRY_JUICE, ITEM_ROYALE_BALL, ITEM_TM06, ITEM_HM01, ITEM_NUGGET]) expect(asksToHold(id), String(id)).toBe(false);
  });
  it('the held GIFTS keep their own straight-to-the-party screen', () => {
    for (const id of GIFTS) expect(asksToHold(id), String(id)).toBe(false);
  });
  it("says it in party_menu.c's words", () => {
    expect(givenLine('MUDKIP', 'ORAN BERRY')).toBe('MUDKIP was given the ORAN BERRY to hold.');
    expect(switchedLine('ORAN BERRY', 'LEFTOVERS')).toBe('The LEFTOVERS was taken and replaced with the ORAN BERRY.');
  });
  it("every question fits the askbox's two lines, the widest names and items in it", () => {
    // askbox.ts: the message box's inside, MSG.w - 4 tiles. Its first try at the switch said
    // "...Would you like to switch" and lost "the two items?" off the end.
    const inside = 29 * 8 - 4 * 8;
    const lines = (t: string) => t.split('\n').flatMap((p) => wrapText(p, inside)).length;
    const mons = ['FERALIGATR', 'CHARMELEON', 'MMMMMMMMMM'];
    const items = ['BRIGHTPOWDER', 'BLACKGLASSES', 'SITRUS BERRY', 'PETAYA BERRY'];
    for (const m of mons) for (const h of items) expect(lines(switchQuestion(m, h)), `${m} ${h}`).toBeLessThanOrEqual(2);
  });
});
