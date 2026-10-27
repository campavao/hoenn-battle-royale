// A wild battle the page asks for. See include/br/br_wild.h.
#include "global.h"
#include "main.h"
#include "battle.h"
#include "battle_setup.h"
#include "fieldmap.h"
#include "field_player_avatar.h"
#include "random.h"
#include "script_pokemon_util.h"
#include "wild_encounter.h"
#include "constants/battle.h"
#include "constants/items.h"
#include "constants/maps.h"
#include "constants/metatile_labels.h"
#include "constants/species.h"
#include "constants/wild_encounter.h"
#include "br/br_field.h"
#include "br/br_levels.h"
#include "br/br_wild.h"
#include "br/br_zone.h"

EWRAM_DATA struct BrWildAsk gBrWildAsk = {0};
static EWRAM_DATA MainCallback sEnd = NULL;

// wild_encounter.c's ChooseWildMonIndex_Land and _WaterRock, which are static there.
static u8 LandSlot(void)
{
    static const u8 sUpTo[11] =
    {
        ENCOUNTER_CHANCE_LAND_MONS_SLOT_0, ENCOUNTER_CHANCE_LAND_MONS_SLOT_1,
        ENCOUNTER_CHANCE_LAND_MONS_SLOT_2, ENCOUNTER_CHANCE_LAND_MONS_SLOT_3,
        ENCOUNTER_CHANCE_LAND_MONS_SLOT_4, ENCOUNTER_CHANCE_LAND_MONS_SLOT_5,
        ENCOUNTER_CHANCE_LAND_MONS_SLOT_6, ENCOUNTER_CHANCE_LAND_MONS_SLOT_7,
        ENCOUNTER_CHANCE_LAND_MONS_SLOT_8, ENCOUNTER_CHANCE_LAND_MONS_SLOT_9,
        ENCOUNTER_CHANCE_LAND_MONS_SLOT_10,
    };
    u8 rand = Random() % ENCOUNTER_CHANCE_LAND_MONS_TOTAL;
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sUpTo); i++)
    {
        if (rand < sUpTo[i])
            return i;
    }
    return i;
}

static u8 WaterSlot(void)
{
    static const u8 sUpTo[4] =
    {
        ENCOUNTER_CHANCE_WATER_MONS_SLOT_0, ENCOUNTER_CHANCE_WATER_MONS_SLOT_1,
        ENCOUNTER_CHANCE_WATER_MONS_SLOT_2, ENCOUNTER_CHANCE_WATER_MONS_SLOT_3,
    };
    u8 rand = Random() % ENCOUNTER_CHANCE_WATER_MONS_TOTAL;
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sUpTo); i++)
    {
        if (rand < sUpTo[i])
            return i;
    }
    return i;
}

static const struct WildPokemonInfo *TableFor(u8 group, u8 num, bool8 water)
{
    u16 i;

    for (i = 0; gWildMonHeaders[i].mapGroup != MAP_GROUP(MAP_UNDEFINED); i++)
    {
        if (gWildMonHeaders[i].mapGroup == group && gWildMonHeaders[i].mapNum == num)
            return water ? gWildMonHeaders[i].waterMonsInfo : gWildMonHeaders[i].landMonsInfo;
    }
    return NULL;
}

static void CB2_EndWild(void)
{
    gBrWildAsk.outcome = gBattleOutcome;
    gBrWildAsk.state = BR_WILD_DONE;
    sEnd();
}

static void Start(void)
{
    const struct WildPokemonInfo *info = TableFor(gBrWildAsk.mapGroup, gBrWildAsk.mapNum, gBrWildAsk.water);
    u16 species;
    s16 x, y;

    if (info == NULL)
    {
        gBrWildAsk.species = SPECIES_NONE;
        gBrWildAsk.state = BR_WILD_DONE;
        return;
    }
    species = info->wildPokemon[gBrWildAsk.water ? WaterSlot() : LandSlot()].species;
    // The opening's any-first-stage, or the route's national stand-in: CreateWildMon's.
    gBrWildAsk.species = BrZone_Pick();
    if (gBrWildAsk.species == SPECIES_NONE)
        gBrWildAsk.species = BrZone_NationalOn(species, gBrWildAsk.mapGroup, gBrWildAsk.mapNum);
    gBrWildAsk.level = BrLevels_WildLevel();
    CreateScriptedWildMon(gBrWildAsk.species, gBrWildAsk.level, ITEM_NONE);
    // The battle's backdrop is read off the cell we stand on (BattleSetup_GetEnvironmentId):
    // grass for a grass spot, the sea for water. Nobody sees this ROM's field, and the
    // page puts it back the way it was after every fight.
    PlayerGetDestCoords(&x, &y);
    MapGridSetMetatileIdAt(x, y, gBrWildAsk.water ? METATILE_General_CalmWater : METATILE_General_TallGrass);
    gBrWildAsk.state = BR_WILD_FIGHTING;
    BattleSetup_StartWildBattle();
    sEnd = gMain.savedCallback;
    gMain.savedCallback = CB2_EndWild;
}

void BrWild_Tick(void)
{
    if (gBrWildAsk.state == BR_WILD_ASKED && BrField_OverworldRunning() && !gMain.inBattle)
        Start();
}
