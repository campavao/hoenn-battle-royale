// What you did in a match that only the ROM sees (POK-416): br_tally.h.
#include "global.h"
#include "battle.h"
#include "battle_main.h"
#include "battle_anim.h"
#include "pokemon.h"
#include "constants/battle.h"
#include "constants/items.h"
#include "constants/moves.h"
#include "br/br_duel.h"
#include "br/br_tally.h"

struct BrTally gBrTally;

// Nothing on somebody else's account: a fight replayed for a spectator, or the proxy
// instance running a bot duel for the page (br_duel.h).
static bool8 Counting(void)
{
    return !(gBattleTypeFlags & (BATTLE_TYPE_RECORDED | BATTLE_TYPE_RECORDED_LINK)) && !BrDuel_IsProxy();
}

static void Bump(u16 *ids, u8 *counts, u8 size, u16 id)
{
    u8 i;

    for (i = 0; i < size; i++)
    {
        if (counts[i] != 0 && ids[i] != id)
            continue;
        ids[i] = id;
        if (counts[i] < 0xFF)
            counts[i]++;
        return;
    }
}

void BrTally_Reset(void)
{
    CpuFill16(0, &gBrTally, sizeof(gBrTally));
}

void BrTally_Step(void)
{
    if (gBrTally.steps < 0xFFFF)
        gBrTally.steps++;
}

void BrTally_Move(u8 battler, u16 move)
{
    if (!gMain.inBattle || !Counting() || GetBattlerSide(battler) != B_SIDE_PLAYER || gBattleMons[battler].hp == 0
     || move == MOVE_NONE || move == MOVE_STRUGGLE)
        return;
    // The party's own species, not the battler's: a Transform is still the mon that used it.
    Bump(gBrTally.species, gBrTally.speciesN, BR_TALLY_MONS,
         GetMonData(&gPlayerParty[gBattlerPartyIndexes[battler]], MON_DATA_SPECIES));
    Bump(gBrTally.moves, gBrTally.movesN, BR_TALLY_MOVES, move);
}

void BrTally_BattleEnd(void)
{
    if (!Counting())
        return;
    if (gBattleOutcome == B_OUTCOME_WON && gBrTally.won < 0xFFFF)
        gBrTally.won++;
    else if (gBattleOutcome == B_OUTCOME_CAUGHT && gBrTally.caught < 0xFFFF)
        gBrTally.caught++;
}

void BrTally_ItemOut(u16 item, u16 n)
{
    u16 kept = gBrTally.discard < n ? gBrTally.discard : n;

    gBrTally.discard -= kept;
    n -= kept;
    if (n == 0 || item == ITEM_NONE || BrDuel_IsProxy())
        return;
    gBrTally.items = (u32)gBrTally.items + n > 0xFFFF ? 0xFFFF : gBrTally.items + n;
}

void BrTally_Discard(u16 n)
{
    gBrTally.discard = n;
}
