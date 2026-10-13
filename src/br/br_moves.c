// The machines on the MOVES list (POK-279). See include/br/br_moves.h.
#include "global.h"
#include "pokemon.h"
#include "item.h"
#include "party_menu.h"
#include "constants/item.h"
#include "constants/items.h"
#include "constants/pokemon.h"
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
// level. Every mon in a match is taught that way and no other (BrLevels_Settle), so what
// is left over came from a TM.
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
