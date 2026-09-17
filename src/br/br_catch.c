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
#include "br/br_moves.h"

EWRAM_DATA struct BrCatch gBrCatch = {0};
EWRAM_DATA struct Pokemon gBrPendingCatch = {0};

extern const u8 BR_EventScript_ReleaseOne[];

// Now only ever the truth: the gate below asks about the machines too, so a mon that is
// told there is nothing really has nothing. The line it replaced -- "TEACH FLY FROM THE
// BAG" -- was a hint pointing at a screen the player then had to go and find; Cam's call
// was that MOVES should be the screen (POK-279).
static const u8 sText_NoMoves[] = _("NO NEW MOVES AT THIS LEVEL");

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
    {
        gPlayerParty[slot] = gBrPendingCatch; // the old one is released, the catch takes its slot
        // A different mon in the slot, so whatever the player had chosen for the last one
        // is not a choice about this one (POK-290).
        BrMoves_ForgetKept(slot);
    }
    gBrCatch.pending = FALSE;
    gBrCatch.asked = FALSE;
    BrSpectate_SendParty(); // the team changed: spectators and the director want it
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
        // The relearner screen, with the machines on it (br_moves.c). One question, one
        // screen: every move this mon could ever have, level-up and machine alike.
        if (slot < PARTY_SIZE && BrMoves_HasAny(&gPlayerParty[slot]))
        {
            gSpecialVar_0x8004 = slot;
            TeachMoveRelearnerMove();
        }
        else
        {
            BrHud_Say(sText_NoMoves);
        }
        return;
    }
    if (!gBrCatch.pending || gBrCatch.asked)
        return;
    gBrCatch.asked = TRUE;
    ScriptContext_SetupScript(BR_EventScript_ReleaseOne);
}
