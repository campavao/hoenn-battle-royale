// Coloured balls and the TMs in them. See include/br/br_balls.h.
#include "global.h"
#include "event_object_movement.h"
#include "event_data.h"
#include "field_weather.h"
#include "fieldmap.h"
#include "palette.h"
#include "constants/rgb.h"
#include "sprite.h"
#include "constants/event_objects.h"
#include "constants/map_groups.h"
#include "constants/region_map_sections.h"
#include "constants/metatile_behaviors.h"
#include "constants/items.h"
#include "constants/species.h"
#include "constants/vars.h"
#include "br/br_balls.h"
#include "br/br_items.h"
#include "br/br_loot.h"
#include "br/br_match.h"

// One ball in four (Cam: "about 1 blue for every 3 red").
#define BR_BALLS_TM_IN 4
// And one red ball in twelve a LINK CABLE (br_items.h), one map ball in sixteen: enough
// that the KADABRA you caught on Route 116 meets one on your way. Any red ball can be
// one, a RARE CANDY or MASTER BALL too, as any can be a TM.
#define BR_BALLS_CABLE_IN 12
// And one in twelve a POKe DOLL, the only way out of a fight with somebody (POK-293). The
// Marts were the only place to find one, and a whole match could go by without passing
// one (Cam's 10-19 play-test: "I still in this game have not encountered a Poke Doll").

// The machines worth a house: gold, and never dealt into a map's ball.
static const u16 sGold[] =
{
    ITEM_TM13, // ICE BEAM
    ITEM_TM14, // BLIZZARD
    ITEM_TM15, // HYPER BEAM
    ITEM_TM22, // SOLARBEAM
    ITEM_TM24, // THUNDERBOLT
    ITEM_TM25, // THUNDER
    ITEM_TM26, // EARTHQUAKE
    ITEM_TM29, // PSYCHIC
    ITEM_TM30, // SHADOW BALL
    ITEM_TM35, // FLAMETHROWER
    ITEM_TM38, // FIRE BLAST
    ITEM_MASTER_BALL,
    ITEM_LEFTOVERS,
    ITEM_CHOICE_BAND,
};

static bool8 IsGold(u16 item)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sGold); i++)
    {
        if (sGold[i] == item)
            return TRUE;
    }
    return FALSE;
}

u8 BrBalls_Tier(u16 item)
{
    if (IsGold(item))
        return BR_BALL_GOLD;
    if (item >= ITEM_TM01 && item < ITEM_HM01)
        return BR_BALL_BLUE;
    return BR_BALL_RED;
}

// br_zone.c's mulberry32 step, stateless: one number out of one number.
static u32 Mix(u32 t)
{
    t += 0x6d2b79f5;
    t = (t ^ (t >> 15)) * (1 | t);
    t += (t ^ (t >> 7)) * (61 | t);
    t ^= t >> 14;
    return t;
}

// Any machine but the gold ones, which are for houses. A gold one drawn is the next one
// up, so the draw stays even over the rest.
static u16 BlueTm(u32 r)
{
    u16 tm = ITEM_TM01 + (r % (ITEM_HM01 - ITEM_TM01));

    while (IsGold(tm))
        tm = tm + 1 < ITEM_HM01 ? tm + 1 : ITEM_TM01;
    return tm;
}

u16 BrBalls_Deal(u8 mapGroup, u8 mapNum, u8 localId, u16 item)
{
    u32 r;

    // A machine stays a machine; an HM or a key item is the story's, not the match's. Key
    // items run from the MACH BIKE to just under TM01, the machines from there on.
    if (gBrMatch.seed == 0 || item == ITEM_NONE || item >= ITEM_MACH_BIKE)
        return item;
    r = Mix(gBrMatch.seed ^ 0xBA11 ^ ((u32)mapGroup << 16) ^ ((u32)mapNum << 8) ^ localId);
    if (r % BR_BALLS_TM_IN == 0)
        return BlueTm(Mix(r));
    switch ((r / BR_BALLS_TM_IN) % BR_BALLS_CABLE_IN)
    {
    case 0:
        return BR_ITEM_LINK_CABLE;
    case 1:
        return ITEM_POKE_DOLL;
    }
    return item;
}

// setorcopyvar's opcode (data/script_cmd_table.inc, 0x1a): the first thing an item ball's
// script does is `finditem ITEM`, which is `setorcopyvar VAR_0x8000, ITEM`.
#define BR_SCR_OP_SETORCOPYVAR 0x1A

// What a map's item ball holds, read off its own script: ITEM_NONE for anything else.
static u16 ScriptItem(const u8 *script)
{
    if (script == NULL || script[0] != BR_SCR_OP_SETORCOPYVAR
     || (script[1] | (script[2] << 8)) != VAR_0x8000)
        return ITEM_NONE;
    return script[3] | (script[4] << 8);
}

// The field keeps four sprite palettes past the twelve its people use: the weather's two
// and two for grass, ripples, dust and the like, which load and free as they come. A ball
// taking one of those two starves the next of them, which then draws in a ball's colours.
// The weather's second, though, is only ever the clouds' or the sandstorm's
// (LoadCustomWeatherSpritePalette), and only Route 111 and Route 120 have either: on every
// other map it sits idle, and the balls borrow it.
//
// One palette for both tiers: NPC_3's, the one every item ball draws from, with its three
// reds (11..13) blue and three the ball never uses (8..10, NPC_3's greens) gold. A blue ball
// is the cartridge's picture under it; a gold one is the same picture with its reds moved
// to 8..10 (br_item_ball_gold.png).
static const u16 sShades[][3] =
{
    { RGB(9, 15, 29), RGB(5, 9, 21), RGB(2, 4, 12) },
    { RGB(31, 25, 6), RGB(25, 18, 3), RGB(14, 10, 0) },
};

static const u32 sGoldPic[] = INCGFX_U32("graphics/object_events/pics/misc/br_item_ball_gold.png", ".4bpp");
static const struct SpriteFrameImage sGoldImages[] = { obj_frame_tiles(sGoldPic) };

static u8 PaletteFor(u8 from)
{
    u16 colours[16];
    u8 slot = gWeatherPtr->weatherPicSpritePalIndex;
    u8 i;

    if (slot >= 16 || GetSpritePaletteTagByPaletteNum(slot) != PALTAG_WEATHER_2)
        return 0xFF;
    if (gMapHeader.regionMapSectionId == MAPSEC_ROUTE_111 || gMapHeader.regionMapSectionId == MAPSEC_ROUTE_120)
        return 0xFF;
    for (i = 0; i < 16; i++)
        colours[i] = gPlttBufferUnfaded[OBJ_PLTT_ID(from) + i];
    for (i = 0; i < 3; i++)
    {
        colours[11 + i] = sShades[0][i];
        colours[8 + i] = sShades[1][i];
    }
    LoadPalette(colours, OBJ_PLTT_ID(slot), PLTT_SIZE_4BPP);
    // The weather's colours over it, as pret does for any palette loaded on the field
    // (field_effect.c's LoadFadedPalette): rain and fog dim it like everything else.
    UpdateSpritePaletteWithWeather(slot);
    return slot;
}

// The script of this map's own object with this local id, or NULL. Only the map we are on
// spawns objects, and its templates are the save block's copy.
static const u8 *TemplateScript(const struct ObjectEvent *obj)
{
    u8 i;

    if (obj->mapGroup != gSaveBlock1Ptr->location.mapGroup || obj->mapNum != gSaveBlock1Ptr->location.mapNum)
        return NULL;
    for (i = 0; i < gMapHeader.events->objectEventCount && i < OBJECT_EVENT_TEMPLATES_COUNT; i++)
    {
        if (gSaveBlock1Ptr->objectEventTemplates[i].localId == obj->localId)
            return gSaveBlock1Ptr->objectEventTemplates[i].script;
    }
    return NULL;
}

void BrBalls_Tint(struct ObjectEvent *obj, struct Sprite *sprite)
{
    u16 item;
    u8 tier, slot;

    if (obj->graphicsId != OBJ_EVENT_GFX_ITEM_BALL)
        return;
    item = BrLoot_ItemFor(obj->localId);
    if (item == ITEM_NONE)
        item = BrBalls_Deal(obj->mapGroup, obj->mapNum, obj->localId, ScriptItem(TemplateScript(obj)));
    tier = BrBalls_Tier(item);
    if (tier == BR_BALL_RED)
        return;
    // Route 111 and 120 keep their balls red: a ball and not a hole in the map.
    slot = PaletteFor(sprite->oam.paletteNum);
    if (slot == 0xFF)
        return;
    sprite->oam.paletteNum = slot;
    // Before the sprite's first frame copies its picture, which happens as it animates.
    if (tier == BR_BALL_GOLD)
        sprite->images = sGoldImages;
}

// ---- house caches ---------------------------------------------------------------
//
// Cam, 2026-10-13: "houses get item caches". With the people gone a house had nothing in
// it, and a door is two seconds of fades each way, so what is inside is worth those: one
// ball, gold one time in three and a TM the rest. One a house, the same for every ROM --
// the house and the seed say what, the floor says where -- and the first trainer to take
// it takes it for everybody: the PICKUP goes to the room, and every ROM remembers it.
//
// Every house a town has, and the few on routes, but not the TRICK HOUSE (closed,
// br_match.c), the Frontier's or the Safari's rest house (out of the match), or the
// MYSTERY EVENTS house. And since 2026-10-18 every other floor of a town's buildings and
// of the wild that had nothing on it, no ball of its own (Cam: "an item, trader, or both
// on every floor of a place in a town or in the wild"; POK-413): one cache each, gold
// one time in eight, as there are more of them than houses. The big ones (no house is)
// have somebody standing there who trades a Pokemon for one of yours.
//
// tools/br/floors.py finds the floors and picks the cells, and CI runs it with --check:
// floor you can walk to from a door, from the middle of the room outward, never where it
// would cut off floor beyond it or sit on a table, a sofa or in front of a counter. The
// houses come first, in their old order, so a house's keys are what they were.
struct BrRoom
{
    u16 map;
    u8 cacheX, cacheY;   // without MAP_OFFSET, as the map's own events are
    u8 personX, personY; // whoever is home, or the trader
    bool8 cache;
    u8 trader;           // his key's index, or BR_NO_TRADER
};

#define BR_NO_TRADER 0xFF

#define BR_HOUSES 62
#define BR_ROOM_TRADERS 50
static const struct BrRoom sRooms[] =
{
    { MAP_DEWFORD_TOWN_HOUSE1, 6, 4, 5, 5, TRUE, BR_NO_TRADER },
    { MAP_DEWFORD_TOWN_HOUSE2, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_FALLARBOR_TOWN_COZMOS_HOUSE, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_FALLARBOR_TOWN_MOVE_RELEARNERS_HOUSE, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_FORTREE_CITY_HOUSE1, 6, 2, 6, 3, TRUE, BR_NO_TRADER },
    { MAP_FORTREE_CITY_HOUSE2, 6, 4, 1, 3, TRUE, BR_NO_TRADER },
    { MAP_FORTREE_CITY_HOUSE3, 6, 2, 6, 3, TRUE, BR_NO_TRADER },
    { MAP_FORTREE_CITY_HOUSE4, 6, 3, 7, 3, TRUE, BR_NO_TRADER },
    { MAP_FORTREE_CITY_HOUSE5, 6, 2, 1, 3, TRUE, BR_NO_TRADER },
    { MAP_LAVARIDGE_TOWN_HOUSE, 6, 3, 6, 4, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_HOUSE1, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_HOUSE2, 4, 4, 3, 3, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_HOUSE3, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_HOUSE4, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_MOVE_DELETERS_HOUSE, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_1F, 5, 4, 5, 3, TRUE, BR_NO_TRADER },
    { MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_2F, 3, 3, 3, 5, TRUE, BR_NO_TRADER },
    { MAP_LITTLEROOT_TOWN_MAYS_HOUSE_1F, 5, 4, 5, 3, TRUE, BR_NO_TRADER },
    { MAP_LITTLEROOT_TOWN_MAYS_HOUSE_2F, 5, 3, 5, 5, TRUE, BR_NO_TRADER },
    { MAP_MAUVILLE_CITY_HOUSE1, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_MAUVILLE_CITY_HOUSE2, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_MOSSDEEP_CITY_HOUSE1, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_MOSSDEEP_CITY_HOUSE2, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_MOSSDEEP_CITY_HOUSE3, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_MOSSDEEP_CITY_HOUSE4, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_MOSSDEEP_CITY_STEVENS_HOUSE, 5, 5, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_OLDALE_TOWN_HOUSE1, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_OLDALE_TOWN_HOUSE2, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_PACIFIDLOG_TOWN_HOUSE1, 6, 3, 4, 2, TRUE, BR_NO_TRADER },
    { MAP_PACIFIDLOG_TOWN_HOUSE2, 6, 3, 6, 5, TRUE, BR_NO_TRADER },
    { MAP_PACIFIDLOG_TOWN_HOUSE3, 6, 3, 3, 3, TRUE, BR_NO_TRADER },
    { MAP_PACIFIDLOG_TOWN_HOUSE4, 6, 3, 6, 5, TRUE, BR_NO_TRADER },
    { MAP_PACIFIDLOG_TOWN_HOUSE5, 6, 3, 4, 2, TRUE, BR_NO_TRADER },
    { MAP_PETALBURG_CITY_HOUSE1, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_PETALBURG_CITY_HOUSE2, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_PETALBURG_CITY_WALLYS_HOUSE, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_ROUTE104_MR_BRINEYS_HOUSE, 6, 4, 5, 4, TRUE, BR_NO_TRADER },
    { MAP_ROUTE109_SEASHORE_HOUSE, 7, 5, 6, 4, TRUE, BR_NO_TRADER },
    { MAP_ROUTE111_WINSTRATE_FAMILYS_HOUSE, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_ROUTE114_FOSSIL_MANIACS_HOUSE, 5, 4, 4, 4, TRUE, BR_NO_TRADER },
    { MAP_ROUTE114_LANETTES_HOUSE, 5, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_ROUTE116_TUNNELERS_REST_HOUSE, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_ROUTE119_HOUSE, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_ROUTE123_BERRY_MASTERS_HOUSE, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_ROUTE124_DIVING_TREASURE_HUNTERS_HOUSE, 5, 3, 6, 3, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_CUTTERS_HOUSE, 5, 4, 5, 3, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_HOUSE1, 6, 3, 7, 3, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_HOUSE2, 7, 3, 4, 2, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_HOUSE3, 7, 3, 4, 2, TRUE, BR_NO_TRADER },
    { MAP_SLATEPORT_CITY_HOUSE, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_SLATEPORT_CITY_NAME_RATERS_HOUSE, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_SOOTOPOLIS_CITY_HOUSE1, 5, 2, 6, 2, TRUE, BR_NO_TRADER },
    { MAP_SOOTOPOLIS_CITY_HOUSE2, 6, 2, 2, 3, TRUE, BR_NO_TRADER },
    { MAP_SOOTOPOLIS_CITY_HOUSE3, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_SOOTOPOLIS_CITY_HOUSE4, 2, 2, 6, 2, TRUE, BR_NO_TRADER },
    { MAP_SOOTOPOLIS_CITY_HOUSE5, 6, 2, 2, 3, TRUE, BR_NO_TRADER },
    { MAP_SOOTOPOLIS_CITY_HOUSE6, 3, 2, 4, 2, TRUE, BR_NO_TRADER },
    { MAP_SOOTOPOLIS_CITY_HOUSE7, 5, 2, 6, 2, TRUE, BR_NO_TRADER },
    { MAP_SOOTOPOLIS_CITY_LOTAD_AND_SEEDOT_HOUSE, 5, 2, 5, 3, TRUE, BR_NO_TRADER },
    { MAP_VERDANTURF_TOWN_FRIENDSHIP_RATERS_HOUSE, 4, 3, 3, 2, TRUE, BR_NO_TRADER },
    { MAP_VERDANTURF_TOWN_HOUSE, 5, 4, 4, 3, TRUE, BR_NO_TRADER },
    { MAP_VERDANTURF_TOWN_WANDAS_HOUSE, 8, 4, 7, 3, TRUE, BR_NO_TRADER },
    { MAP_ABANDONED_SHIP_CORRIDORS_1F, 9, 6, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ABANDONED_SHIP_CORRIDORS_B1F, 2, 6, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ABANDONED_SHIP_DECK, 10, 10, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ABANDONED_SHIP_HIDDEN_FLOOR_CORRIDORS, 11, 2, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ABANDONED_SHIP_HIDDEN_FLOOR_ROOMS, 0, 0, 20, 5, FALSE, 0 },
    { MAP_ABANDONED_SHIP_ROOMS_1F, 0, 0, 7, 6, FALSE, 1 },
    { MAP_ALTERING_CAVE, 16, 12, 15, 13, TRUE, 2 },
    { MAP_ANCIENT_TOMB, 4, 21, 5, 21, TRUE, 3 },
    { MAP_AQUA_HIDEOUT_1F, 17, 17, 18, 17, TRUE, 4 },
    { MAP_AQUA_HIDEOUT_B1F, 0, 0, 26, 10, FALSE, 5 },
    { MAP_AQUA_HIDEOUT_B2F, 0, 0, 16, 11, FALSE, 6 },
    { MAP_CAVE_OF_ORIGIN_1F, 8, 8, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_CAVE_OF_ORIGIN_B1F, 6, 12, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_CAVE_OF_ORIGIN_ENTRANCE, 9, 13, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_DESERT_RUINS, 4, 21, 5, 21, TRUE, 7 },
    { MAP_DESERT_UNDERPASS, 69, 9, 70, 9, TRUE, 8 },
    { MAP_DEWFORD_TOWN_HALL, 8, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_1F, 9, 5, 10, 5, TRUE, 9 },
    { MAP_FIERY_PATH, 0, 0, 18, 18, FALSE, 10 },
    { MAP_FORTREE_CITY_DECORATION_SHOP, 5, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_GRANITE_CAVE_1F, 0, 0, 21, 7, FALSE, 11 },
    { MAP_GRANITE_CAVE_B1F, 0, 0, 15, 12, FALSE, 12 },
    { MAP_GRANITE_CAVE_B2F, 0, 0, 16, 14, FALSE, 13 },
    { MAP_GRANITE_CAVE_STEVENS_ROOM, 6, 6, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ISLAND_CAVE, 4, 21, 5, 21, TRUE, 14 },
    { MAP_JAGGED_PASS, 0, 0, 13, 21, FALSE, 15 },
    { MAP_LAVARIDGE_TOWN_HERB_SHOP, 5, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_CONTEST_HALL, 24, 17, 25, 17, TRUE, 16 },
    { MAP_LILYCOVE_CITY_CONTEST_LOBBY, 15, 6, 14, 5, TRUE, 17 },
    { MAP_LILYCOVE_CITY_COVE_LILY_MOTEL_1F, 6, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_COVE_LILY_MOTEL_2F, 6, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_DEPARTMENT_STORE_1F, 10, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_DEPARTMENT_STORE_2F, 9, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_DEPARTMENT_STORE_3F, 8, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_DEPARTMENT_STORE_4F, 8, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_DEPARTMENT_STORE_5F, 8, 6, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_DEPARTMENT_STORE_ROOFTOP, 8, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_HARBOR, 9, 11, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_LILYCOVE_CITY_LILYCOVE_MUSEUM_1F, 10, 7, 11, 6, TRUE, 18 },
    { MAP_LILYCOVE_CITY_LILYCOVE_MUSEUM_2F, 11, 7, 12, 7, TRUE, 19 },
    { MAP_LILYCOVE_CITY_POKEMON_TRAINER_FAN_CLUB, 6, 7, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MAGMA_HIDEOUT_1F, 0, 0, 22, 14, FALSE, 20 },
    { MAP_MAGMA_HIDEOUT_2F_1R, 16, 19, 15, 19, TRUE, 21 },
    { MAP_MAGMA_HIDEOUT_2F_2R, 0, 0, 25, 13, FALSE, 22 },
    { MAP_MAGMA_HIDEOUT_2F_3R, 21, 11, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MAGMA_HIDEOUT_3F_1R, 0, 0, 15, 10, FALSE, 23 },
    { MAP_MAGMA_HIDEOUT_4F, 0, 0, 29, 14, FALSE, 24 },
    { MAP_MARINE_CAVE_END, 14, 13, 15, 13, TRUE, 25 },
    { MAP_MARINE_CAVE_ENTRANCE, 7, 7, 8, 6, TRUE, 26 },
    { MAP_MAUVILLE_CITY_BIKE_SHOP, 5, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MAUVILLE_CITY_GAME_CORNER, 11, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_METEOR_FALLS_1F_1R, 0, 0, 16, 20, FALSE, 27 },
    { MAP_METEOR_FALLS_1F_2R, 14, 16, 13, 16, TRUE, 28 },
    { MAP_METEOR_FALLS_B1F_1R, 14, 19, 15, 18, TRUE, 29 },
    { MAP_METEOR_FALLS_STEVENS_CAVE, 17, 15, 17, 16, TRUE, 30 },
    { MAP_MIRAGE_TOWER_1F, 5, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MIRAGE_TOWER_2F, 5, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MIRAGE_TOWER_3F, 5, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MIRAGE_TOWER_4F, 4, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MOSSDEEP_CITY_GAME_CORNER_1F, 6, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MOSSDEEP_CITY_GAME_CORNER_B1F, 5, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MOSSDEEP_CITY_SPACE_CENTER_1F, 8, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MOSSDEEP_CITY_SPACE_CENTER_2F, 8, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MT_CHIMNEY, 18, 21, 21, 25, TRUE, 31 },
    { MAP_MT_CHIMNEY_CABLE_CAR_STATION, 4, 7, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MT_PYRE_1F, 11, 7, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_MT_PYRE_EXTERIOR, 0, 0, 17, 27, FALSE, 32 },
    { MAP_MT_PYRE_SUMMIT, 24, 17, 24, 19, TRUE, 33 },
    { MAP_NEW_MAUVILLE_ENTRANCE, 3, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_PETALBURG_WOODS, 0, 0, 26, 22, FALSE, 34 },
    { MAP_ROUTE104_PRETTY_PETAL_FLOWER_SHOP, 8, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ROUTE110_SEASIDE_CYCLING_ROAD_NORTH_ENTRANCE, 5, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ROUTE110_SEASIDE_CYCLING_ROAD_SOUTH_ENTRANCE, 5, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ROUTE111_OLD_LADYS_REST_STOP, 5, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ROUTE112_CABLE_CAR_STATION, 4, 7, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ROUTE113_GLASS_WORKSHOP, 4, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ROUTE114_FOSSIL_MANIACS_TUNNEL, 6, 13, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ROUTE117_POKEMON_DAY_CARE, 6, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_ROUTE119_WEATHER_INSTITUTE_1F, 9, 6, 8, 4, TRUE, 35 },
    { MAP_ROUTE119_WEATHER_INSTITUTE_2F, 10, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_DEVON_CORP_1F, 9, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_DEVON_CORP_2F, 9, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_DEVON_CORP_3F, 7, 2, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_FLAT1_1F, 7, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_FLAT1_2F, 6, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_FLAT2_1F, 6, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_FLAT2_2F, 6, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_FLAT2_3F, 6, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_RUSTBORO_CITY_POKEMON_SCHOOL, 6, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_RUSTURF_TUNNEL, 0, 0, 18, 15, FALSE, 36 },
    { MAP_SEAFLOOR_CAVERN_ENTRANCE, 7, 7, 8, 7, TRUE, 37 },
    { MAP_SEAFLOOR_CAVERN_ROOM1, 12, 8, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SEAFLOOR_CAVERN_ROOM2, 7, 6, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SEAFLOOR_CAVERN_ROOM3, 7, 7, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SEAFLOOR_CAVERN_ROOM4, 11, 11, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SEAFLOOR_CAVERN_ROOM5, 8, 8, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SEAFLOOR_CAVERN_ROOM6, 5, 4, 5, 5, TRUE, 38 },
    { MAP_SEAFLOOR_CAVERN_ROOM7, 3, 19, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SEAFLOOR_CAVERN_ROOM8, 3, 8, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SEAFLOOR_CAVERN_ROOM9, 0, 0, 13, 23, FALSE, 39 },
    { MAP_SEALED_CHAMBER_INNER_ROOM, 10, 11, 9, 10, TRUE, 40 },
    { MAP_SEALED_CHAMBER_OUTER_ROOM, 8, 9, 8, 11, TRUE, 41 },
    { MAP_SHOAL_CAVE_LOW_TIDE_ENTRANCE_ROOM, 0, 0, 18, 17, FALSE, 42 },
    { MAP_SHOAL_CAVE_LOW_TIDE_ICE_ROOM, 0, 0, 10, 15, FALSE, 43 },
    { MAP_SHOAL_CAVE_LOW_TIDE_INNER_ROOM, 0, 0, 23, 19, FALSE, 44 },
    { MAP_SHOAL_CAVE_LOW_TIDE_LOWER_ROOM, 13, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SKY_PILLAR_1F, 10, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SKY_PILLAR_2F, 10, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SKY_PILLAR_3F, 10, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SKY_PILLAR_4F, 10, 5, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SKY_PILLAR_5F, 11, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SKY_PILLAR_ENTRANCE, 8, 8, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SKY_PILLAR_OUTSIDE, 13, 10, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SKY_PILLAR_TOP, 12, 11, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SLATEPORT_CITY_HARBOR, 9, 11, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SLATEPORT_CITY_OCEANIC_MUSEUM_1F, 11, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SLATEPORT_CITY_OCEANIC_MUSEUM_2F, 10, 4, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SLATEPORT_CITY_POKEMON_FAN_CLUB, 5, 3, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_SLATEPORT_CITY_STERNS_SHIPYARD_1F, 9, 8, 8, 6, TRUE, 45 },
    { MAP_SLATEPORT_CITY_STERNS_SHIPYARD_2F, 7, 6, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_TERRA_CAVE_END, 10, 12, 11, 12, TRUE, 46 },
    { MAP_TERRA_CAVE_ENTRANCE, 11, 10, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_TRAINER_HILL_ENTRANCE, 9, 8, 0, 0, TRUE, BR_NO_TRADER },
    { MAP_VICTORY_ROAD_1F, 0, 0, 23, 22, FALSE, 47 },
    { MAP_VICTORY_ROAD_B1F, 0, 0, 22, 14, FALSE, 48 },
    { MAP_VICTORY_ROAD_B2F, 0, 0, 23, 19, FALSE, 49 },
};

// A cache's key is its room's index, in the key space's nobody half beside the Zone's
// balls and the chest; a trader's is the home keys' upper half (br_loot.h).
STATIC_ASSERT(ARRAY_COUNT(sRooms) <= 0x100, BrCacheKeysFitTheirByte)
#define BR_TRADERS BR_LOOT_FLOOR_TRADERS
STATIC_ASSERT(BR_ROOM_TRADERS <= BR_TRADERS, BrFloorTradersFitTheirKeys)

// Plain statics, in IWRAM like br_spectate.c's: EWRAM is within a few dozen bytes of its
// floor, and these are a few bits a room, read when we walk in.
static u8 sCacheTaken[(ARRAY_COUNT(sRooms) + 7) / 8];
static u8 sTraderTaken[BR_TRADERS / 8];
// The map the last room's things went down for, so they leave the table when we leave:
// rows outlive their maps (br_loot.c's Evict), and these are put back from here, not
// from the page, every time we walk in. sRoom is that map's row in sRooms, or -1.
static EWRAM_DATA u16 sCacheMap = 0;
static s16 sRoom;

static s16 RoomIndex(u16 map)
{
    u16 i;

    for (i = 0; i < ARRAY_COUNT(sRooms); i++)
    {
        if (sRooms[i].map == map)
            return i;
    }
    return -1;
}

static u16 CacheItem(u8 room)
{
    u32 r = Mix(gBrMatch.seed ^ 0xCA5E ^ room);

    if (r % (room < BR_HOUSES ? 3 : 8) == 0)
        return sGold[Mix(r) % ARRAY_COUNT(sGold)];
    return BlueTm(Mix(r));
}

// ---- somebody at home --------------------------------------------------------------
//
// Cam, 2026-10-13, again 2026-10-18 (POK-379): people in houses trade or give Pokemon.
// One house in eight has somebody home, the same eighth for every ROM, and he stands
// beside the cache with a Pokemon: half of them give it to the first trainer who talks to
// them, half trade it for one of theirs. Once, for everybody, by the cache's rule. What
// they have is what Hoenn's own people give and trade: a starter, Kanto's or Hoenn's, a
// CASTFORM or a SNORLAX, or one that evolves on the way over (br_loot.c, TradedInto).
#define BR_HOME_IN 8
// ...and so do the keys, 0x8C00 | house, in their byte below the caches' (br_loot.h).
STATIC_ASSERT((BR_HOUSES + BR_HOME_IN - 1) / BR_HOME_IN <= 8, BrHomeBitsFitAByte)

static const u16 sHomeMons[] =
{
    SPECIES_TREECKO, SPECIES_TORCHIC, SPECIES_MUDKIP,
    SPECIES_BULBASAUR, SPECIES_CHARMANDER, SPECIES_SQUIRTLE,
    SPECIES_KADABRA, SPECIES_MACHOKE, SPECIES_GRAVELER, SPECIES_HAUNTER,
    SPECIES_CASTFORM, SPECIES_SNORLAX,
};

// A bit for each house that has somebody home, by house / BR_HOME_IN.
static EWRAM_DATA u8 sHomeTaken = 0;

static bool8 Home(u8 house)
{
    return house % BR_HOME_IN == Mix(gBrMatch.seed ^ 0x40E) % BR_HOME_IN;
}

static u32 HomeDraw(u8 house)
{
    return Mix(gBrMatch.seed ^ 0x40E5 ^ house);
}

bool8 BrBalls_Trades(u16 key)
{
    u16 i = key - BR_LOOT_KEY_HOME(0);

    if (!BR_LOOT_IS_HOME(key))
        return FALSE;
    if (key >= BR_LOOT_KEY_FLOOR_TRADER(0))
        return TRUE;
    return i < BR_HOUSES && (Mix(HomeDraw(i)) & 1);
}

static bool8 Flag(const u8 *bits, u16 i)
{
    return (bits[i / 8] >> (i % 8)) & 1;
}

void BrBalls_Init(void)
{
    memset(sCacheTaken, 0, sizeof(sCacheTaken));
    memset(sTraderTaken, 0, sizeof(sTraderTaken));
    sHomeTaken = 0;
    sCacheMap = 0xFFFF; // no map is (0xFF, 0xFF)
    sRoom = -1;
}

void BrBalls_NoteTaken(u16 key)
{
    u16 i = key - BR_LOOT_KEY_CACHE(0);

    if ((key & 0xFF00) == BR_LOOT_KEY_CACHE(0) && i < ARRAY_COUNT(sRooms))
        sCacheTaken[i / 8] |= 1 << (i % 8);
    if (!BR_LOOT_IS_HOME(key))
        return;
    if (key >= BR_LOOT_KEY_FLOOR_TRADER(0))
    {
        i = key - BR_LOOT_KEY_FLOOR_TRADER(0);
        sTraderTaken[i / 8] |= 1 << (i % 8);
    }
    else if (key - BR_LOOT_KEY_HOME(0) < BR_HOUSES)
    {
        sHomeTaken |= 1 << ((key - BR_LOOT_KEY_HOME(0)) / BR_HOME_IN);
    }
}

bool8 BrBalls_Spot(s16 x, s16 y)
{
    const struct BrRoom *room;
    u16 here = (gSaveBlock1Ptr->location.mapGroup << 8) | gSaveBlock1Ptr->location.mapNum;

    if (here != sCacheMap || sRoom < 0)
        return FALSE;
    room = &sRooms[sRoom];
    x -= MAP_OFFSET;
    y -= MAP_OFFSET;
    return (room->cache && x == room->cacheX && y == room->cacheY)
        || ((sRoom < BR_HOUSES || room->trader != BR_NO_TRADER) && x == room->personX && y == room->personY);
}

static void DropRoom(s16 i)
{
    if (i < 0)
        return;
    if (sRooms[i].cache)
        BrLoot_DropKey(BR_LOOT_KEY_CACHE(i));
    if (i < BR_HOUSES)
        BrLoot_DropKey(BR_LOOT_KEY_HOME(i));
    if (sRooms[i].trader != BR_NO_TRADER)
        BrLoot_DropKey(BR_LOOT_KEY_FLOOR_TRADER(sRooms[i].trader));
}

void BrBalls_Tick(void)
{
    u8 group = gSaveBlock1Ptr->location.mapGroup, num = gSaveBlock1Ptr->location.mapNum;
    u16 here = (group << 8) | num;
    const struct BrRoom *room;
    u16 species;

    if (gBrMatch.seed == 0 || here == sCacheMap)
        return;
    DropRoom(sRoom);
    sCacheMap = here;
    sRoom = RoomIndex(here);
    if (sRoom < 0)
        return;
    room = &sRooms[sRoom];
    if (room->cache && !Flag(sCacheTaken, sRoom))
        BrLoot_AddItem(BR_LOOT_KEY_CACHE(sRoom), group, num,
                       room->cacheX + MAP_OFFSET, room->cacheY + MAP_OFFSET, CacheItem(sRoom));
    if (sRoom < BR_HOUSES && Home(sRoom) && !(sHomeTaken & (1 << (sRoom / BR_HOME_IN))))
    {
        species = sHomeMons[HomeDraw(sRoom) % ARRAY_COUNT(sHomeMons)];
        BrLoot_AddMon(BR_LOOT_KEY_HOME(sRoom), group, num,
                      room->personX + MAP_OFFSET, room->personY + MAP_OFFSET, species, 0);
    }
    if (room->trader != BR_NO_TRADER && !Flag(sTraderTaken, room->trader))
    {
        species = sHomeMons[Mix(gBrMatch.seed ^ 0xF100 ^ room->trader) % ARRAY_COUNT(sHomeMons)];
        BrLoot_AddMon(BR_LOOT_KEY_FLOOR_TRADER(room->trader), group, num,
                      room->personX + MAP_OFFSET, room->personY + MAP_OFFSET, species, 0);
    }
}
