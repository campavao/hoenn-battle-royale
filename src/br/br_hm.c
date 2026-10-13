// Field moves without the HMs. See include/br/br_hm.h.
#include "global.h"
#include "event_object_movement.h"
#include "field_effect.h"
#include "field_player_avatar.h"
#include "fieldmap.h"
#include "metatile_behavior.h"
#include "map_name_popup.h"
#include "script.h"
#include "event_scripts.h"
#include "constants/event_object_movement.h"
#include "constants/field_effects.h"
#include "br/br_hm.h"
#include "br/br_match.h"

extern const u8 BR_EventScript_Surf[];
extern const u8 BR_EventScript_Waterfall[];
extern const u8 BR_EventScript_Dive[];

bool8 BrHm_Free(void)
{
    return gBrMatch.phase != BR_PHASE_NONE;
}

bool8 BrHm_WalkInto(u8 direction, u8 collision)
{
    struct ObjectEvent *player = &gObjectEvents[gPlayerAvatar.objectEventId];
    s16 x = player->currentCoords.x;
    s16 y = player->currentCoords.y;
    const u8 *script = NULL;
    u8 behavior;

    if (!BrHm_Free() || (gPlayerAvatar.flags & PLAYER_AVATAR_FLAG_UNDERWATER))
        return FALSE;
    MoveCoords(direction, &x, &y);
    behavior = MapGridGetMetatileBehaviorAt(x, y);
    if (!(gPlayerAvatar.flags & PLAYER_AVATAR_FLAG_SURFING))
    {
        // IsPlayerFacingSurfableFishableWater's own test, for the way we are walking
        // rather than the way we were facing: the shore is one elevation, the water
        // another, and only a player on the ground's level can get in.
        if (collision == COLLISION_ELEVATION_MISMATCH
         && PlayerGetElevation() == ELEVATION_DEFAULT
         && MetatileBehavior_IsSurfableFishableWater(behavior))
            script = BR_EventScript_Surf;
    }
    else if (direction == DIR_NORTH && collision == COLLISION_NONE
          && MetatileBehavior_IsWaterfall(behavior))
    {
        script = BR_EventScript_Waterfall;
    }
    if (script == NULL)
        return FALSE;
    // SURF jumps the way the player moves, and a turn and a step can come in one press.
    SetObjectEventDirection(player, direction);
    // What a press at the water would have done first (ProcessPlayerFieldInput).
    HideMapNamePopUpWindow();
    ScriptContext_SetupScript(script);
    return TRUE;
}

u8 BrHm_BikeInto(u8 direction, u8 collision)
{
    if (BrHm_WalkInto(direction, collision))
        return COLLISION_STOP_SURFING;
    return collision;
}

const u8 *BrHm_WaterScript(u8 metatileBehavior)
{
    if (IsPlayerFacingSurfableFishableWater())
        return BR_EventScript_Surf;
    if (!MetatileBehavior_IsWaterfall(metatileBehavior))
        return NULL;
    if (!IsPlayerSurfingNorth())
        return EventScript_CannotUseWaterfall;
    return BR_EventScript_Waterfall;
}

const u8 *BrHm_DiveScript(const u8 *script)
{
    return BrHm_Free() ? BR_EventScript_Dive : script;
}

bool8 BrHm_SkipCutIn(void)
{
    if (!BrHm_Free())
        return FALSE;
    // FieldEffectStart put the init on the active list, and nothing else takes it off.
    FieldEffectActiveListRemove(FLDEFF_FIELD_MOVE_SHOW_MON_INIT);
    return TRUE;
}
