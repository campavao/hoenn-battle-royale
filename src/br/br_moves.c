// The machines on the MOVES list (POK-279). See include/br/br_moves.h.
#include "global.h"
#include "pokemon.h"
#include "item.h"
#include "party_menu.h"
#include "constants/item.h"
#include "constants/items.h"
#include "constants/pokemon.h"
#include "br/br_moves.h"

// Four bits a party slot: which of this mon's moves the player put there on purpose.
// Six bytes of EWRAM, and EWRAM has under eighty left -- see the header for why it
// cannot live on the mon itself.
static EWRAM_DATA u8 sKept[PARTY_SIZE] = {0};

void BrMoves_ClearKept(void)
{
    u8 i;

    for (i = 0; i < PARTY_SIZE; i++)
        sKept[i] = 0;
}

void BrMoves_ForgetKept(u8 partyIndex)
{
    if (partyIndex < PARTY_SIZE)
        sKept[partyIndex] = 0;
}

void BrMoves_Keep(u8 partyIndex, u16 move)
{
    u8 i;

    if (partyIndex >= PARTY_SIZE)
        return;
    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        if (GetMonData(&gPlayerParty[partyIndex], MON_DATA_MOVE1 + i, NULL) == move)
            sKept[partyIndex] |= 1 << i;
    }
}

bool8 BrMoves_IsKept(u8 partyIndex, u8 slot)
{
    // PARTY_SIZE is passed deliberately for a party that is not the player's -- a
    // trainer's team, lifted to the same rung -- where nothing is anybody's decision.
    if (partyIndex >= PARTY_SIZE || slot >= MAX_MON_MOVES)
        return FALSE;
    return (sKept[partyIndex] >> slot) & 1;
}

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
