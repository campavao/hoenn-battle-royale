// The machines on the MOVES list (POK-279). See include/br/br_moves.h.
#include "global.h"
#include "main.h"
#include "event_data.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "overworld.h"
#include "palette.h"
#include "pokemon.h"
#include "item.h"
#include "item_menu.h"
#include "map_name_popup.h"
#include "party_menu.h"
#include "script.h"
#include "task.h"
#include "constants/item.h"
#include "constants/items.h"
#include "constants/pokemon.h"
#include "br/br_field.h"
#include "br/br_loot.h"
#include "br/br_moves.h"

static bool8 Listed(const u16 *moves, u8 count, u16 move)
{
    u8 i;

    for (i = 0; i < count; i++)
    {
        if (moves[i] == move)
            return TRUE;
    }
    return FALSE;
}

u8 BrMoves_AppendMachines(struct Pokemon *mon, u16 *moves, u8 count, u8 max)
{
    u16 i;

    for (i = 0; i < gBagPockets[TMHM_POCKET].capacity && count < max; i++)
    {
        u16 item = BagGetItemIdByPocketPosition(TMHM_POCKET + 1, i);
        u16 move;

        if (item == ITEM_NONE)
            continue;
        // TM01..HM08 are contiguous, so the learnset bit index is the same arithmetic
        // for an HM as for a TM.
        if (!CanMonLearnTMHM(mon, item - ITEM_TM01))
            continue;
        move = ItemIdToBattleMoveId(item);
        // A move it already has is not a move to learn, and the relearner's own list has
        // already dropped those -- but it never saw the machines, so this end has to.
        if (MonKnowsMove(mon, move) || Listed(moves, count, move))
            continue;
        moves[count++] = move;
    }
    return count;
}

u16 BrMoves_MachineFor(u16 move)
{
    u16 i;

    for (i = 0; i < gBagPockets[TMHM_POCKET].capacity; i++)
    {
        u16 item = BagGetItemIdByPocketPosition(TMHM_POCKET + 1, i);

        if (item != ITEM_NONE && ItemIdToBattleMoveId(item) == move)
            return item;
    }
    return ITEM_NONE;
}

bool8 BrMoves_HasAny(struct Pokemon *mon)
{
    u16 moves[1];

    if (GetNumberOfRelearnableMoves(mon) > 0)
        return TRUE;
    return BrMoves_AppendMachines(mon, moves, 0, 1) > 0;
}

void BrMoves_Spend(u16 move)
{
    u16 item = BrMoves_MachineFor(move);

    // party_menu.c's Task_LearnedMove rule, verbatim: a TM is consumed by teaching and
    // an HM is a tool. The machines are contiguous, so `< ITEM_HM01` is the whole test.
    if (item != ITEM_NONE && item < ITEM_HM01)
        RemoveBagItem(item, 1);
}

// The TM that teaches `move`, whether or not anybody has one, or ITEM_NONE.
static u16 MachineOf(u16 move)
{
    u16 item;

    for (item = ITEM_TM01; item < ITEM_HM01; item++)
    {
        if (ItemIdToBattleMoveId(item) == move)
            return item;
    }
    return ITEM_NONE;
}

// Would it know this by now without anybody's help: in its learnset at or under its
// level. Every wild mon in a match is taught that way and no other (BrLevels_Settle), so
// what is left over came from a TM -- ours, or a trainer's (br_moves.h).
static bool8 LearnsByNow(struct Pokemon *mon, u16 move)
{
    const u16 *learnset = gLevelUpLearnsets[GetMonData(mon, MON_DATA_SPECIES, NULL)];
    u8 level = GetMonData(mon, MON_DATA_LEVEL, NULL);
    u16 i;

    for (i = 0; learnset[i] != LEVEL_UP_END; i++)
    {
        if ((learnset[i] & LEVEL_UP_MOVE_ID) == move
         && ((learnset[i] & LEVEL_UP_MOVE_LV) >> 9) <= level)
            return TRUE;
    }
    return FALSE;
}

void BrMoves_Forgetting(struct Pokemon *mon, u8 slot)
{
    u16 move, item;

    if (slot >= MAX_MON_MOVES)
        return;
    move = GetMonData(mon, MON_DATA_MOVE1 + slot, NULL);
    item = MachineOf(move);
    if (item == ITEM_NONE || LearnsByNow(mon, move))
        return;
    BrLoot_DropItem(item);
}

// The TM waiting for the teach screen (ITEM_NONE: none), how many the bag held when it
// was armed, the frames it has waited, and whether the party screen up now is the one
// opened for it. The screen opens only once the bag holds one more than it did: a pickup
// that never lands (no room, a GIVE bounced) times out instead of opening later for a
// copy the player already had. One TM at a time; a second armed first wins the slot and
// the earlier one just stays in the bag.
static EWRAM_DATA u16 sTeach = ITEM_NONE;
static EWRAM_DATA u16 sTeachHad = 0;
static EWRAM_DATA u16 sTeachAge = 0;
static EWRAM_DATA bool8 sTeaching = FALSE;

#define TEACH_WAIT_FRAMES (60 * 15) // a GIVE's round trip, and the found-item jingle

bool8 BrMoves_IsTm(u16 item)
{
    return item >= ITEM_TM01 && item < ITEM_HM01;
}

bool8 BrMoves_Teachable(u16 item)
{
    u16 move = ItemIdToBattleMoveId(item);
    u8 i;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        struct Pokemon *mon = &gPlayerParty[i];

        if (GetMonData(mon, MON_DATA_SPECIES, NULL) == SPECIES_NONE || GetMonData(mon, MON_DATA_IS_EGG, NULL))
            continue;
        if (CanMonLearnTMHM(mon, item - ITEM_TM01) && !MonKnowsMove(mon, move))
            return TRUE;
    }
    return FALSE;
}

// Before the TM goes in the bag.
void BrMoves_TeachSoon(u16 item)
{
    sTeach = item;
    sTeachHad = CountTotalItemQuantityInBag(item);
    sTeachAge = 0;
}

static void Task_OpenTeach(u8 taskId)
{
    if (gPaletteFade.active)
        return;
    DestroyTask(taskId);
    if (gMain.callback2 != CB2_Overworld || ScriptContext_IsEnabled())
    {
        // Something took the field during the fade: try again once it is ours. A new
        // screen owns the fade and the controls; a script locked them itself and its end
        // unlocks them.
        sTeach = gSpecialVar_ItemId;
        sTeachHad = CountTotalItemQuantityInBag(sTeach) - 1;
        sTeachAge = 0;
        if (gMain.callback2 == CB2_Overworld)
            FadeScreen(FADE_FROM_BLACK, 0);
        return;
    }
    sTeaching = TRUE;
    CleanupOverworldWindowsAndTilemaps();
    SetMainCallback2(CB2_ShowPartyMenuForItemUse);
}

// When the field is ours: no script, nobody holding the controls, standing still. A TM
// out of a bag arrives with the bag's GIVE, a frame or more after the press, so it waits
// for the bag to have it too.
void BrMoves_Tick(void)
{
    if (sTeach == ITEM_NONE)
        return;
    if (CountTotalItemQuantityInBag(sTeach) <= sTeachHad)
    {
        if (++sTeachAge >= TEACH_WAIT_FRAMES)
            sTeach = ITEM_NONE;
        return;
    }
    if (!BrField_OverworldRunning())
        return;
    if (ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked() || !IsPlayerStandingStill())
        return;
    gSpecialVar_ItemId = sTeach;
    sTeach = ITEM_NONE;
    gItemUseCB = ItemUseCB_TMHM;
    PlayRainStoppingSoundEffect();
    HideMapNamePopUpWindow();
    LockPlayerFieldControls();
    FadeScreen(FADE_TO_BLACK, 0);
    CreateTask(Task_OpenTeach, 10);
}

static void CB2_TeachDone(void)
{
    gFieldCallback = FieldCB_ReturnToFieldNoScript;
    SetMainCallback2(CB2_ReturnToField);
}

MainCallback BrMoves_TeachExit(MainCallback callback)
{
    if (!sTeaching)
        return callback;
    sTeaching = FALSE;
    return CB2_TeachDone;
}
