// A wild battle the page asks for. See include/br/br_wild.h.
#include "global.h"
#include "main.h"
#include "battle.h"
#include "battle_setup.h"
#include "metatile_behavior.h"
#include "overworld.h"
#include "random.h"
#include "script_pokemon_util.h"
#include "wild_encounter.h"
#include "constants/battle.h"
#include "constants/items.h"
#include "constants/maps.h"
#include "constants/map_types.h"
#include "constants/weather.h"
#include "constants/species.h"
#include "constants/wild_encounter.h"
#include "br/br_field.h"
#include "br/br_levels.h"
#include "br/br_wild.h"
#include "br/br_zone.h"

// In IWRAM, as gBrSides: EWRAM has no room left over its floor (ram-headroom.py).
struct BrWildAsk gBrWildAsk;
static MainCallback sEnd;

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
    bool8 water = MetatileBehavior_IsSurfableWaterOrUnderwater(gBrWildAsk.behavior);
    const struct WildPokemonInfo *info = TableFor(gBrWildAsk.mapGroup, gBrWildAsk.mapNum, water);
    u16 species;

    if (info == NULL)
    {
        gBrWildAsk.species = SPECIES_NONE;
        gBrWildAsk.state = BR_WILD_DONE;
        return;
    }
    species = info->wildPokemon[water ? WaterSlot() : LandSlot()].species;
    // The opening's any-first-stage, or the route's national stand-in: CreateWildMon's.
    gBrWildAsk.species = BrZone_Pick();
    if (gBrWildAsk.species == SPECIES_NONE)
        gBrWildAsk.species = BrZone_NationalOn(species, gBrWildAsk.mapGroup, gBrWildAsk.mapNum);
    gBrWildAsk.level = BrLevels_WildLevel();
    CreateScriptedWildMon(gBrWildAsk.species, gBrWildAsk.level, ITEM_NONE);
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

// BattleSetup_GetEnvironmentId, for the spot the page's trainer stands on rather than the
// cell this hidden ROM does: that map's type and weather, the spot's behaviour.
u8 BrWild_Environment(u8 environment)
{
    const struct MapHeader *header;
    u8 tile = gBrWildAsk.behavior;

    if (gBrWildAsk.state != BR_WILD_FIGHTING)
        return environment;
    header = Overworld_GetMapHeaderByGroupAndId(gBrWildAsk.mapGroup, gBrWildAsk.mapNum);
    if (MetatileBehavior_IsTallGrass(tile))
        return BATTLE_ENVIRONMENT_GRASS;
    if (MetatileBehavior_IsLongGrass(tile))
        return BATTLE_ENVIRONMENT_LONG_GRASS;
    if (MetatileBehavior_IsSandOrDeepSand(tile))
        return BATTLE_ENVIRONMENT_SAND;
    switch (header->mapType)
    {
    case MAP_TYPE_UNDERGROUND:
        if (MetatileBehavior_IsIndoorEncounter(tile))
            return BATTLE_ENVIRONMENT_BUILDING;
        if (MetatileBehavior_IsSurfableWaterOrUnderwater(tile))
            return BATTLE_ENVIRONMENT_POND;
        return BATTLE_ENVIRONMENT_CAVE;
    case MAP_TYPE_INDOOR:
    case MAP_TYPE_SECRET_BASE:
        return BATTLE_ENVIRONMENT_BUILDING;
    case MAP_TYPE_UNDERWATER:
        return BATTLE_ENVIRONMENT_UNDERWATER;
    case MAP_TYPE_OCEAN_ROUTE:
        if (MetatileBehavior_IsSurfableWaterOrUnderwater(tile))
            return BATTLE_ENVIRONMENT_WATER;
        return BATTLE_ENVIRONMENT_PLAIN;
    }
    if (MetatileBehavior_IsDeepOrOceanWater(tile))
        return BATTLE_ENVIRONMENT_WATER;
    if (MetatileBehavior_IsSurfableWaterOrUnderwater(tile))
        return BATTLE_ENVIRONMENT_POND;
    if (MetatileBehavior_IsMountain(tile))
        return BATTLE_ENVIRONMENT_MOUNTAIN;
    if (gBrWildAsk.mapGroup == MAP_GROUP(MAP_ROUTE113) && gBrWildAsk.mapNum == MAP_NUM(MAP_ROUTE113))
        return BATTLE_ENVIRONMENT_SAND;
    if (header->weather == WEATHER_SANDSTORM)
        return BATTLE_ENVIRONMENT_SAND;
    return BATTLE_ENVIRONMENT_PLAIN;
}
