// Legendaries you fight (POK-410). See include/br/br_legend.h.
#include "global.h"
#include "main.h"
#include "battle.h"
#include "battle_setup.h"
#include "event_data.h"
#include "script.h"
#include "script_pokemon_util.h"
#include "constants/battle.h"
#include "constants/event_objects.h"
#include "constants/items.h"
#include "constants/species.h"
#include "br/br_catch.h"
#include "br/br_event.h"
#include "br/br_ghosts.h"
#include "br/br_legend.h"
#include "br/br_levels.h"
#include "br/br_loot.h"
#include "br/br_story.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"

struct BrLegend
{
    /*  0 */ u16 key;      // the piece being fought, or put back once a send has room
    /*  2 */ s16 x;
    /*  4 */ s16 y;
    /*  6 */ u16 species;
    /*  8 */ u8 mapGroup;
    /*  9 */ u8 mapNum;
    /* 10 */ u8 level;     // the piece's own, 0 for "the rung"
    /* 11 */ u8 state;     // BR_LEGEND_*
    /* 12 */ MainCallback end; // what the battle would have returned through
    /* 16 */ bool8 yield;  // a lower seat claimed it too: putting it back is theirs
};                            // 20 bytes

#define BR_LEGEND_NONE 0
#define BR_LEGEND_FIGHTING 1 // claimed, its battle on
#define BR_LEGEND_PARKED 2   // caught into a full party, the release screen to come
#define BR_LEGEND_PUT_BACK 3 // to go back on the ground once the ring has room

// In IWRAM: EWRAM had 148 bytes left when this went in (tools/br/ram-headroom.py).
static struct BrLegend sLegend;

extern const u8 BR_EventScript_Legend[];

// Who stands as what: the sprite each one has on its own map in Emerald, awake where it
// has two (KYOGRE and GROUDON surfacing, not asleep in the cave; RAYQUAZA coiled on the
// pillar, the flying one is a cut-scene's). web/src/match/legends.ts is the same table.
static const u16 sLegends[][2] = {
    { SPECIES_REGIROCK,  OBJ_EVENT_GFX_REGIROCK },
    { SPECIES_REGICE,    OBJ_EVENT_GFX_REGICE },
    { SPECIES_REGISTEEL, OBJ_EVENT_GFX_REGISTEEL },
    { SPECIES_LATIAS,    OBJ_EVENT_GFX_LATIAS },
    { SPECIES_LATIOS,    OBJ_EVENT_GFX_LATIOS },
    { SPECIES_KYOGRE,    OBJ_EVENT_GFX_KYOGRE_FRONT },
    { SPECIES_GROUDON,   OBJ_EVENT_GFX_GROUDON_FRONT },
    { SPECIES_RAYQUAZA,  OBJ_EVENT_GFX_RAYQUAZA_STILL },
    { SPECIES_DEOXYS,    OBJ_EVENT_GFX_DEOXYS },
    { SPECIES_MEW,       OBJ_EVENT_GFX_MEW },
    { SPECIES_LUGIA,     OBJ_EVENT_GFX_LUGIA },
    { SPECIES_HO_OH,     OBJ_EVENT_GFX_HOOH },
};

// SPILL: seat, map, one mon (key, x, y, species, level), no bag.
#define BR_LEGEND_SPILL_LEN (4 + 9 + 1)

void BrLegend_Init(void)
{
    sLegend.state = BR_LEGEND_NONE;
}

u8 BrLegend_Gfx(const struct BrLootItem *it)
{
    u8 i;

    // The match's own, not a ball out of somebody's team; and not one a story's person
    // stands as and hands over (br_story.c: MAXIE holding GROUDON is a fight already).
    if (it->kind != BR_LOOT_MON || !(it->key & BR_LOOT_KEY_NOBODY) || BrStory_Person(it) != 0)
        return 0;
    for (i = 0; i < ARRAY_COUNT(sLegends); i++)
    {
        if (sLegends[i][0] == it->species)
            return sLegends[i][1];
    }
    return 0;
}

void BrLegend_Challenge(const struct BrLootItem *it)
{
    if (sLegend.state != BR_LEGEND_NONE)
        return; // the last one is still on its way back down
    sLegend.key = it->key;
    sLegend.x = it->x;
    sLegend.y = it->y;
    sLegend.species = it->species;
    sLegend.mapGroup = it->mapGroup;
    sLegend.mapNum = it->mapNum;
    sLegend.level = it->level;
    gSpecialVar_0x8004 = it->species;
    ScriptContext_SetupScript(BR_EventScript_Legend);
}

// Out to the room and onto our own ground, where it stood. FALSE when the ring is full:
// BrLegend_Tick tries again, because nothing leaves a match.
static bool8 PutBack(void)
{
    u8 buf[BR_LEGEND_SPILL_LEN];

    buf[0] = gBrMySeat;
    buf[1] = sLegend.mapGroup;
    buf[2] = sLegend.mapNum;
    buf[3] = 1;
    BrWire_WriteU16(buf + 4, sLegend.key);
    BrWire_WriteU16(buf + 6, (u16)sLegend.x);
    BrWire_WriteU16(buf + 8, (u16)sLegend.y);
    BrWire_WriteU16(buf + 10, sLegend.species);
    buf[12] = sLegend.level;
    buf[13] = 0;
    if (!BrWire_SendLarge(BR_MSG_SPILL, buf, sizeof(buf)))
        return FALSE;
    BrLoot_AddMon(sLegend.key, sLegend.mapGroup, sLegend.mapNum, sLegend.x, sLegend.y,
                  sLegend.species, sLegend.level);
    BrEvent_NoteBack(sLegend.key);
    sLegend.state = BR_LEGEND_NONE;
    return TRUE;
}

// Between the battle and the field, whichever way it went: the whiteout too, which never
// comes back to the script.
static void CB2_EndLegendBattle(void)
{
    if (sLegend.yield)
        sLegend.state = BR_LEGEND_NONE;
    else if (gBattleOutcome != B_OUTCOME_CAUGHT)
        sLegend.state = BR_LEGEND_PUT_BACK;
    else if (gBrCatch.pending)
        sLegend.state = BR_LEGEND_PARKED; // BrCatch_Apply says which way it went
    else
        sLegend.state = BR_LEGEND_NONE;
    if (sLegend.state == BR_LEGEND_PUT_BACK)
        PutBack();
    sLegend.end();
}

// Still on the ground here, by its key: another piece can have landed on its cell.
static bool8 StillHere(void)
{
    u8 i;

    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        const struct BrLootItem *it = &gBrLoot.items[i];

        if (it->kind == BR_LOOT_MON && it->key == sLegend.key
         && it->mapGroup == gSaveBlock1Ptr->location.mapGroup && it->mapNum == gSaveBlock1Ptr->location.mapNum)
            return TRUE;
    }
    return FALSE;
}

void BrLegend_Battle(void)
{
    u8 level = BrLevels_WildLevel();

    // Somebody else's battle took it while it cried, or the ring cannot take the PICKUP
    // that says it is ours straight away: nothing starts. Straight away, not held, so the
    // SPILL that may put it back can never reach the room ahead of the claim.
    gSpecialVar_Result = StillHere() && BrWire_Clear();
    if (!gSpecialVar_Result)
        return;
    // As strong as the ring is now, or as it was when it fell if that is more.
    if (sLegend.level > level)
        level = sLegend.level;
    BrLoot_ClaimKey(sLegend.key);
    sLegend.state = BR_LEGEND_FIGHTING;
    sLegend.yield = FALSE;
    CreateScriptedWildMon(sLegend.species, level, ITEM_NONE);
    switch (sLegend.species)
    {
    case SPECIES_REGIROCK:
    case SPECIES_REGICE:
    case SPECIES_REGISTEEL:
        StartRegiBattle();
        break;
    case SPECIES_LATIAS:
    case SPECIES_LATIOS:
        BattleSetup_StartLatiBattle();
        break;
    default:
        BattleSetup_StartLegendaryBattle();
        break;
    }
    sLegend.end = gMain.savedCallback;
    gMain.savedCallback = CB2_EndLegendBattle;
}

void BrLegend_CatchCancelled(void)
{
    if (sLegend.state != BR_LEGEND_PARKED || sLegend.yield)
        return;
    sLegend.state = BR_LEGEND_PUT_BACK;
    PutBack();
}

// Two trainers who pressed A on it within one round trip both claimed it and are both
// fighting it, and both putting it back would stand two on the ground. Every ROM settles
// it the same way, by seat: the lower one's put-back stands, the higher one lets go.
void BrLegend_NoteTaken(u16 key, u8 seat)
{
    if (sLegend.state == BR_LEGEND_NONE || key != sLegend.key || seat >= gBrMySeat)
        return;
    sLegend.yield = TRUE;
    if (sLegend.state == BR_LEGEND_PUT_BACK)
        sLegend.state = BR_LEGEND_NONE;
}

void BrLegend_Tick(void)
{
    // The release screen chose a slot: the catch is kept, and nothing goes back.
    if (sLegend.state == BR_LEGEND_PARKED && !gBrCatch.pending)
        sLegend.state = BR_LEGEND_NONE;
    if (sLegend.state == BR_LEGEND_PUT_BACK)
        PutBack();
}
