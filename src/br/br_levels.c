// The level ladder on the ring clock (POK-225). See include/br/br_levels.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "pokemon.h"
#include "br/br_ring.h"
#include "br/br_levels.h"

EWRAM_DATA struct BrLevels gBrLevels = {0};

// Kanto's ladder, indexed by ring phase: no ring and the first ring are the floor.
static const u8 sLadder[] = { 5, 15, 30, 50, 75, 100 };

static u8 RungForPhase(u8 phase)
{
    u8 i = phase == 0 ? 0 : phase - 1;

    if (i >= sizeof(sLadder))
        i = sizeof(sLadder) - 1;
    return sLadder[i];
}

static void LiftParty(u8 level)
{
    u8 i, count = CalculatePlayerPartyCount();

    for (i = 0; i < count; i++)
    {
        struct Pokemon *mon = &gPlayerParty[i];
        u16 species = GetMonData(mon, MON_DATA_SPECIES);
        u32 exp;
        u16 hp, maxBefore, maxAfter;

        if (species == SPECIES_NONE || GetMonData(mon, MON_DATA_LEVEL) >= level)
            continue;
        exp = gExperienceTables[gSpeciesInfo[species].growthRate][level];
        hp = GetMonData(mon, MON_DATA_HP);
        maxBefore = GetMonData(mon, MON_DATA_MAX_HP);
        SetMonData(mon, MON_DATA_EXP, &exp);
        CalculateMonStats(mon);
        // Keep the wound: the new max grows, the missing HP stays missing.
        maxAfter = GetMonData(mon, MON_DATA_MAX_HP);
        if (hp > 0)
        {
            hp += maxAfter - maxBefore;
            SetMonData(mon, MON_DATA_HP, &hp);
        }
    }
}

void BrLevels_Init(void)
{
    gBrLevels.rung = sLadder[0];
    gBrLevels.phaseSeen = 0;
}

void BrLevels_Tick(void)
{
    u8 phase = gBrRing.active ? gBrRing.phase : 0;

    if (phase == gBrLevels.phaseSeen)
        return;
    if (gMain.inBattle)
        return; // the rung you started the fight at is the rung you fight at
    gBrLevels.phaseSeen = phase;
    gBrLevels.rung = RungForPhase(phase);
    LiftParty(gBrLevels.rung);
}

u8 BrLevels_WildLevel(void)
{
    return gBrLevels.rung;
}

bool8 BrLevels_NoExp(void)
{
    return TRUE;
}
