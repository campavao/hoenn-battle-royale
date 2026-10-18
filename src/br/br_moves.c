// The machines on the MOVES list (POK-279). See include/br/br_moves.h.
#include "global.h"
#include "main.h"
#include "data.h"
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
#include "br/br_hud.h"
#include "br/br_loot.h"
#include "br/br_moves.h"

static void SayKept(u16 item);

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
    // Back in the bag, where MOVES on any teammate offers it (Cam, 2026-10-17: "make
    // swapping moves among pokemon also easy"). One copy each, as off the ground: a second
    // goes down for somebody else, and so does one the pocket has no room for.
    if (!CheckBagHasItem(item, 1) && AddBagItem(item, 1))
        SayKept(item);
    else
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
static EWRAM_DATA u16 sTeachItem = ITEM_NONE; // the TM the screen up now is for
static EWRAM_DATA u16 sTeachCount = 0;        // and how many the bag held as it opened

#define TEACH_WAIT_FRAMES (60 * 15) // a GIVE's round trip, and the found-item jingle

EWRAM_DATA struct BrAsk gBrAsk = {0};

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

// data[0]: the TM, kept here rather than read back from gSpecialVar_ItemId, which a
// script that took the field during the fade may have written.
static void Task_OpenTeach(u8 taskId)
{
    u16 item = gTasks[taskId].data[0];

    if (gPaletteFade.active)
        return;
    DestroyTask(taskId);
    if (gMain.callback2 != CB2_Overworld || ScriptContext_IsEnabled())
    {
        // Something took the field during the fade: try again once it is ours. Our lock
        // goes (a running script re-locks every frame it runs, and a new screen hands
        // the field back through its own field callback); a new screen owns the fade.
        sTeach = item;
        sTeachHad = CountTotalItemQuantityInBag(item) - 1;
        sTeachAge = 0;
        UnlockPlayerFieldControls();
        if (gMain.callback2 == CB2_Overworld)
            FadeScreen(FADE_FROM_BLACK, 0);
        return;
    }
    gSpecialVar_ItemId = item;
    gItemUseCB = ItemUseCB_TMHM;
    sTeaching = TRUE;
    sTeachItem = item;
    sTeachCount = CountTotalItemQuantityInBag(item);
    CleanupOverworldWindowsAndTilemaps();
    SetMainCallback2(CB2_ShowPartyMenuForItemUse);
}

void BrMoves_AskFrom(u8 slot, u8 from, u8 count)
{
    if (slot >= PARTY_SIZE || gBrAsk.off)
        return;
    if (gBrAsk.count != count)
    {
        u8 i;

        for (i = 0; i < PARTY_SIZE; i++)
            gBrAsk.from[i] = 0;
        gBrAsk.count = count;
    }
    // A second lift before the first was asked about asks about both.
    if (gBrAsk.from[slot] == 0 || from < gBrAsk.from[slot])
        gBrAsk.from[slot] = from;
}

static void ClearAsks(void)
{
    u8 i;

    for (i = 0; i < PARTY_SIZE; i++)
        gBrAsk.from[i] = 0;
}

// `peek`: only whether there is a question, leaving it to be asked. A move a free slot
// takes is learnt either way.
static bool8 FindAsk(u8 *slot, u16 *move, bool8 peek)
{
    u8 i, count = CalculatePlayerPartyCount();

    if (count != gBrAsk.count)
    {
        ClearAsks();
        return FALSE;
    }
    for (i = 0; i < count; i++)
    {
        struct Pokemon *mon = &gPlayerParty[i];
        const u16 *learnset = gLevelUpLearnsets[GetMonData(mon, MON_DATA_SPECIES)];
        u8 level = GetMonData(mon, MON_DATA_LEVEL);
        u16 j;

        if (gBrAsk.from[i] == 0)
            continue;
        for (j = 0; learnset[j] != LEVEL_UP_END; j++)
        {
            u8 at = (learnset[j] & LEVEL_UP_MOVE_LV) >> 9;
            u16 id = learnset[j] & LEVEL_UP_MOVE_ID;

            if (at <= gBrAsk.from[i] || at > level || MonKnowsMove(mon, id))
                continue;
            if (GiveMoveToMon(mon, id) != MON_HAS_MAX_MOVES)
            {
                gBrAsk.from[i] = at;
                continue; // a slot came free since the lift: it just learns it
            }
            // Asked once: the next question starts past this level, learnt or not.
            if (!peek)
                gBrAsk.from[i] = at;
            *slot = i;
            *move = id;
            return TRUE;
        }
        gBrAsk.from[i] = 0;
    }
    return FALSE;
}

bool8 BrMoves_NextAsk(u8 *slot, u16 *move)
{
    return FindAsk(slot, move, FALSE);
}

static bool8 AskPending(void)
{
    u8 i;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (gBrAsk.from[i] != 0)
            return TRUE;
    }
    return FALSE;
}

static void Task_OpenAsk(u8 taskId)
{
    if (gPaletteFade.active)
        return;
    DestroyTask(taskId);
    if (gMain.callback2 != CB2_Overworld || ScriptContext_IsEnabled())
    {
        // Something took the field during the fade: BrMoves_Tick asks again once it is
        // ours, the questions still waiting.
        UnlockPlayerFieldControls();
        if (gMain.callback2 == CB2_Overworld)
            FadeScreen(FADE_FROM_BLACK, 0);
        return;
    }
    CleanupOverworldWindowsAndTilemaps();
    SetMainCallback2(CB2_BrAskLearn);
}

// When the field is ours: no script, nobody holding the controls, standing still. A TM
// out of a bag arrives with the bag's GIVE, a frame or more after the press, so it waits
// for the bag to have it too.
void BrMoves_Tick(void)
{
    // The questions a lift left, before a TM's: the TM waits in the bag either way.
    if (sTeach == ITEM_NONE && AskPending())
    {
        u8 slot;
        u16 move;

        if (!BrField_OverworldRunning() || gMain.inBattle)
            return;
        if (ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked() || !IsPlayerStandingStill())
            return;
        // A lift whose new moves all found a free slot (or the party changed) has nothing
        // to ask: no fade into a party screen that closes at once.
        if (!FindAsk(&slot, &move, TRUE))
            return;
        PlayRainStoppingSoundEffect();
        HideMapNamePopUpWindow();
        LockPlayerFieldControls();
        FadeScreen(FADE_TO_BLACK, 0);
        CreateTask(Task_OpenAsk, 10);
        return;
    }
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
    PlayRainStoppingSoundEffect();
    HideMapNamePopUpWindow();
    LockPlayerFieldControls();
    FadeScreen(FADE_TO_BLACK, 0);
    gTasks[CreateTask(Task_OpenTeach, 10)].data[0] = sTeach;
    sTeach = ITEM_NONE;
}


static const u8 sText_WentInBag[] = _(" went in the BAG.");

// Cancelled with nobody taught: the TM stays in the bag to teach later (Cam's 2026-10-14
// play-test, POK-353), and the ticker says so rather than it vanishing without a word.
static void SayKept(u16 item)
{
    u8 line[BR_HUD_LINE_MAX + 2];
    u8 *last = line + BR_HUD_LINE_MAX;
    u8 *p;

    p = BrHud_Append(line, last, gMoveNames[ItemIdToBattleMoveId(item)]);
    BrHud_Append(p, last, sText_WentInBag);
    BrHud_Say(line);
}

// The party screen's exit, taught or not.
static void CB2_TeachDone(void)
{
    if (sTeachItem != ITEM_NONE && CountTotalItemQuantityInBag(sTeachItem) >= sTeachCount)
        SayKept(sTeachItem);
    sTeachItem = ITEM_NONE;
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
