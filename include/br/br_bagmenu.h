#ifndef GUARD_BR_BAGMENU_H
#define GUARD_BR_BAGMENU_H

// A trainer's drop is one bag with their Pokemon in it (Cam, 2026-10-27: "we should just
// keep the Pokemon in the bag. Instead when clicking on a bag I guess it should give
// options for POKEMON and BAG. Pokemon brings you to this new trade screen. Bag brings
// you to an easy to pick up list w/ a quick action to take all"). The two boxes on the
// field for it; br_loot.c decides what is in the bag and what a choice does.

#define BR_BAGMENU_POKEMON 0
#define BR_BAGMENU_BAG     1

// POKeMON / BAG, for the bag under `key`. A pick calls BrLoot_BagChosen(key, choice);
// B, or anything that takes the field (a challenge, a fade), picks nothing.
void BrBagMenu_Choose(u16 key);

// The bag's items, `count` rows of (id u16 little-endian, n u8), with TAKE ALL on top.
// A takes a row's whole stack into the bag, or buzzes with no room; TAKE ALL takes
// every one that fits. Closing (B, the last row taken, or the field going away) calls
// BrLoot_BagListed with what is left, in the same layout.
void BrBagMenu_List(const u8 *rows, u8 count);

// A box is up.
bool8 BrBagMenu_Up(void);

#endif // GUARD_BR_BAGMENU_H
