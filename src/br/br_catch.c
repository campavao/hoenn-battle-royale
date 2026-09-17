// A full party means choosing who goes (POK-227). See include/br/br_catch.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "pokemon.h"
#include "script.h"
#include "event_data.h"
#include "constants/party_menu.h"
#include "move_relearner.h"
#include "item.h"
#include "party_menu.h"
#include "data.h"
#include "string_util.h"
#include "constants/item.h"
#include "constants/items.h"
#include "br/br_hud.h"
#include "br/br_spectate.h"
#include "br/br_catch.h"

EWRAM_DATA struct BrCatch gBrCatch = {0};
EWRAM_DATA struct Pokemon gBrPendingCatch = {0};

extern const u8 BR_EventScript_ReleaseOne[];

static const u8 sText_NoMoves[] = _("NO NEW MOVES AT THIS LEVEL");
// ...and, when the answer is "not here, but over there", where (POK-279). The
// play-test opened MOVES on a Wingull, was told there were none, and then taught it
// FLY from the bag a minute later: both true, and nothing said so.
static const u8 sText_Teach[] = _("TEACH ");
static const u8 sText_FromBag[] = _(" FROM THE BAG");

void BrCatch_Init(void)
{
    gBrCatch.pending = FALSE;
    gBrCatch.asked = FALSE;
    gBrCatch.movesSlot = 0xFF;
}

void BrCatch_RequestMoves(u8 slot)
{
    gBrCatch.movesSlot = slot;
}

bool8 BrCatch_TryPark(struct Pokemon *mon)
{
    if (CalculatePlayerPartyCount() < PARTY_SIZE)
        return FALSE;
    gBrPendingCatch = *mon;
    gBrCatch.pending = TRUE;
    gBrCatch.asked = FALSE;
    return TRUE;
}

void BrCatch_Apply(void)
{
    u16 slot = gSpecialVar_0x8004;

    if (gBrCatch.pending && slot < PARTY_SIZE)
        gPlayerParty[slot] = gBrPendingCatch; // the old one is released, the catch takes its slot
    gBrCatch.pending = FALSE;
    gBrCatch.asked = FALSE;
    BrSpectate_SendParty(); // the team changed: spectators and the director want it
}

// The first machine in the bag this mon could learn from, or ITEM_NONE. The relearner
// only ever offers level-up moves, so a party screen that says "no moves" is telling
// the truth about a different question from the one the player asked (POK-279).
static u16 MachineFor(u8 slot)
{
    struct Pokemon *mon = &gPlayerParty[slot];
    u16 i;

    for (i = 0; i < gBagPockets[TMHM_POCKET].capacity; i++)
    {
        u16 item = BagGetItemIdByPocketPosition(TMHM_POCKET + 1, i);

        if (item == ITEM_NONE)
            continue;
        if (CanMonLearnTMHM(mon, item - ITEM_TM01))
            return item;
    }
    return ITEM_NONE;
}

void BrCatch_Tick(void)
{
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle)
        return;
    if (ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked())
        return;
    if (gBrCatch.movesSlot != 0xFF)
    {
        u8 slot = gBrCatch.movesSlot;

        gBrCatch.movesSlot = 0xFF;
        if (slot < PARTY_SIZE && GetNumberOfRelearnableMoves(&gPlayerParty[slot]) > 0)
        {
            gSpecialVar_0x8004 = slot;
            TeachMoveRelearnerMove();
        }
        else
        {
            u16 item = MachineFor(slot);

            if (item != ITEM_NONE)
            {
                u8 line[BR_HUD_LINE_MAX + 2];
                u8 *p = StringCopy(line, sText_Teach);

                p = StringCopy(p, gMoveNames[ItemIdToBattleMoveId(item)]);
                StringCopy(p, sText_FromBag);
                BrHud_Say(line);
            }
            else
            {
                BrHud_Say(sText_NoMoves);
            }
        }
        return;
    }
    if (!gBrCatch.pending || gBrCatch.asked)
        return;
    gBrCatch.asked = TRUE;
    ScriptContext_SetupScript(BR_EventScript_ReleaseOne);
}
