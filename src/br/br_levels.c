// The level ladder on the ring clock (POK-225). See include/br/br_levels.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "pokemon.h"
#include "item.h"
#include "string_util.h"
#include "constants/items.h"
#include "constants/characters.h"
#include "br/br_hud.h"
#include "br/br_ring.h"
#include "br/br_levels.h"

EWRAM_DATA struct BrLevels gBrLevels = {0};

// Kanto's ladder, indexed by ring phase: no ring and the first ring are the floor.
static const u8 sLadder[] = { 5, 15, 30, 50, 75, 100 };

// One rod per pair of rungs: OLD, OLD, GOOD, GOOD, SUPER, SUPER.
static const u16 sRods[] = { ITEM_OLD_ROD, ITEM_OLD_ROD, ITEM_GOOD_ROD, ITEM_GOOD_ROD, ITEM_SUPER_ROD, ITEM_SUPER_ROD };
static const u8 sText_OldRod[] = _("OLD ROD");
static const u8 sText_GoodRod[] = _("GOOD ROD");
static const u8 sText_SuperRod[] = _("SUPER ROD");
static const u8 *const sRodNames[] = { sText_OldRod, sText_OldRod, sText_GoodRod, sText_GoodRod, sText_SuperRod, sText_SuperRod };

// The Mart shelf per tier: the shelf grows with the rung, stones from tier 2.
static const u16 sMart0[] = { ITEM_POKE_BALL, ITEM_POTION, ITEM_ANTIDOTE, ITEM_PARALYZE_HEAL, ITEM_NONE };
static const u16 sMart1[] = { ITEM_POKE_BALL, ITEM_GREAT_BALL, ITEM_POTION, ITEM_SUPER_POTION, ITEM_ANTIDOTE, ITEM_PARALYZE_HEAL,
                              ITEM_AWAKENING, ITEM_BURN_HEAL, ITEM_ICE_HEAL, ITEM_X_ATTACK, ITEM_X_DEFEND, ITEM_NONE };
static const u16 sMart2[] = { ITEM_GREAT_BALL, ITEM_ULTRA_BALL, ITEM_SUPER_POTION, ITEM_HYPER_POTION, ITEM_REVIVE, ITEM_FULL_HEAL,
                              ITEM_X_ATTACK, ITEM_X_DEFEND, ITEM_X_SPEED, ITEM_X_SPECIAL, ITEM_FIRE_STONE, ITEM_WATER_STONE,
                              ITEM_THUNDER_STONE, ITEM_LEAF_STONE, ITEM_SUN_STONE, ITEM_MOON_STONE, ITEM_NONE };
static const u16 sMart3[] = { ITEM_ULTRA_BALL, ITEM_HYPER_POTION, ITEM_MAX_POTION, ITEM_REVIVE, ITEM_FULL_HEAL, ITEM_X_ATTACK,
                              ITEM_X_DEFEND, ITEM_X_SPEED, ITEM_X_SPECIAL, ITEM_X_ACCURACY, ITEM_GUARD_SPEC, ITEM_DIRE_HIT,
                              ITEM_FIRE_STONE, ITEM_WATER_STONE, ITEM_THUNDER_STONE, ITEM_LEAF_STONE, ITEM_SUN_STONE, ITEM_MOON_STONE, ITEM_NONE };
static const u16 sMart4[] = { ITEM_ULTRA_BALL, ITEM_MAX_POTION, ITEM_FULL_RESTORE, ITEM_REVIVE, ITEM_MAX_REVIVE, ITEM_FULL_HEAL,
                              ITEM_X_ATTACK, ITEM_X_DEFEND, ITEM_X_SPEED, ITEM_X_SPECIAL, ITEM_X_ACCURACY, ITEM_GUARD_SPEC, ITEM_DIRE_HIT,
                              ITEM_FIRE_STONE, ITEM_WATER_STONE, ITEM_THUNDER_STONE, ITEM_LEAF_STONE, ITEM_SUN_STONE, ITEM_MOON_STONE, ITEM_NONE };
static const u16 *const sMarts[] = { sMart0, sMart1, sMart2, sMart3, sMart4, sMart4 };

static const u8 sText_Lv[] = _("LV ");
static const u8 sText_Sep[] = _(" - ");
static const u8 sText_Fog[] = _("FOG ");
static EWRAM_DATA u8 sPhaseLine[40] = {0};

static void SayPhase(void)
{
    u8 *p = sPhaseLine;

    p = StringCopy(p, sText_Lv);
    p = ConvertIntToDecimalStringN(p, gBrLevels.rung, STR_CONV_MODE_LEFT_ALIGN, 3);
    p = StringCopy(p, sText_Sep);
    p = StringCopy(p, sRodNames[gBrLevels.tier]);
    p = StringCopy(p, sText_Sep);
    p = StringCopy(p, sText_Fog);
    p = ConvertIntToDecimalStringN(p, gBrLevels.phaseSeen, STR_CONV_MODE_LEFT_ALIGN, 2);
    *p = EOS;
    BrHud_Say(sPhaseLine);
}

static void SwapRod(u16 rod)
{
    if (gBrLevels.rod == rod)
        return;
    if (gBrLevels.rod != ITEM_NONE && CheckBagHasItem(gBrLevels.rod, 1))
        RemoveBagItem(gBrLevels.rod, 1);
    AddBagItem(rod, 1);
    gBrLevels.rod = rod;
}

static u8 TierForPhase(u8 phase)
{
    u8 i = phase == 0 ? 0 : phase - 1;

    if (i >= sizeof(sLadder))
        i = sizeof(sLadder) - 1;
    return i;
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

// Hoenn's own trainers are on the one clock too (POK-225, POK-234). A gym leader's
// canned levels make them free loot at rung 75 and a wall at rung 5; their team is
// what it always was, standing at the rung the match is at. Exactly the lift the
// player's party gets, so nobody is fighting somebody from another match.
void BrLevels_LiftTrainer(struct Pokemon *party, u8 count)
{
    u8 i, level = gBrLevels.rung;

    for (i = 0; i < count && i < PARTY_SIZE; i++)
    {
        struct Pokemon *mon = &party[i];
        u16 species = GetMonData(mon, MON_DATA_SPECIES);
        u32 exp;

        if (species == SPECIES_NONE || GetMonData(mon, MON_DATA_LEVEL) == level)
            continue;
        exp = gExperienceTables[gSpeciesInfo[species].growthRate][level];
        SetMonData(mon, MON_DATA_EXP, &exp);
        CalculateMonStats(mon);
        // A trainer's mon walks in whole, unlike the player's, which keeps its wound.
        {
            u16 max = GetMonData(mon, MON_DATA_MAX_HP);

            SetMonData(mon, MON_DATA_HP, &max);
        }
    }
}

void BrLevels_Init(void)
{
    gBrLevels.rung = sLadder[0];
    gBrLevels.tier = 0;
    gBrLevels.phaseSeen = 0;
    gBrLevels.rod = ITEM_NONE;
}

void BrLevels_GiveStartingBag(void)
{
    gBrLevels.rod = ITEM_NONE;
    SwapRod(sRods[0]);
    AddBagItem(ITEM_POKE_BALL, 5);
}

const u16 *BrLevels_MartItems(void)
{
    return sMarts[gBrLevels.tier];
}

void BrLevels_Tick(void)
{
    u8 phase = gBrRing.active ? gBrRing.phase : 0;

    if (phase == gBrLevels.phaseSeen)
        return;
    if (gMain.inBattle)
        return; // the rung you started the fight at is the rung you fight at
    gBrLevels.phaseSeen = phase;
    gBrLevels.tier = TierForPhase(phase);
    gBrLevels.rung = sLadder[gBrLevels.tier];
    LiftParty(gBrLevels.rung);
    SwapRod(sRods[gBrLevels.tier]);
    // One line per ring move, never three: ring, level and rod are one event.
    if (phase > 0)
        SayPhase();
}

u8 BrLevels_WildLevel(void)
{
    return gBrLevels.rung;
}

bool8 BrLevels_NoExp(void)
{
    return TRUE;
}
