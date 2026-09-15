// A full party means choosing who goes (POK-227). See include/br/br_catch.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "pokemon.h"
#include "script.h"
#include "event_data.h"
#include "constants/party_menu.h"
#include "br/br_catch.h"

EWRAM_DATA struct BrCatch gBrCatch = {0};
EWRAM_DATA struct Pokemon gBrPendingCatch = {0};

extern const u8 BR_EventScript_ReleaseOne[];

void BrCatch_Init(void)
{
    gBrCatch.pending = FALSE;
    gBrCatch.asked = FALSE;
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
}

void BrCatch_Tick(void)
{
    if (!gBrCatch.pending || gBrCatch.asked)
        return;
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle)
        return;
    if (ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked())
        return;
    gBrCatch.asked = TRUE;
    ScriptContext_SetupScript(BR_EventScript_ReleaseOne);
}
