// Field moves without the HMs. See include/br/br_hm.h.
#include "global.h"
#include "item.h"
#include "event_object_movement.h"
#include "field_effect.h"
#include "field_player_avatar.h"
#include "fieldmap.h"
#include "metatile_behavior.h"
#include "map_name_popup.h"
#include "script.h"
#include "event_scripts.h"
#include "event_data.h"
#include "party_menu.h"
#include "pokemon.h"
#include "constants/event_objects.h"
#include "constants/flags.h"
#include "constants/moves.h"
#include "constants/party_menu.h"
#include "constants/event_object_movement.h"
#include "constants/field_effects.h"
#include "constants/items.h"
#include "br/br_hm.h"
#include "br/br_match.h"
#include "main.h"
#include "overworld.h"

extern const u8 BR_EventScript_Surf[];
extern const u8 BR_EventScript_Waterfall[];
extern const u8 BR_EventScript_Dive[];
extern const u8 BR_EventScript_Cut[];

// The eight HMs' moves, in the machines' order: HM01 is CUT.
static const u16 sHmMoves[] =
{
    MOVE_CUT, MOVE_FLY, MOVE_SURF, MOVE_STRENGTH, MOVE_FLASH, MOVE_ROCK_SMASH, MOVE_WATERFALL, MOVE_DIVE,
};

// pret's own learnsets. Under BR any mon learns any machine (CanSpeciesLearnTMHM), so the
// question "could this one learn it" has to go past that to the table the cartridge had:
// for the length of this one call, BrHm_AnyMachine says no.
static bool8 sAskingTable;

bool8 BrHm_AnyMachine(void)
{
    return !sAskingTable;
}

static bool8 CouldLearn(u16 species, u8 hm)
{
    bool8 can;

    sAskingTable = TRUE;
    can = CanSpeciesLearnTMHM(species, ITEM_HM01 - ITEM_TM01 + hm) != 0;
    sAskingTable = FALSE;
    return can;
}

u8 BrHm_Slot(u16 move)
{
    u8 hm, slot;

    for (hm = 0; hm < ARRAY_COUNT(sHmMoves); hm++)
    {
        if (sHmMoves[hm] == move)
            break;
    }
    if (hm == ARRAY_COUNT(sHmMoves))
        return PARTY_SIZE;
    for (slot = 0; slot < PARTY_SIZE; slot++)
    {
        u16 species = GetMonData(&gPlayerParty[slot], MON_DATA_SPECIES, NULL);

        if (species == SPECIES_NONE || GetMonData(&gPlayerParty[slot], MON_DATA_IS_EGG, NULL))
            continue;
        if (MonKnowsMove(&gPlayerParty[slot], move) || CouldLearn(species, hm))
            return slot;
    }
    return PARTY_SIZE;
}

static bool8 Can(u16 move)
{
    return BrHm_Slot(move) < PARTY_SIZE;
}

EWRAM_DATA struct BrHmView gBrHmView = {0};
static u8 sViewFrames; // until `can` is read off the party again (IWRAM: EWRAM is full)

#define BR_HM_VIEW_FRAMES 16
#define BR_HM_SHOWN (BR_HM_CUT | BR_HM_FLY | BR_HM_SURF | BR_HM_STRENGTH | BR_HM_WATERFALL | BR_HM_DIVE)

// BrHm_Slot for all six at once: each mon read once, its four moves included (a
// GetMonData decrypts the whole mon, and MonKnowsMove would read the four again per HM).
static u8 PartyCan(void)
{
    u8 slot, hm, i, can = 0;
    u16 moves[MAX_MON_MOVES];

    for (slot = 0; slot < PARTY_SIZE; slot++)
    {
        u16 species = GetMonData(&gPlayerParty[slot], MON_DATA_SPECIES, NULL);

        if (species == SPECIES_NONE || GetMonData(&gPlayerParty[slot], MON_DATA_IS_EGG, NULL))
            continue;
        for (i = 0; i < MAX_MON_MOVES; i++)
            moves[i] = GetMonData(&gPlayerParty[slot], MON_DATA_MOVE1 + i, NULL);
        for (hm = 0; hm < ARRAY_COUNT(sHmMoves); hm++)
        {
            if (!((BR_HM_SHOWN >> hm) & 1) || ((can >> hm) & 1))
                continue;
            for (i = 0; i < MAX_MON_MOVES && moves[i] != sHmMoves[hm]; i++)
                ;
            if (i < MAX_MON_MOVES || CouldLearn(species, hm))
                can |= 1 << hm;
        }
    }
    return can;
}

// The cell we face, for the field moves that start by walking into it (BrHm_WalkInto, the
// trees and boulders) or by A on the water: what would happen, without doing it.
static u8 Ready(u8 can)
{
    struct ObjectEvent *player = &gObjectEvents[gPlayerAvatar.objectEventId];
    s16 x = player->currentCoords.x;
    s16 y = player->currentCoords.y;
    u8 ready = can & BR_HM_FLY; // the MAP flies from anywhere in the match (br_map.c)
    u8 id;

    // Coming back up is free (BrHm_DiveScript), so nothing to show for it down there.
    if (gPlayerAvatar.flags & PLAYER_AVATAR_FLAG_UNDERWATER)
        return ready;
    if (gPlayerAvatar.flags & PLAYER_AVATAR_FLAG_SURFING)
    {
        // TrySetDiveWarp's test without its warp: a dive spot over a map below. (A dive
        // that only a map script places is missed; none is on a match's route.)
        if (MetatileBehavior_IsDiveable(MapGridGetMetatileBehaviorAt(x, y)) && GetMapConnection(CONNECTION_DIVE) != NULL)
            ready |= can & BR_HM_DIVE;
        MoveCoords(player->facingDirection, &x, &y);
        if (player->facingDirection == DIR_NORTH && MetatileBehavior_IsWaterfall(MapGridGetMetatileBehaviorAt(x, y))
         && GetCollisionAtCoords(player, x, y, DIR_NORTH) == COLLISION_NONE)
            ready |= can & BR_HM_WATERFALL;
        return ready;
    }
    if (IsPlayerFacingSurfableFishableWater())
        ready |= can & BR_HM_SURF;
    MoveCoords(player->facingDirection, &x, &y);
    id = GetObjectEventIdByXY(x, y);
    if (id != OBJECT_EVENTS_COUNT)
    {
        if (gObjectEvents[id].graphicsId == OBJ_EVENT_GFX_CUTTABLE_TREE)
            ready |= can & BR_HM_CUT;
        else if (gObjectEvents[id].graphicsId == OBJ_EVENT_GFX_PUSHABLE_BOULDER)
        {
            // TryPushBoulder's test: the cell past the boulder is free and not a door.
            MoveCoords(player->facingDirection, &x, &y);
            if (GetCollisionAtCoords(&gObjectEvents[id], x, y, player->facingDirection) == COLLISION_NONE
             && !MetatileBehavior_IsNonAnimDoor(MapGridGetMetatileBehaviorAt(x, y)))
                ready |= can & BR_HM_STRENGTH;
        }
    }
    return ready;
}

void BrHm_Tick(void)
{
    if (gBrMatch.phase != BR_PHASE_PLAY)
    {
        gBrHmView.can = gBrHmView.ready = 0;
        sViewFrames = 0;
        return;
    }
    // Off the field (a door's map load, a menu, a battle) the party stands: `can` stays,
    // so the icons do not blink out on every warp. The page hides them off the field.
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle || ScriptContext_IsEnabled())
    {
        gBrHmView.ready = 0;
        return;
    }
    if (sViewFrames == 0)
    {
        gBrHmView.can = PartyCan();
        sViewFrames = BR_HM_VIEW_FRAMES;
    }
    sViewFrames--;
    gBrHmView.ready = Ready(gBrHmView.can);
}

void BrHm_PartyMove(u16 move)
{
    u8 slot;

    if (!BrHm_Free() || gSpecialVar_Result < PARTY_SIZE)
        return;
    slot = BrHm_Slot(move);
    if (slot == PARTY_SIZE)
        return;
    gSpecialVar_Result = slot;
    gSpecialVar_0x8004 = GetMonData(&gPlayerParty[slot], MON_DATA_SPECIES, NULL);
}

// On while somebody in the party could push, off the moment nobody can (a release, a
// faint does not count): the flag is saved and only a FLY or a whiteout clears it in pret.
void BrHm_Strength(void)
{
    if (!BrHm_Free())
        return;
    if (Can(MOVE_STRENGTH))
        FlagSet(FLAG_SYS_USE_STRENGTH);
    else
        FlagClear(FLAG_SYS_USE_STRENGTH);
}

// An A press on a tree or a boulder in a match: no "Would you like to CUT it?" either.
// VAR_RESULT TRUE sends the script to the BR one (data/scripts/field_move_scripts.inc).
void BrHm_AskCut(void)
{
    gSpecialVar_Result = BrHm_Free() && Can(MOVE_CUT);
    if (gSpecialVar_Result)
        gFieldEffectArguments[0] = BrHm_Slot(MOVE_CUT);
}

void BrHm_AskStrength(void)
{
    BrHm_Strength();
    gSpecialVar_Result = BrHm_Free() && FlagGet(FLAG_SYS_USE_STRENGTH);
}

// Walking into a CUT tree with somebody who could cut it: it comes down, no question
// asked, as the water lets you in (Cam's 10-19 play-test, #7).
static bool8 WalkIntoTree(s16 x, s16 y, u8 collision)
{
    u8 id;

    if (collision != COLLISION_OBJECT_EVENT)
        return FALSE;
    id = GetObjectEventIdByXY(x, y);
    if (id == OBJECT_EVENTS_COUNT || gObjectEvents[id].graphicsId != OBJ_EVENT_GFX_CUTTABLE_TREE || !Can(MOVE_CUT))
        return FALSE;
    gSpecialVar_LastTalked = gObjectEvents[id].localId;
    gFieldEffectArguments[0] = BrHm_Slot(MOVE_CUT);
    return TRUE;
}

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
    if (WalkIntoTree(x, y, collision))
    {
        script = BR_EventScript_Cut;
    }
    else if (!(gPlayerAvatar.flags & PLAYER_AVATAR_FLAG_SURFING))
    {
        // IsPlayerFacingSurfableFishableWater's own test, for the way we are walking
        // rather than the way we were facing: the shore is one elevation, the water
        // another, and only a player on the ground's level can get in.
        if (collision == COLLISION_ELEVATION_MISMATCH
         && PlayerGetElevation() == ELEVATION_DEFAULT
         && MetatileBehavior_IsSurfableFishableWater(behavior)
         && Can(MOVE_SURF))
            script = BR_EventScript_Surf;
    }
    else if (direction == DIR_NORTH && collision == COLLISION_NONE
          && MetatileBehavior_IsWaterfall(behavior) && Can(MOVE_WATERFALL))
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
        return Can(MOVE_SURF) ? BR_EventScript_Surf : NULL;
    if (!MetatileBehavior_IsWaterfall(metatileBehavior))
        return NULL;
    if (!IsPlayerSurfingNorth() || !Can(MOVE_WATERFALL))
        return EventScript_CannotUseWaterfall;
    return BR_EventScript_Waterfall;
}

const u8 *BrHm_DiveScript(const u8 *script)
{
    // Down needs somebody who could DIVE, else pret's own script says the sea is deep
    // here; back up is free, or a diver traded away below would leave us there.
    if (!BrHm_Free() || (script == EventScript_UseDive && !Can(MOVE_DIVE)))
        return script;
    return BR_EventScript_Dive;
}

bool8 BrHm_SkipCutIn(void)
{
    if (!BrHm_Free())
        return FALSE;
    // FieldEffectStart put the init on the active list, and nothing else takes it off.
    FieldEffectActiveListRemove(FLDEFF_FIELD_MOVE_SHOW_MON_INIT);
    return TRUE;
}

static bool8 ItemIsRod(u16 item)
{
    return item == ITEM_OLD_ROD || item == ITEM_GOOD_ROD || item == ITEM_SUPER_ROD;
}

void BrHm_SelectBike(void)
{
    u16 item = gSaveBlock1Ptr->registeredItem;

    if (!BrHm_Free())
        return;
    // A rod comes first only facing water. The phone's FISH button registers the rod
    // (web/src/ui/phonehud.ts), and after one cast SELECT on dry land cast again instead of
    // riding (Cam's 2026-10-19 play-test: "select does not automatically bring out my bike").
    if (item != ITEM_NONE && CheckBagHasItem(item, 1)
     && !(ItemIsRod(item) && !IsPlayerFacingSurfableFishableWater()))
        return;
    if (CheckBagHasItem(ITEM_MACH_BIKE, 1))
        gSaveBlock1Ptr->registeredItem = ITEM_MACH_BIKE;
    else if (CheckBagHasItem(ITEM_ACRO_BIKE, 1))
        gSaveBlock1Ptr->registeredItem = ITEM_ACRO_BIKE;
}
