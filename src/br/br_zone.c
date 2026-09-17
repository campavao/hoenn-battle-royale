// The Safari's catch pool, dealt from the match seed (POK-255). See include/br/br_zone.h.
#include "global.h"
#include "random.h"
#include "constants/species.h"
#include "constants/items.h"
#include "constants/maps.h"
#include "fieldmap.h"
#include "br/br_loot.h"
#include "br/br_match.h"
#include "br/br_zone.h"

EWRAM_DATA struct BrZone gBrZone = {0};

// Worth going looking for: the three starters, the two pseudo-legendary lines, and the
// handful of Hoenn mons a sixteen-minute match can actually turn into something.
static const u16 sRare[] =
{
    SPECIES_TREECKO, SPECIES_TORCHIC, SPECIES_MUDKIP,
    SPECIES_BAGON, SPECIES_BELDUM, SPECIES_RALTS, SPECIES_ABRA,
    SPECIES_TRAPINCH, SPECIES_SWABLU, SPECIES_FEEBAS, SPECIES_ANORITH, SPECIES_LILEEP,
};

// And something to throw a ball at: the commons that hold a team together.
static const u16 sOpen[] =
{
    SPECIES_POOCHYENA, SPECIES_ZIGZAGOON, SPECIES_WURMPLE, SPECIES_LOTAD, SPECIES_SEEDOT,
    SPECIES_TAILLOW, SPECIES_WINGULL, SPECIES_SURSKIT, SPECIES_SHROOMISH, SPECIES_SLAKOTH,
    SPECIES_NINCADA, SPECIES_WHISMUR, SPECIES_MAKUHITA, SPECIES_ARON, SPECIES_MEDITITE,
    SPECIES_ELECTRIKE, SPECIES_GULPIN, SPECIES_CARVANHA, SPECIES_NUMEL, SPECIES_TORKOAL,
    SPECIES_SPOINK, SPECIES_TRAPINCH, SPECIES_CACNEA, SPECIES_ZANGOOSE, SPECIES_SEVIPER,
    SPECIES_BARBOACH, SPECIES_CORPHISH, SPECIES_BALTOY, SPECIES_SHUPPET, SPECIES_DUSKULL,
    SPECIES_ODDISH, SPECIES_PIKACHU, SPECIES_PSYDUCK, SPECIES_GEODUDE, SPECIES_MACHOP,
    SPECIES_MAGIKARP, SPECIES_TENTACOOL, SPECIES_GOLDEEN, SPECIES_WAILMER, SPECIES_SKITTY,
};

// clock.ts's mulberry32, to the bit. The page deals bots and drops with this one, and a
// pool that has to match across a room is a pool both sides work out the same way --
// so it is the same generator here rather than the ROM's own Random(), which the page
// has no copy of.
static u32 sState;

static void SeedPool(u32 seed)
{
    sState = seed;
}

static u32 NextU32(void)
{
    u32 t;

    sState += 0x6d2b79f5;
    t = sState;
    t = (t ^ (t >> 15)) * (1 | t);
    t += (t ^ (t >> 7)) * (61 | t);
    t ^= t >> 14;
    return t;
}

static u16 PickFrom(const u16 *table, u8 count)
{
    return table[NextU32() % count];
}

// A species already dealt is dealt again as the next one along, so twelve slots are
// twelve different things to catch rather than four Zigzagoon.
static bool8 Taken(u8 upto, u16 species)
{
    u8 i;

    for (i = 0; i < upto; i++)
    {
        if (gBrZone.species[i] == species)
            return TRUE;
    }
    return FALSE;
}

// What a ball in the Zone can hold. Nothing here is a match-winner on its own -- the
// Master Ball below is the one that is, and it is dealt separately.
static const u16 sBallItems[] =
{
    ITEM_ULTRA_BALL, ITEM_GREAT_BALL, ITEM_HYPER_POTION, ITEM_FULL_RESTORE, ITEM_REVIVE,
    ITEM_MAX_POTION, ITEM_FULL_HEAL, ITEM_X_ATTACK, ITEM_X_SPEED, ITEM_RARE_CANDY,
    ITEM_FIRE_STONE, ITEM_WATER_STONE, ITEM_THUNDER_STONE, ITEM_LEAF_STONE, ITEM_SUN_STONE,
    ITEM_MOON_STONE, ITEM_NUGGET, ITEM_PP_UP,
};

// And the machines. Kanto's rule for what a Zone ball is worth (README, "the zone's item
// balls are dealt too"): *a strong TM most often*, then the rest. That weighting is what
// makes the MOVES row a real choice -- the eight HMs are the only machines a match grants
// otherwise, and a menu of CUT and FLASH is not a menu.
//
// One of each type that matters, so almost any party finds something it can take, and
// nothing that needs a second item or a specific partner to be worth the detour. They are
// named after their moves on the ground (POK-264), so the line reads FOUND ICE BEAM!.
static const u16 sBallTMs[] =
{
    ITEM_TM02, // DRAGON CLAW
    ITEM_TM06, // TOXIC
    ITEM_TM13, // ICE BEAM
    ITEM_TM14, // BLIZZARD
    ITEM_TM15, // HYPER BEAM
    ITEM_TM19, // GIGA DRAIN
    ITEM_TM22, // SOLARBEAM
    ITEM_TM24, // THUNDERBOLT
    ITEM_TM25, // THUNDER
    ITEM_TM26, // EARTHQUAKE
    ITEM_TM29, // PSYCHIC
    ITEM_TM30, // SHADOW BALL
    ITEM_TM31, // BRICK BREAK
    ITEM_TM35, // FLAMETHROWER
    ITEM_TM36, // SLUDGE BOMB
    ITEM_TM38, // FIRE BLAST
    ITEM_TM40, // AERIAL ACE
    ITEM_TM50, // OVERHEAT
};

// How often a ball holds one. Six areas, so about three machines are on the ground in a
// match -- and a contestant walks past one or two areas in a two-minute opening, which is
// what "most often" has to mean to be felt at all.
#define BR_ZONE_TM_IN 2

// ---- the DAY CARE, which is a chest (POK-306) -------------------------------------
//
// Cam, live: "block off the battle tent and the daycare center, though daycare could be a
// chest where the first one there takes the Pokemon." Every other piece of loot in a match
// is a consequence -- somebody lost it. This is the one thing on the ground that is a
// reason to run somewhere on purpose, and a reason to expect company when you arrive.
//
// What is in it is fully evolved and worth the trip, because the trip is most of a ring
// phase for most drops. Nothing here is a trade evolution (the ground finishes those on
// its own, TradedInto) and nothing here is legendary: a match is sixteen minutes and the
// prize has to be beatable by whoever did not get it.
static const u16 sChest[] =
{
    SPECIES_SALAMENCE, SPECIES_METAGROSS, SPECIES_FLYGON, SPECIES_ALTARIA, SPECIES_MILOTIC,
    SPECIES_GARDEVOIR, SPECIES_SLAKING, SPECIES_AGGRON, SPECIES_ABSOL, SPECIES_SHARPEDO,
    SPECIES_WALREIN, SPECIES_ARMALDO, SPECIES_CRADILY, SPECIES_BRELOOM, SPECIES_MANECTRIC,
    SPECIES_SWAMPERT, SPECIES_SCEPTILE, SPECIES_BLAZIKEN,
};

// The room is twelve by nine with the door at the bottom left; this is the middle of its
// floor, three tiles in from the mat and the first thing in the frame walking in.
#define BR_CHEST_X 5
#define BR_CHEST_Y 5
// Its key, in the "belongs to nobody" space the Zone's own balls use: no trade evolution
// runs off it, and no seat can mint a key that collides. 0x8E00 would be trainer 1536 in
// party slot 1, and Emerald's last trainer id is 854.
#define BR_CHEST_KEY 0x8E00

// Where the balls lie: one per area, each as far from that area's four spawn cells as
// the grid allows, three tiles clear of the edges and two of every warp. A ball on a
// spawn cell is a ball somebody takes without looking for it.
static const u8 sSafariItemCells[][3] =   // mapNum, x, y -- map group 26
{
    {  0,  8, 36 },  // NORTHWEST
    {  1, 19,  8 },  // NORTH
    { 12,  5, 20 },  // NORTHEAST
    {  2, 31, 21 },  // SOUTHWEST
    {  3,  4, 20 },  // SOUTH
    { 13, 30, 20 },  // SOUTHEAST
};

// Kanto's one-in-eight (v0.49.0). Drawn from the same stream as everything else, so a
// match either has one in it or does not, and every ROM in the room agrees which.
#define BR_ZONE_MASTER_ODDS 8

void BrZone_Init(void)
{
    CpuFill32(0, &gBrZone, sizeof(gBrZone));
}

void BrZone_Ensure(void)
{
    u8 i, tries;

    if (gBrMatch.seed == 0 || gBrZone.dealtFor == gBrMatch.seed)
        return;
    SeedPool(gBrMatch.seed ^ 0x5A17);
    for (i = 0; i < BR_ZONE_SLOTS; i++)
    {
        const u16 *table = i < BR_ZONE_RARES ? sRare : sOpen;
        u8 count = i < BR_ZONE_RARES ? ARRAY_COUNT(sRare) : ARRAY_COUNT(sOpen);
        u16 species = PickFrom(table, count);

        for (tries = 0; tries < 8 && Taken(i, species); tries++)
            species = PickFrom(table, count);
        gBrZone.species[i] = species;
    }
    // And the balls (POK-261): one per area, and a one-in-eight chance the first is the
    // Master Ball rather than what it would otherwise have been.
    for (i = 0; i < BR_ZONE_ITEMS; i++)
    {
        if (NextU32() % BR_ZONE_TM_IN == 0)
            gBrZone.items[i] = PickFrom(sBallTMs, ARRAY_COUNT(sBallTMs));
        else
            gBrZone.items[i] = PickFrom(sBallItems, ARRAY_COUNT(sBallItems));
    }
    if (NextU32() % BR_ZONE_MASTER_ODDS == 0)
        gBrZone.items[NextU32() % BR_ZONE_ITEMS] = ITEM_MASTER_BALL;
    // And the one in the DAY CARE, off the end of the same stream (POK-306).
    gBrZone.chest = PickFrom(sChest, ARRAY_COUNT(sChest));
    gBrZone.placed = FALSE;
    gBrZone.chestPlaced = FALSE;
    gBrZone.dealtFor = gBrMatch.seed;
}

void BrZone_PlaceItems(void)
{
    u8 i;

    if (gBrZone.placed || gBrZone.dealtFor == 0)
        return;
    gBrZone.placed = TRUE;
    for (i = 0; i < BR_ZONE_ITEMS && i < ARRAY_COUNT(sSafariItemCells); i++)
    {
        const u8 *cell = sSafariItemCells[i];

        // The key's top bit says it belongs to nobody, the way a beaten trainer's does;
        // the rest is the ball's index, which every ROM works out the same way.
        BrLoot_AddItem((u16)(0x8000 | 0x0F00 | i), MAP_GROUP(MAP_SAFARI_ZONE_SOUTH),
                       cell[0], cell[1] + MAP_OFFSET, cell[2] + MAP_OFFSET, gBrZone.items[i]);
    }
}

void BrZone_ItemsGone(void)
{
    u8 i;

    for (i = 0; i < BR_ZONE_ITEMS; i++)
        BrLoot_DropKey((u16)(0x8000 | 0x0F00 | i));
}

void BrZone_PlaceChest(void)
{
    if (gBrZone.chestPlaced)
        return;
    // A match with the opening turned off (POK-186) never goes through the Zone, so the
    // deal that names what is in the chest has to be asked for here rather than assumed.
    // Ensure is a no-op once the seed it was dealt for still matches.
    BrZone_Ensure();
    if (gBrZone.dealtFor == 0)
        return; // no START yet: no seed, so no agreed contents
    gBrZone.chestPlaced = TRUE;
    // Level 0: whatever rung the match is at when somebody finally walks in. It has been
    // lying there since the drop, and a level-5 SALAMENCE handed over in the fourth ring
    // is a prize nobody would cross the map for.
    BrLoot_AddMon(BR_CHEST_KEY, MAP_GROUP(MAP_ROUTE117_POKEMON_DAY_CARE),
                  MAP_NUM(MAP_ROUTE117_POKEMON_DAY_CARE),
                  BR_CHEST_X + MAP_OFFSET, BR_CHEST_Y + MAP_OFFSET, gBrZone.chest, 0);
}

u16 BrZone_Pick(void)
{
    if (gBrMatch.phase != BR_PHASE_SAFARI)
        return SPECIES_NONE;
    BrZone_Ensure();
    if (gBrZone.dealtFor == 0)
        return SPECIES_NONE; // no seed yet: a driver in the Zone, or a START still coming
    // The ROM's own RNG for WHICH of the twelve, so two encounters in a row are not the
    // same mon; the twelve themselves are the seed's, which is what everybody shares.
    return gBrZone.species[Random() % BR_ZONE_SLOTS];
}
