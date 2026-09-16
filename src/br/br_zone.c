// The Safari's catch pool, dealt from the match seed (POK-255). See include/br/br_zone.h.
#include "global.h"
#include "random.h"
#include "constants/species.h"
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
    gBrZone.dealtFor = gBrMatch.seed;
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
