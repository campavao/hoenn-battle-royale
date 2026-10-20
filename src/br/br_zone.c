// The Safari's catch pool, dealt from the match seed (POK-255). See include/br/br_zone.h.
#include "global.h"
#include "random.h"
#include "constants/species.h"
#include "constants/items.h"
#include "constants/maps.h"
#include "fieldmap.h"
#include "pokemon.h"
#include "constants/pokemon.h"
#include "br/br_loot.h"
#include "br/br_match.h"
#include "br/br_zone.h"

EWRAM_DATA struct BrZone gBrZone = {0};

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

// What a ball in the Zone can hold. Nothing here is a match-winner on its own -- the
// Master Ball below is the one that is, and it is dealt separately.
static const u16 sBallItems[] =
{
    ITEM_POKE_BALL, ITEM_HYPER_POTION, ITEM_FULL_RESTORE, ITEM_REVIVE,
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
// party slot 1, and Emerald's last trainer id is 854. A literal because the page reads it
// out of this file (web/src/match/ticker.ts's CHEST_KEY); br_loot.h owns the key space.
#define BR_CHEST_KEY 0x8E00
STATIC_ASSERT(BR_CHEST_KEY == BR_LOOT_KEY_CHEST, BrChestKeyIsInTheNobodySpace)

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

// ---- the pool (2026-10-20) -----------------------------------------------------------
//
// Cam: "stop grouping them by type (aka no 'It's a WATER round') instead let's just make
// them random all around (except for legendaries of course)". So the twelve are any twelve
// from the whole dex the routes may put in the grass (Wild, below), none twice -- no
// curated slices and no theme. They are what the bots draft from (web/src/match/zone.ts);
// the opening's own encounters draw from the same whole dex, not just these twelve.

static bool8 Wild(u16 species);

// One of them, drawn from the match's stream when `seeded` (the pool, which every ROM in
// the room has to agree on) or from the ROM's own Random() (an encounter, which only the
// trainer in it ever sees). Rejection rather than a table: 48 of the dex's 411 are not
// wild, so it is a draw or two, and a list of the other 363 would be 726 bytes for nothing.
static u16 AnyWild(bool8 seeded)
{
    u16 species;

    do
        species = 1 + (seeded ? NextU32() : Random()) % (NUM_SPECIES - 1);
    while (!Wild(species));
    return species;
}

static bool8 Dealt(u8 upto, u16 species)
{
    u8 i;

    for (i = 0; i < upto; i++)
    {
        if (gBrZone.species[i] == species)
            return TRUE;
    }
    return FALSE;
}

void BrZone_Init(void)
{
    CpuFill32(0, &gBrZone, sizeof(gBrZone));
}

void BrZone_Ensure(void)
{
    u8 i;

    if (gBrMatch.seed == 0 || gBrZone.dealtFor == gBrMatch.seed)
        return;
    SeedPool(gBrMatch.seed ^ 0x5A17);
    for (i = 0; i < BR_ZONE_SLOTS; i++)
    {
        u16 species = AnyWild(TRUE);

        while (Dealt(i, species))
            species = AnyWild(TRUE);
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
        BrLoot_AddItem(BR_LOOT_KEY_ZONE_ITEM(i), MAP_GROUP(MAP_SAFARI_ZONE_SOUTH),
                       cell[0], cell[1] + MAP_OFFSET, cell[2] + MAP_OFFSET, gBrZone.items[i]);
    }
}

void BrZone_ItemsGone(void)
{
    u8 i;

    for (i = 0; i < BR_ZONE_ITEMS; i++)
        BrLoot_DropKey(BR_LOOT_KEY_ZONE_ITEM(i));
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
    // Any wild species at all, off the ROM's own RNG: every encounter is its own draw,
    // so two in a row are rarely the same mon. Nothing here has to agree across the room
    // -- a wild battle is nobody else's -- so it does not come off the match's stream.
    return AnyWild(FALSE);
}

// ---- the national dex on the routes (2026-10-05 play-test) -------------------------
//
// Cam: "use the national dex to increase Pokemon variety". Emerald's own tables put about
// a third of the 386 in the grass, the same third every match. Outside the opening (the
// Zone deals its own, above), half of what a map's table would put in front of you is
// swapped this match for something of its weight from anywhere in the dex: a species
// within BR_NATIONAL_BAND of its base stat total that shares one of its types, so a
// route's ZIGZAGOON is a SENTRET or a RATTATA this match and a pond is still water.
// Seeded by the match, the map and the species: a route is the same route all match, and
// every ROM agrees, which a spectator's replay of the fight never has to (it plays the
// record).

#define BR_NATIONAL_BAND 30

static const u16 sNotWild[] =
{
    SPECIES_ARTICUNO, SPECIES_ZAPDOS, SPECIES_MOLTRES, SPECIES_MEWTWO, SPECIES_MEW,
    SPECIES_UNOWN, SPECIES_RAIKOU, SPECIES_ENTEI, SPECIES_SUICUNE, SPECIES_LUGIA,
    SPECIES_HO_OH, SPECIES_CELEBI, SPECIES_SHEDINJA, SPECIES_REGIROCK, SPECIES_REGICE,
    SPECIES_REGISTEEL, SPECIES_KYOGRE, SPECIES_GROUDON, SPECIES_RAYQUAZA, SPECIES_LATIAS,
    SPECIES_LATIOS, SPECIES_JIRACHI, SPECIES_DEOXYS,
};

static u32 Mix(u32 x)
{
    x *= 0x9E3779B1;
    x ^= x >> 15;
    x *= 0x85EBCA77;
    x ^= x >> 13;
    return x;
}

static u16 StatTotal(u16 species)
{
    const struct SpeciesInfo *info = &gSpeciesInfo[species];

    return info->baseHP + info->baseAttack + info->baseDefense
         + info->baseSpeed + info->baseSpAttack + info->baseSpDefense;
}

static bool8 Wild(u16 species)
{
    u8 i;

    if (species == SPECIES_NONE || species >= NUM_SPECIES
     || (species >= SPECIES_OLD_UNOWN_B && species <= SPECIES_OLD_UNOWN_Z))
        return FALSE;
    for (i = 0; i < ARRAY_COUNT(sNotWild); i++)
    {
        if (sNotWild[i] == species)
            return FALSE;
    }
    return TRUE;
}

static bool8 HasType(u16 species, u8 type)
{
    return gSpeciesInfo[species].types[0] == type || gSpeciesInfo[species].types[1] == type;
}

// How many stand in for `native` within `band`; with `pick` below that count, which one.
static u16 StandIns(u16 native, u16 band, u16 pick, u16 *out)
{
    const u8 *types = gSpeciesInfo[native].types;
    u16 total = StatTotal(native);
    u16 species, n = 0;

    for (species = 1; species < NUM_SPECIES; species++)
    {
        u16 st;

        if (species == native || !Wild(species))
            continue;
        if (!HasType(species, types[0]) && !HasType(species, types[1]))
            continue;
        st = StatTotal(species);
        if (st + band < total || st > total + band)
            continue;
        if (n == pick)
            *out = species;
        n++;
    }
    return n;
}

u16 BrZone_National(u16 native)
{
    u32 h;
    u16 band, n, out = native;

    if (gBrMatch.seed == 0 || !Wild(native))
        return native;
    h = Mix(gBrMatch.seed ^ ((u32)gSaveBlock1Ptr->location.mapGroup << 24)
            ^ ((u32)gSaveBlock1Ptr->location.mapNum << 16) ^ native);
    if (h & 1)
        return native; // half of them stay Hoenn's
    h = Mix(h);
    for (band = BR_NATIONAL_BAND; band <= 2 * BR_NATIONAL_BAND; band += BR_NATIONAL_BAND)
    {
        n = StandIns(native, band, 0xFFFF, &out);
        if (n != 0)
        {
            StandIns(native, band, h % n, &out);
            return out;
        }
    }
    return native;
}

