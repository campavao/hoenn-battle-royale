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
#include "br/br_loot.h"
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
    gBrCatch.fromKey = BR_HELD_NONE;
}

void BrCatch_RequestMoves(u8 slot)
{
    gBrCatch.movesSlot = slot;
}

bool8 BrCatch_TryPark(struct Pokemon *mon)
{
    return BrCatch_TryParkFrom(mon, BR_HELD_NONE);
}

bool8 BrCatch_TryParkFrom(struct Pokemon *mon, u16 key)
{
    if (CalculatePlayerPartyCount() < PARTY_SIZE)
        return FALSE;
    gBrPendingCatch = *mon;
    gBrCatch.pending = TRUE;
    gBrCatch.asked = FALSE;
    gBrCatch.fromKey = key;
    return TRUE;
}

void BrCatch_Apply(void)
{
    u16 slot = gSpecialVar_0x8004;

    if (gBrCatch.pending && slot < PARTY_SIZE)
    {
        // Nothing ever leaves the match (POK-294). The one giving up its slot is put on
        // the ground first, as a ball anybody can take -- trading up leaves a trace --
        // and only then is it overwritten.
        BrLoot_Released(&gPlayerParty[slot]);
        gPlayerParty[slot] = gBrPendingCatch; // the old one takes its place on the ground
        // A different mon in the slot, so whatever the player had chosen for the last one
        // is not a choice about this one (POK-290).
        BrMoves_ForgetKept(slot);
        // ...and only NOW does the ball it came out of leave the ground. Taking it first
        // meant cancelling this screen destroyed it -- the same thing POK-294 is about,
        // on the other side of the same decision.
        BrLoot_ClaimKey(gBrCatch.fromKey);
    }
    gBrCatch.fromKey = BR_HELD_NONE;
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
