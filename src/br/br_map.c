// Looking at the fog (POK-263). See include/br/br_map.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "task.h"
#include "palette.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "constants/field_weather.h"
#include "region_map.h"
#include "pokemon.h"
#include "party_menu.h"
#include "constants/moves.h"
#include "br/br_match.h"
#include "br/br_pick.h"
#include "br/br_map.h"
#include "br/br_field.h"

EWRAM_DATA struct BrMap gBrMap = {0};

// The START menu row, and the prompt over the map once it is open.
const u8 gBrText_MenuMap[] = _("MAP");
const u8 gBrText_TheFog[] = _("The FOG.");

void BrMap_Init(void)
{
    gBrMap.active = FALSE;
    gBrMap.flier = PARTY_SIZE;
}

bool8 BrMap_Looking(void)
{
    return gBrMap.active;
}

bool8 BrMap_CanFly(void)
{
    return gBrMap.active && gBrMap.flier < PARTY_SIZE;
}

void BrMap_Close(void)
{
    gBrMap.active = FALSE;
}

void BrMap_TakeFlight(void)
{
    // Emerald's fly animation carries whichever mon the party menu had selected
    // (Task_UseFly reads GetCursorSelectionMonId), and nothing selected one: the map
    // was opened from the START menu, not from a mon. So the one that can actually
    // fly is named here, or the bird we leave on is whatever slot 0 happens to be.
    if (gBrMap.flier < PARTY_SIZE)
        gPartyMenu.slotId = gBrMap.flier;
    gBrMap.active = FALSE;
}

// Who in the party knows FLY. PARTY_SIZE for nobody, which leaves the map a look.
static u8 FlierSlot(void)
{
    u8 slot, i;

    for (slot = 0; slot < gPlayerPartyCount && slot < PARTY_SIZE; slot++)
    {
        if (GetMonData(&gPlayerParty[slot], MON_DATA_IS_EGG))
            continue;
        for (i = 0; i < MAX_MON_MOVES; i++)
        {
            if (GetMonData(&gPlayerParty[slot], MON_DATA_MOVE1 + i) == MOVE_FLY)
                return slot;
        }
    }
    return PARTY_SIZE;
}

// The drop picker's way in, and for the same reason: the fly map wants the overworld's
// windows and tilemaps cleaned up before it takes the screen.
static void EnterMap(void)
{
    gMain.state = 0;
    SetMainCallback2(CB2_OpenFlyMap);
}

bool8 BrMap_Open(void)
{
    // Not while the drop's own picker is up, and not before there is a match to look
    // at: the map outside one is Emerald's, and it belongs to Emerald.
    if (gBrMap.active || BrPick_Picking() || gBrMatch.phase != BR_PHASE_PLAY)
        return FALSE;
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle)
        return FALSE;
    if (!BrField_Leave(20, EnterMap))
        return FALSE;
    gBrMap.active = TRUE;
    // Worked out now rather than on the way out: the party cannot change while the
    // map is up, and the answer decides what A does in there.
    gBrMap.flier = FlierSlot();
    return TRUE;
}
