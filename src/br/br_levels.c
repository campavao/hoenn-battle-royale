// The level ladder on the ring clock (POK-225). See include/br/br_levels.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "pokemon.h"
#include "item.h"
#include "string_util.h"
#include "constants/items.h"
#include "constants/maps.h"
#include "constants/characters.h"
#include "br/br_hud.h"
#include "br/br_ring.h"
#include "data.h"
#include "constants/pokemon.h"
#include "battle.h"
#include "constants/battle_move_effects.h"
#include "constants/moves.h"
#include "br/br_moves.h"
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

// The Mart shelf per tier: the shelf grows with the rung. The stones are not here at
// all -- they are Lilycove's (POK-309, sDeptStore) -- but the POKe DOLL is on every
// shelf including the first, because it is the only way out of a fight you do not want
// (POK-293) and an escape you can only buy in one town is an escape most matches never
// have.
static const u16 sMart0[] = { ITEM_POKE_BALL, ITEM_POTION, ITEM_ANTIDOTE, ITEM_PARALYZE_HEAL, ITEM_POKE_DOLL, ITEM_NONE };
static const u16 sMart1[] = { ITEM_POKE_BALL, ITEM_GREAT_BALL, ITEM_POTION, ITEM_SUPER_POTION, ITEM_ANTIDOTE, ITEM_PARALYZE_HEAL,
                              ITEM_AWAKENING, ITEM_BURN_HEAL, ITEM_ICE_HEAL, ITEM_X_ATTACK, ITEM_X_DEFEND, ITEM_POKE_DOLL, ITEM_NONE };
static const u16 sMart2[] = { ITEM_GREAT_BALL, ITEM_ULTRA_BALL, ITEM_SUPER_POTION, ITEM_HYPER_POTION, ITEM_REVIVE, ITEM_FULL_HEAL,
                              ITEM_X_ATTACK, ITEM_X_DEFEND, ITEM_X_SPEED, ITEM_X_SPECIAL, ITEM_POKE_DOLL, ITEM_NONE };
static const u16 sMart3[] = { ITEM_ULTRA_BALL, ITEM_HYPER_POTION, ITEM_MAX_POTION, ITEM_REVIVE, ITEM_FULL_HEAL, ITEM_X_ATTACK,
                              ITEM_X_DEFEND, ITEM_X_SPEED, ITEM_X_SPECIAL, ITEM_X_ACCURACY, ITEM_GUARD_SPEC, ITEM_DIRE_HIT, ITEM_POKE_DOLL, ITEM_NONE };
// The top shelf carries the Master Ball, priced for the match in item.c (POK-268).
static const u16 sMart4[] = { ITEM_MASTER_BALL, ITEM_ULTRA_BALL, ITEM_MAX_POTION, ITEM_FULL_RESTORE, ITEM_REVIVE, ITEM_MAX_REVIVE, ITEM_FULL_HEAL,
                              ITEM_X_ATTACK, ITEM_X_DEFEND, ITEM_X_SPEED, ITEM_X_SPECIAL, ITEM_X_ACCURACY, ITEM_GUARD_SPEC, ITEM_DIRE_HIT, ITEM_POKE_DOLL, ITEM_NONE };
static const u16 *const sMarts[] = { sMart0, sMart1, sMart2, sMart3, sMart4, sMart4 };

// LILYCOVE DEPARTMENT STORE (POK-309).
//
// Cam: "it looks like all of the stones are available in Pokemarts. I think this is
// incorrect... there is a town that has essentially a big department store. That
// location should be what sells the stones, not just all Pokemarts."
//
// So a stone evolution is a place you go rather than a thing you buy on the way past,
// which is also what makes POK-290's rule work: the rung evolves what levels up, and
// everything else is a trip to Lilycove. It is a long way from most drops, which is the
// point -- and the shelf is the top one plus the stones whatever rung the match is at,
// so arriving is worth it rather than a second-best mart.
static const u16 sDeptStore[] = { ITEM_MASTER_BALL, ITEM_ULTRA_BALL, ITEM_MAX_POTION, ITEM_FULL_RESTORE, ITEM_REVIVE, ITEM_MAX_REVIVE,
                                  ITEM_FULL_HEAL, ITEM_X_ATTACK, ITEM_X_DEFEND, ITEM_X_SPEED, ITEM_X_SPECIAL, ITEM_X_ACCURACY,
                                  ITEM_GUARD_SPEC, ITEM_DIRE_HIT, ITEM_POKE_DOLL, ITEM_FIRE_STONE, ITEM_WATER_STONE,
                                  ITEM_THUNDER_STONE, ITEM_LEAF_STONE, ITEM_SUN_STONE, ITEM_MOON_STONE, ITEM_NONE };

static const u8 sText_Lv[] = _("LV ");
static const u8 sText_Sep[] = _(" - ");
static const u8 sText_Fog[] = _("FOG ");

// The line lives on the stack: BrHud_Say copies it into the queue at once, and forty
// bytes of EWRAM for a string nobody reads twice was forty bytes EWRAM did not have.
static void SayPhase(void)
{
    u8 line[40];
    u8 *p = line;

    p = StringCopy(p, sText_Lv);
    p = ConvertIntToDecimalStringN(p, gBrLevels.rung, STR_CONV_MODE_LEFT_ALIGN, 3);
    p = StringCopy(p, sText_Sep);
    p = StringCopy(p, sRodNames[gBrLevels.tier]);
    p = StringCopy(p, sText_Sep);
    p = StringCopy(p, sText_Fog);
    p = ConvertIntToDecimalStringN(p, gBrLevels.phaseSeen, STR_CONV_MODE_LEFT_ALIGN, 2);
    *p = EOS;
    BrHud_Say(line);
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

// ---- growing up on the rung (POK-290) --------------------------------------------
//
// A Zigzagoon caught in the Zone was still a Zigzagoon at Lv75 in the last ring, while a
// bot's team walked its evolution chain as it was dealt (web/src/bots/party.ts) -- so at
// rung 75 you fought their SWAMPERT with your MUDKIP.
//
// Neither of these can hang off a level-up, because nothing in a match ever levels up:
// no battle awards EXP (BrLevels_NoExp) and the rung writes the level straight on. So
// both happen here, where the lift happens.

// Cam's rule, 2026-09-17: "if they can evolve by leveling up, then they do. If they have
// to evolve via some other way, like a stone or anything like that, then we leave that
// off." EVO_MODE_NORMAL is exactly that question -- it answers for the evolutions vanilla
// fires on a level-up and no others, so a stone stays something you go to Lilycove for.
static void GrowUp(struct Pokemon *mon)
{
    u8 i;

    // A big jump is two evolutions: MUDKIP to MARSHTOMP to SWAMPERT. Bounded rather than
    // a while loop, because a species that evolved into itself would hang the match.
    for (i = 0; i < 3; i++)
    {
        u16 before = GetMonData(mon, MON_DATA_SPECIES, NULL);
        u16 target = GetEvolutionTargetSpecies(mon, EVO_MODE_NORMAL, ITEM_NONE);
        u8 nickname[POKEMON_NAME_LENGTH + 1];

        if (target == SPECIES_NONE || target == before)
            break;
        GetMonData(mon, MON_DATA_NICKNAME, nickname);
        SetMonData(mon, MON_DATA_SPECIES, &target);
        CalculateMonStats(mon);
        // A mon nobody renamed is called after its species, so the name has to travel
        // with it -- or a SWAMPERT walks around answering to MUDKIP.
        if (StringCompare(nickname, gSpeciesNames[before]) == 0)
            SetMonData(mon, MON_DATA_NICKNAME, gSpeciesNames[target]);
    }
}

// ---- a move worth having (POK-311) -----------------------------------------------
//
// Cam, 2026-09-17: "handcrafting each move set at the levels, so that good moves -- more
// battle viable moves -- are chosen automatically. I noticed in Kanto Battle Royale
// there's an instance where Electrode gets Self-Destruct and Explosion, which is just kind
// of ridiculous." A level-up learnset is written for a story where you pick your own four;
// walked in order it ends on whatever comes last, and a SCEPTILE lifted to 75 knew AGILITY,
// SLAM, DETECT and FALSE SWIPE and had never heard of LEAF BLADE.
//
// A rule rather than a table: 386 species, no data to keep, and ROM only. A move is worth
// roughly the damage it does in a turn from THIS mon -- its power, how often it lands, its
// own type, and which of its two attacking stats the move's type reads in Gen 3 -- and a
// set is worth its moves, less for saying the same thing twice.

#define BR_WORTH_STATUS_GOOD 50
#define BR_WORTH_STATUS 20

static u16 StatusWorth(u8 effect)
{
    switch (effect)
    {
    case EFFECT_SPLASH:
    case EFFECT_TELEPORT:
        return 0;
    case EFFECT_SLEEP:
    case EFFECT_TOXIC:
    case EFFECT_PARALYZE:
    case EFFECT_WILL_O_WISP:
    case EFFECT_CONFUSE:
    case EFFECT_LEECH_SEED:
    case EFFECT_RESTORE_HP:
    case EFFECT_SOFTBOILED:
    case EFFECT_MORNING_SUN:
    case EFFECT_SYNTHESIS:
    case EFFECT_MOONLIGHT:
    case EFFECT_ATTACK_UP_2:
    case EFFECT_SPECIAL_ATTACK_UP_2:
    case EFFECT_SPEED_UP_2:
    case EFFECT_DRAGON_DANCE:
    case EFFECT_CALM_MIND:
    case EFFECT_BULK_UP:
        return BR_WORTH_STATUS_GOOD;
    }
    return BR_WORTH_STATUS;
}

// Power 1 is the cartridge's way of saying "worked out at the time".
static u16 OddWorth(u8 effect)
{
    switch (effect)
    {
    case EFFECT_LEVEL_DAMAGE:
        return 60; // SEISMIC TOSS, NIGHT SHADE: the rung, every time
    case EFFECT_FRUSTRATION:
        return 60; // nobody in a match has had time to be liked
    case EFFECT_SUPER_FANG:
        return 50;
    case EFFECT_OHKO:
        return 35;
    case EFFECT_RETURN:
        return 30;
    case EFFECT_DRAGON_RAGE:
        return 25;
    case EFFECT_SONICBOOM:
        return 15;
    }
    return 40;
}

// What a move's worth depends on, read off the mon ONCE a lift. Every GetMonData on the
// species decrypts and checksums the whole box mon, and the first cut of this asked from
// inside MoveWorth: a thousand times a mon, a third of a second each, a two-second freeze
// for a full party every time the fog moved. one-clock.txt caught it.
struct BrLearner
{
    u16 atk;
    u16 spAtk;
    u8 types[2];
};

static u16 MoveWorth(const struct BrLearner *who, u16 move)
{
    const struct BattleMove *m = &gBattleMoves[move];
    u16 mine, best;
    u32 worth;

    if (move == MOVE_NONE)
        return 0;
    if (m->power == 0)
        return StatusWorth(m->effect) * (m->accuracy == 0 ? 100 : m->accuracy) / 100;
    if (m->power == 1)
        return OddWorth(m->effect);
    // The move that ends the mon using it. Worth having when there is nothing else, and
    // never worth having twice: the same-effect rule below is what stops the second.
    if (m->effect == EFFECT_EXPLOSION)
        return 15;

    worth = m->power;
    switch (m->effect)
    {
    case EFFECT_MULTI_HIT:
        worth *= 3;
        break;
    case EFFECT_DOUBLE_HIT:
    case EFFECT_TWINEEDLE:
        worth *= 2;
        break;
    case EFFECT_TRIPLE_KICK:
        worth *= 4;
        break;
    case EFFECT_RECHARGE:
    case EFFECT_RAZOR_WIND:
    case EFFECT_SKY_ATTACK:
    case EFFECT_SKULL_BASH:
    case EFFECT_SOLAR_BEAM:
    case EFFECT_SEMI_INVULNERABLE:
    case EFFECT_FOCUS_PUNCH:
    case EFFECT_FAKE_OUT:
        worth /= 2; // two turns for one hit, or one hit that mostly does not happen
        break;
    case EFFECT_FALSE_SWIPE:
        worth /= 3; // cannot finish anything, in a game about finishing things
        break;
    case EFFECT_DREAM_EATER:
    case EFFECT_SNORE:
    case EFFECT_SPIT_UP:
        worth /= 5; // needs a second move to have worked first
        break;
    case EFFECT_OVERHEAT:
    case EFFECT_SUPERPOWER:
        worth = worth * 4 / 5;
        break;
    }
    worth = worth * (m->accuracy == 0 ? 100 : m->accuracy) / 100;
    if (m->type == who->types[0] || m->type == who->types[1])
        worth = worth * 3 / 2;
    mine = IS_TYPE_PHYSICAL(m->type) ? who->atk : who->spAtk;
    best = who->atk > who->spAtk ? who->atk : who->spAtk;
    if (best != 0)
        worth = worth * mine / best;
    return (u16)worth;
}

// Is move `j` the one that makes move `i` redundant? Only ever the better of the two, or
// the earlier on a tie, so exactly one of a pair pays for it.
static bool8 Outranks(const u16 *worth, u8 j, u8 i)
{
    return worth[j] > worth[i] || (worth[j] == worth[i] && j < i);
}

// Two of one thing: SELFDESTRUCT and EXPLOSION, two ways to lower ATTACK, or a second
// attack of a type the set already hits harder with.
static bool8 Echoes(const struct BattleMove *a, const struct BattleMove *b)
{
    if (a->power == 0 || a->effect == EFFECT_EXPLOSION)
        return a->effect == b->effect;
    return b->power > 1 && b->effect != EFFECT_EXPLOSION && a->type == b->type;
}

static u16 SetWorth(const struct BrLearner *who, const u16 *moves)
{
    u16 worth[MAX_MON_MOVES];
    u16 total = 0;
    u8 i, j, hitters = 0;

    for (i = 0; i < MAX_MON_MOVES; i++)
        worth[i] = MoveWorth(who, moves[i]);
    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        const struct BattleMove *a = &gBattleMoves[moves[i]];
        u16 w = worth[i];
        u8 statusAbove = 0, echoes = 0;

        if (moves[i] == MOVE_NONE)
            continue;
        if (a->power != 0 && a->effect != EFFECT_EXPLOSION)
            hitters++;
        for (j = 0; j < MAX_MON_MOVES; j++)
        {
            const struct BattleMove *b = &gBattleMoves[moves[j]];

            if (j == i || moves[j] == MOVE_NONE || !Outranks(worth, j, i))
                continue;
            if (a->power == 0 && b->power == 0)
                statusAbove++;
            if (Echoes(a, b))
                echoes++;
        }
        // Said twice is worth less than half; said three times, a DOUBLE-EDGE, a TAKE DOWN
        // and a HEADBUTT, is a slot IRON DEFENSE would have used better.
        if (echoes == 1)
            w = w * 2 / 5;
        else if (echoes >= 2)
            w = w / 5;
        if (statusAbove >= 2)
            w = w * 3 / 10; // a third status move is a turn nobody will ever spend
        total += w;
    }
    // Nothing to attack with is not a moveset, whatever else is in it.
    return hitters == 0 ? total / 4 : total;
}

// An empty slot if there is one; otherwise whichever swap leaves the best four, over the
// slots the player did not choose -- and no swap at all when the four it has are better
// than any of them with the new move in. With all four chosen nothing is learned either,
// and this can never be a prompt: a prompt is a freeze with the fog closing.
static void Teach(const struct BrLearner *who, u16 *moves, u8 slot, u16 move)
{
    u16 trial[MAX_MON_MOVES];
    u16 bestWorth, w;
    u8 i, j, best = MAX_MON_MOVES;

    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        if (moves[i] == move)
            return;
        if (moves[i] == MOVE_NONE)
        {
            moves[i] = move;
            return;
        }
    }
    bestWorth = SetWorth(who, moves);
    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        if (BrMoves_IsKept(slot, i))
            continue;
        for (j = 0; j < MAX_MON_MOVES; j++)
            trial[j] = j == i ? move : moves[j];
        w = SetWorth(who, trial);
        if (w > bestWorth)
        {
            bestWorth = w;
            best = i;
        }
    }
    if (best != MAX_MON_MOVES)
        moves[best] = move;
}

// Every move the levels it skipped would have taught it. Walking the learnset rather than
// calling MonTryLearningNewMove, which only ever answers for the level the mon is standing
// on: a lift from 5 to 75 would learn whatever is written at exactly 75 -- usually nothing
// -- and none of the seventy levels in between.
//
// From the bottom of the learnset, not from the level it was lifted from (POK-311): a mon
// caught at 30 knows the last four things written before 30, which is the same accident
// one level at a time. Teach only ever swaps for a better four, so offering it a move it
// already passed over costs nothing and is how a wild GROVYLE finds LEAF BLADE.
static void LearnThrough(struct Pokemon *mon, u8 slot, u8 to)
{
    u16 species = GetMonData(mon, MON_DATA_SPECIES, NULL);
    const u16 *learnset = gLevelUpLearnsets[species];
    struct BrLearner who;
    u16 had[MAX_MON_MOVES];
    u16 moves[MAX_MON_MOVES];
    u16 i;

    who.atk = GetMonData(mon, MON_DATA_ATK, NULL);
    who.spAtk = GetMonData(mon, MON_DATA_SPATK, NULL);
    who.types[0] = gSpeciesInfo[species].types[0];
    who.types[1] = gSpeciesInfo[species].types[1];
    for (i = 0; i < MAX_MON_MOVES; i++)
        had[i] = moves[i] = GetMonData(mon, MON_DATA_MOVE1 + i, NULL);
    for (i = 0; learnset[i] != LEVEL_UP_END; i++)
    {
        u8 level = (learnset[i] & LEVEL_UP_MOVE_LV) >> 9;

        if (level <= to)
            Teach(&who, moves, slot, learnset[i] & LEVEL_UP_MOVE_ID);
    }
    // Only the slots that ended up different are written, so a move that survived the
    // whole walk keeps the PP it had and the PP UPs somebody spent on it.
    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        if (moves[i] == had[i])
            continue;
        if (had[i] != MOVE_NONE)
            RemoveMonPPBonus(mon, i);
        SetMonMoveSlot(mon, moves[i], i);
    }
}

// A bot's mon, built from a card, knows what a player's or a gym leader's would at this
// level (POK-330 #50): the page has no learnsets, so it sends none worth keeping, and
// CreateMon's last-four-written is the accident POK-311 took off everybody else.
// PARTY_SIZE as the slot, as LiftTrainer: nothing in a bot's team is a player's decision.
void BrLevels_TeachUpTo(struct Pokemon *mon, u8 level)
{
    LearnThrough(mon, PARTY_SIZE, level);
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
        // Evolve before the moves are worked out, so the learnset walked is the one it
        // will be standing in when the fighting starts.
        GrowUp(mon);
        LearnThrough(mon, i, level);
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
        u8 was;

        if (species == SPECIES_NONE || GetMonData(mon, MON_DATA_LEVEL) == level)
            continue;
        exp = gExperienceTables[gSpeciesInfo[species].growthRate][level];
        was = GetMonData(mon, MON_DATA_LEVEL);
        SetMonData(mon, MON_DATA_EXP, &exp);
        CalculateMonStats(mon);
        // ...and grows up with it (POK-290), for the same reason the player's team does:
        // a gym leader whose ZIGZAGOON never became a LINOONE is free loot at rung 75.
        // PARTY_SIZE as the slot because nothing in somebody else's team is a decision
        // the player made, so every move here is fair game to overwrite.
        if (level > was)
        {
            GrowUp(mon);
            LearnThrough(mon, PARTY_SIZE, level);
        }
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
    BrMoves_ClearKept();
}

void BrLevels_GiveStartingBag(void)
{
    gBrLevels.rod = ITEM_NONE;
    SwapRod(sRods[0]);
    AddBagItem(ITEM_POKE_BALL, 5);
}

// Which floor of the Department Store you are standing on does not matter: the fog is
// closing and a hunt for the right lift button is not a puzzle worth having. 1F..5F all
// carry the same shelf; the rooftop and the lift have no counter to stand at.
static bool8 InTheDeptStore(void)
{
    return gSaveBlock1Ptr->location.mapGroup == MAP_GROUP(MAP_LILYCOVE_CITY_DEPARTMENT_STORE_1F)
        && gSaveBlock1Ptr->location.mapNum >= MAP_NUM(MAP_LILYCOVE_CITY_DEPARTMENT_STORE_1F)
        && gSaveBlock1Ptr->location.mapNum <= MAP_NUM(MAP_LILYCOVE_CITY_DEPARTMENT_STORE_5F);
}

const u16 *BrLevels_MartItems(void)
{
    if (InTheDeptStore())
        return sDeptStore;
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
