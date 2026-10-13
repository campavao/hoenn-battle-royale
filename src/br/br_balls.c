// Coloured balls and the TMs in them. See include/br/br_balls.h.
#include "global.h"
#include "event_object_movement.h"
#include "event_data.h"
#include "fieldmap.h"
#include "palette.h"
#include "constants/rgb.h"
#include "sprite.h"
#include "constants/event_objects.h"
#include "constants/map_groups.h"
#include "constants/metatile_behaviors.h"
#include "constants/items.h"
#include "constants/vars.h"
#include "br/br_balls.h"
#include "br/br_loot.h"
#include "br/br_match.h"

// One ball in four (Cam: "about 1 blue for every 3 red").
#define BR_BALLS_TM_IN 4

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

    // A machine stays a machine; an HM or a key item is the story's, not the match's.
    if (gBrMatch.seed == 0 || item == ITEM_NONE || item >= ITEM_TM01)
        return item;
    r = Mix(gBrMatch.seed ^ 0xBA11 ^ ((u32)mapGroup << 16) ^ ((u32)mapNum << 8) ^ localId);
    if (r % BR_BALLS_TM_IN != 0)
        return item;
    return BlueTm(Mix(r));
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

// Red is the picture's own. Blue and gold swap its three reds -- palette indices 11..13
// of NPC_3, the slot every item ball draws from -- and keep the rest: the white, the band,
// the outline. One tag each, loaded once into the field's spare slots.
#define BR_BALLS_PAL_TAG 0x5B00

// A tier's three, light to dark: BR_BALL_BLUE's first, then BR_BALL_GOLD's.
static const u16 sShades[][3] =
{
    { RGB(9, 15, 29), RGB(5, 9, 21), RGB(2, 4, 12) },
    { RGB(31, 25, 6), RGB(25, 18, 3), RGB(14, 10, 0) },
};

static u8 PaletteFor(u8 tier, u8 from)
{
    struct SpritePalette pal;
    u16 colours[16];
    u8 slot = IndexOfSpritePaletteTag(BR_BALLS_PAL_TAG + tier);
    u8 i;

    if (slot != 0xFF)
        return slot;
    for (i = 0; i < 16; i++)
        colours[i] = gPlttBufferUnfaded[OBJ_PLTT_ID(from) + i];
    colours[11] = sShades[tier - BR_BALL_BLUE][0];
    colours[12] = sShades[tier - BR_BALL_BLUE][1];
    colours[13] = sShades[tier - BR_BALL_BLUE][2];
    pal.data = colours;
    pal.tag = BR_BALLS_PAL_TAG + tier;
    return LoadSpritePalette(&pal);
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
    // Four slots spare on the field, and the weather and the field effects want them too:
    // with none left the ball stays red, which is a ball and not a hole in the map.
    slot = PaletteFor(tier, sprite->oam.paletteNum);
    if (slot != 0xFF)
        sprite->oam.paletteNum = slot;
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
// MYSTERY EVENTS house.
static const u16 sHouses[] =
{
    MAP_DEWFORD_TOWN_HOUSE1, MAP_DEWFORD_TOWN_HOUSE2,
    MAP_FALLARBOR_TOWN_COZMOS_HOUSE, MAP_FALLARBOR_TOWN_MOVE_RELEARNERS_HOUSE,
    MAP_FORTREE_CITY_HOUSE1, MAP_FORTREE_CITY_HOUSE2,
    MAP_FORTREE_CITY_HOUSE3, MAP_FORTREE_CITY_HOUSE4,
    MAP_FORTREE_CITY_HOUSE5, MAP_LAVARIDGE_TOWN_HOUSE,
    MAP_LILYCOVE_CITY_HOUSE1, MAP_LILYCOVE_CITY_HOUSE2,
    MAP_LILYCOVE_CITY_HOUSE3, MAP_LILYCOVE_CITY_HOUSE4,
    MAP_LILYCOVE_CITY_MOVE_DELETERS_HOUSE, MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_1F,
    MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_2F, MAP_LITTLEROOT_TOWN_MAYS_HOUSE_1F,
    MAP_LITTLEROOT_TOWN_MAYS_HOUSE_2F, MAP_MAUVILLE_CITY_HOUSE1,
    MAP_MAUVILLE_CITY_HOUSE2, MAP_MOSSDEEP_CITY_HOUSE1,
    MAP_MOSSDEEP_CITY_HOUSE2, MAP_MOSSDEEP_CITY_HOUSE3,
    MAP_MOSSDEEP_CITY_HOUSE4, MAP_MOSSDEEP_CITY_STEVENS_HOUSE,
    MAP_OLDALE_TOWN_HOUSE1, MAP_OLDALE_TOWN_HOUSE2,
    MAP_PACIFIDLOG_TOWN_HOUSE1, MAP_PACIFIDLOG_TOWN_HOUSE2,
    MAP_PACIFIDLOG_TOWN_HOUSE3, MAP_PACIFIDLOG_TOWN_HOUSE4,
    MAP_PACIFIDLOG_TOWN_HOUSE5, MAP_PETALBURG_CITY_HOUSE1,
    MAP_PETALBURG_CITY_HOUSE2, MAP_PETALBURG_CITY_WALLYS_HOUSE,
    MAP_ROUTE104_MR_BRINEYS_HOUSE, MAP_ROUTE109_SEASHORE_HOUSE,
    MAP_ROUTE111_WINSTRATE_FAMILYS_HOUSE, MAP_ROUTE114_FOSSIL_MANIACS_HOUSE,
    MAP_ROUTE114_LANETTES_HOUSE, MAP_ROUTE116_TUNNELERS_REST_HOUSE,
    MAP_ROUTE119_HOUSE, MAP_ROUTE123_BERRY_MASTERS_HOUSE,
    MAP_ROUTE124_DIVING_TREASURE_HUNTERS_HOUSE, MAP_RUSTBORO_CITY_CUTTERS_HOUSE,
    MAP_RUSTBORO_CITY_HOUSE1, MAP_RUSTBORO_CITY_HOUSE2,
    MAP_RUSTBORO_CITY_HOUSE3, MAP_SLATEPORT_CITY_HOUSE,
    MAP_SLATEPORT_CITY_NAME_RATERS_HOUSE, MAP_SOOTOPOLIS_CITY_HOUSE1,
    MAP_SOOTOPOLIS_CITY_HOUSE2, MAP_SOOTOPOLIS_CITY_HOUSE3,
    MAP_SOOTOPOLIS_CITY_HOUSE4, MAP_SOOTOPOLIS_CITY_HOUSE5,
    MAP_SOOTOPOLIS_CITY_HOUSE6, MAP_SOOTOPOLIS_CITY_HOUSE7,
    MAP_SOOTOPOLIS_CITY_LOTAD_AND_SEEDOT_HOUSE, MAP_VERDANTURF_TOWN_FRIENDSHIP_RATERS_HOUSE,
    MAP_VERDANTURF_TOWN_HOUSE, MAP_VERDANTURF_TOWN_WANDAS_HOUSE,
};

#define BR_CACHE_BYTES ((ARRAY_COUNT(sHouses) + 7) / 8)
// The key space's nobody half, beside the Zone's balls and the chest (br_loot.h).
STATIC_ASSERT(ARRAY_COUNT(sHouses) <= 0x100, BrCacheKeysFitTheirByte)

static EWRAM_DATA u8 sCacheTaken[BR_CACHE_BYTES] = {0};
// The map the last cache went down for, so a cache leaves the table when we leave its
// house: rows outlive their maps (br_loot.c's Evict), and this one is put back from here,
// not from the page, every time we walk in.
static EWRAM_DATA u16 sCacheMap = 0;

static s16 HouseIndex(u16 map)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sHouses); i++)
    {
        if (sHouses[i] == map)
            return i;
    }
    return -1;
}

static u16 CacheItem(u8 house)
{
    u32 r = Mix(gBrMatch.seed ^ 0xCA5E ^ house);

    if (r % 3 == 0)
        return sGold[Mix(r) % ARRAY_COUNT(sGold)];
    return BlueTm(Mix(r));
}

// Floor you can stand on, two steps clear of every door, and not where one of the house's
// own people stood. Read off the map, so every ROM finds the same cell.
static bool8 CacheCellOk(s16 x, s16 y)
{
    const struct MapEvents *events = gMapHeader.events;
    u8 i;

    if (x < MAP_OFFSET || y < MAP_OFFSET
     || x >= gMapHeader.mapLayout->width + MAP_OFFSET || y >= gMapHeader.mapLayout->height + MAP_OFFSET)
        return FALSE;
    if (MapGridGetCollisionAt(x, y) != 0 || MapGridGetMetatileBehaviorAt(x, y) != MB_NORMAL)
        return FALSE;
    for (i = 0; i < events->warpCount; i++)
    {
        s16 dx = x - (events->warps[i].x + MAP_OFFSET);
        s16 dy = y - (events->warps[i].y + MAP_OFFSET);

        if ((dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy) <= 2)
            return FALSE;
    }
    for (i = 0; i < events->objectEventCount; i++)
    {
        if (events->objectEvents[i].x + MAP_OFFSET == x && events->objectEvents[i].y + MAP_OFFSET == y)
            return FALSE;
    }
    return TRUE;
}

// From the middle of the room outward, a ring at a time, each ring row by row.
static bool8 CacheCell(s16 *outX, s16 *outY)
{
    s16 w = gMapHeader.mapLayout->width, h = gMapHeader.mapLayout->height;
    s16 cx = w / 2 + MAP_OFFSET, cy = h / 2 + MAP_OFFSET;
    s16 r, dx, dy;

    for (r = 0; r < (w > h ? w : h); r++)
    {
        for (dy = -r; dy <= r; dy++)
        {
            for (dx = -r; dx <= r; dx++)
            {
                if (dx != -r && dx != r && dy != -r && dy != r)
                    continue;
                if (CacheCellOk(cx + dx, cy + dy))
                {
                    *outX = cx + dx;
                    *outY = cy + dy;
                    return TRUE;
                }
            }
        }
    }
    return FALSE;
}

void BrBalls_Init(void)
{
    CpuFill32(0, sCacheTaken, sizeof(sCacheTaken));
    sCacheMap = 0xFFFF; // no map is (0xFF, 0xFF)
}

void BrBalls_NoteTaken(u16 key)
{
    u16 i = key - BR_LOOT_KEY_CACHE(0);

    if ((key & 0xFF00) == BR_LOOT_KEY_CACHE(0) && i < ARRAY_COUNT(sHouses))
        sCacheTaken[i / 8] |= 1 << (i % 8);
}

void BrBalls_Tick(void)
{
    u8 group = gSaveBlock1Ptr->location.mapGroup, num = gSaveBlock1Ptr->location.mapNum;
    u16 here = (group << 8) | num;
    s16 house, x, y;

    if (gBrMatch.seed == 0 || here == sCacheMap)
        return;
    house = HouseIndex(sCacheMap);
    if (house >= 0)
        BrLoot_DropKey(BR_LOOT_KEY_CACHE(house));
    sCacheMap = here;
    house = HouseIndex(here);
    if (house < 0 || (sCacheTaken[house / 8] & (1 << (house % 8))))
        return;
    if (CacheCell(&x, &y))
        BrLoot_AddItem(BR_LOOT_KEY_CACHE(house), group, num, x, y, CacheItem(house));
}
