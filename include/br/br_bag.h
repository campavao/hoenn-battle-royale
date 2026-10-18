#ifndef GUARD_BR_BAG_H
#define GUARD_BR_BAG_H

#include "global.h"

// The phone's bag (Cam's mockup v3, approved 2026-10-14). In a battle the page draws its
// own BAG over the pad -- pockets, icons, the description box, only what can be used
// now -- and a USE there is the ROM's own BAG doing it: the page writes the item here
// and the pocket into gBagPosition, presses BAG, and the bag that opens picks that row
// and USE by itself. From there it is pret's: a ball is thrown, a potion asks which
// POKeMON on the party screen, an item that cannot be used says so in the bag.
struct BrBag
{
    /* 0 */ u16 pick; // the item the page chose; ITEM_NONE once it has been taken
};
extern struct BrBag gBrBag;

// Task_BagMenu_HandleInput, after the list read the keys: the picked item's row in the
// open pocket when a pick is waiting in a battle's bag, else `listPosition` as it was.
// A pick not in this pocket is dropped, and the bag is the player's to drive.
s32 BrBag_PickRow(s32 listPosition);

// Task_ItemContext_SingleRow: USE (row 0) for the pick that opened this context menu,
// else `selection` as it was.
s8 BrBag_PickUse(s8 selection);

// A new action menu: whatever the last one's BAG press left waiting is let go. The page
// writes its pick as that press goes down; a bag that then never opened (the shot clock
// on the same frame, the battle over) must not USE it in the next one the player opens.
void BrBag_Forget(void);

#endif // GUARD_BR_BAG_H
