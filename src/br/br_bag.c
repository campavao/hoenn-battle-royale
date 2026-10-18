#include "global.h"
#include "item.h"
#include "item_menu.h"
#include "menu.h"
#include "list_menu.h"
#include "constants/items.h"
#include "br/br_bag.h"

EWRAM_DATA struct BrBag gBrBag = {0};

// The pick has chosen its row and waits for its context menu.
static EWRAM_DATA bool8 sUsing = FALSE;

s32 BrBag_PickRow(s32 listPosition)
{
    struct BagPocket *pocket;
    u16 item = gBrBag.pick;
    u16 i, row = 0;

    // A bag with no pick in it, or not a battle's, owes no USE: a pick whose bag was
    // torn down before its context menu (the shot clock's backout) is let go here.
    if (item == ITEM_NONE || gBagPosition.location != ITEMMENULOCATION_BATTLE)
    {
        sUsing = FALSE;
        return listPosition;
    }
    gBrBag.pick = ITEM_NONE;
    pocket = &gBagPockets[gBagPosition.pocket];
    for (i = 0; i < pocket->capacity; i++)
    {
        if (pocket->itemSlots[i].itemId == item)
        {
            sUsing = TRUE;
            return row;
        }
        // The list skips an empty slot, so its rows are the stacks before this one. (The
        // bag compacts a pocket as it opens, so the row is also the slot that
        // BagGetItemIdByPocketPosition reads.)
        if (pocket->itemSlots[i].itemId != ITEM_NONE)
            row++;
    }
    return listPosition;
}

s8 BrBag_PickUse(s8 selection)
{
    if (!sUsing || gBagPosition.location != ITEMMENULOCATION_BATTLE)
        return selection;
    sUsing = FALSE;
    return 0;
}

void BrBag_Forget(void)
{
    gBrBag.pick = ITEM_NONE;
    sUsing = FALSE;
}
