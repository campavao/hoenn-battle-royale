// The machines on the MOVES list (POK-279). See include/br/br_moves.h.
#include "global.h"
#include "pokemon.h"
#include "item.h"
#include "party_menu.h"
#include "constants/item.h"
#include "constants/items.h"
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
