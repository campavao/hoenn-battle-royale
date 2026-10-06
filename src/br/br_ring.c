// The ring: geometry, fog weather, and the bleed (POK-224). See include/br/br_ring.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "field_weather.h"
#include "region_map.h"
#include "pokemon.h"
#include "constants/weather.h"
#include "constants/region_map_sections.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "string_util.h"
#include "constants/characters.h"
#include "br/br_hud.h"
#include "br/br_match.h"
#include "br/br_ring.h"
#include "battle.h"
#include "br/br_netlink.h"
#include "br/br_bot.h"
#include "br/br_duel.h"
#include "br/br_field.h"
#include "br/br_battle.h"
#include "battle_util.h"
#include "recorded_battle.h"
#include "constants/battle_script_commands.h"
#include "constants/battle_string_ids.h"
#include "util.h"

EWRAM_DATA struct BrRing gBrRing = {0};

// Does the fog's clock reach into this battle (POK-262)? A wild or route fight fought
// outside the ring drains the whole party on the clock, as on the field: without that, a
// battle is somewhere to hide from the fog -- step outside the ring, pick a fight with
// the grass, and the clock stops mattering.
//
// A fight between contestants is in the fog too (Cam, 2026-10-05 play-test: "players not
// taking fog damage if in a battle"), which reverses Kanto's v0.3.1 rule -- but not on
// this clock. Two ROMs fight a link battle and only the challenger's runs the engine, so
// each ROM bleeding its own party on its own clock would leave the two copies of every mon
// disagreeing. The engine does it instead, at the end of each turn (BrRing_FogEndTurn),
// where everything it changes reaches the other ROM and a replay the way a sandstorm does.
static bool8 FogReachesThisBattle(void)
{
    if (!gMain.inBattle)
        return FALSE;
    if (gBrNetlink.active || gBrBotFight.fighting || gBrDuel.running
     || RecordedBattle_IsSpectateLive())
        return FALSE; // the engine's own turn does it (BrRing_FogEndTurn)
    return TRUE;
}

// Is a fight between contestants, on this ROM, one the end-of-turn fog belongs to? Not a
// duel: two bots fighting in the host's hidden instance are standing nowhere.
static bool8 ContestBattle(void)
{
    if (!gMain.inBattle || gBrDuel.running)
        return FALSE;
    return gBrNetlink.active || gBrBotFight.fighting || RecordedBattle_IsSpectateLive();
}

// Distance from the centre to the nearest point of the section's rectangle, squared,
// against r squared. Integer maths only; sections are whole cells.
bool8 BrRing_SectionInside(u8 mapsec)
{
    const struct RegionMapLocation *loc;
    s16 nx, ny, dx, dy;

    if (!gBrRing.active)
        return TRUE;
    if (gBrRing.r < 0)
        return FALSE;
    if (mapsec >= MAPSEC_NONE)
        return FALSE;
    loc = &gRegionMapEntries[mapsec];
    nx = gBrRing.cx;
    if (nx < loc->x) nx = loc->x;
    if (nx > loc->x + loc->width - 1) nx = loc->x + loc->width - 1;
    ny = gBrRing.cy;
    if (ny < loc->y) ny = loc->y;
    if (ny > loc->y + loc->height - 1) ny = loc->y + loc->height - 1;
    dx = nx - gBrRing.cx;
    dy = ny - gBrRing.cy;
    return dx * dx + dy * dy <= (s16)gBrRing.r * gBrRing.r;
}

// Is this cell of the region-map grid inside the ring? The ring is a disc in exactly
// these coordinates (BrRing_SectionInside above measures the same way against a
// section's own rectangle), so this is that test with the rectangle shrunk to a point.
// The fog over the region map asks it of every cell (br_map.c).
bool8 BrRing_CellInside(s16 x, s16 y)
{
    s16 dx = x - gBrRing.cx;
    s16 dy = y - gBrRing.cy;

    if (gBrRing.r < 0)
        return FALSE;
    return dx * dx + dy * dy <= (s16)gBrRing.r * gBrRing.r;
}

// The bottom box on a ring move: the place the fog is closing on, which the host
// already sends and nothing was reading. Two lines, 90 frames, above the ticker.
static const u8 sText_FogCloses[] = _("THE FOG CLOSES IN ON");
const u8 gBrText_FogEverywhere[] = _("FOG EVERYWHERE");

static void SayFog(const u8 *place, u8 len)
{
    u8 line[BR_HUD_LINE_MAX + 2];
    u8 *p = StringCopy(line, sText_FogCloses);
    u8 i;

    *p++ = CHAR_NEWLINE;
    if (len > 16)
        len = 16;
    for (i = 0; i < len; i++)
        *p++ = place[i];
    *p++ = CHAR_EXCL_MARK;
    *p = EOS;
    BrHud_Box(line);
}

static void HandleRing(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    u8 i, placeLen = 0;

    if (n < 5)
        return;
    if (n >= 6 && d[5] > 0 && (u16)(6 + d[5]) <= n)
        placeLen = d[5];
    // A new phase, with a place named: say where. The corner's FOG! flash is the
    // page's own (gBrHud.flashFog); this is the sentence that goes with it. Not on the
    // last phase, which has no inside -- naming the old centre would send the player
    // somewhere that is fog too -- and whose one line is the ticker's THE FOG COVERS ALL
    // OF HOENN! (br_levels.c): a box saying it again would be the ring's second (POK-324).
    if (d[1] != gBrRing.phase && (s8)d[4] >= 0 && placeLen > 0)
        SayFog(d + 6, placeLen);
    // ...and keep the name, from every RING and not just a new phase's, so a late
    // snapshot or a resync names it too. The box above is ninety frames and the play-test
    // missed it: "if you weren't paying attention to the beginning... it doesn't tell
    // you where it's actually closing in on" (POK-325). The corner says it from now on.
    if (placeLen > BR_RING_PLACE_MAX)
        placeLen = BR_RING_PLACE_MAX;
    for (i = 0; i < placeLen; i++)
        gBrRing.place[i] = d[6 + i];
    gBrRing.place[placeLen] = EOS;
    gBrHud.dirty |= BR_HUD_DIRTY_CORNER;
    gBrRing.active = TRUE;
    gBrRing.phase = d[1];
    gBrRing.cx = (s8)d[2];
    gBrRing.cy = (s8)d[3];
    gBrRing.r = (s8)d[4];
    gBrRing.applied = FALSE; // re-evaluate on the next frame
}

static void ApplyWeather(bool8 outside)
{
    if (outside)
        SetSavedWeather(WEATHER_FOG_HORIZONTAL);
    else
        SetSavedWeatherFromCurrMapHeader();
    DoCurrentWeather();
    gBrRing.applied = TRUE;
    gBrRing.appliedMapGroup = gSaveBlock1Ptr->location.mapGroup;
    gBrRing.appliedMapNum = gSaveBlock1Ptr->location.mapNum;
}

static void Bleed(void)
{
    u8 i, count = CalculatePlayerPartyCount();
    u8 alive = 0;
    // In a battle the fog hurts but never finishes anybody. A team that fainted to the
    // weather mid-turn would take the elimination -- and the spill, and the OUT -- out
    // of the battle engine's hands while it was still running a turn, so it waits at
    // 1 HP and the next tick in the overworld does the rest.
    //
    // And a fight that is on its way in is as good as started: the challenge's "!", the
    // walk and the fade off the field (BrField_Leave) are still the overworld's frames,
    // and a team the fog finished there went into the battle with nobody standing -- the
    // lead at 0 HP, the screen hung on its send-out (2026-10-05 play-test).
    bool8 floorAtOne = FogReachesThisBattle() || BrField_Leaving()
                    || gBrNetlink.active || gBrBotFight.fighting;

    for (i = 0; i < count; i++)
    {
        struct Pokemon *mon = &gPlayerParty[i];
        u16 hp = GetMonData(mon, MON_DATA_HP);
        u16 maxHp = GetMonData(mon, MON_DATA_MAX_HP);
        u16 dmg = maxHp / 10;

        if (hp == 0 || GetMonData(mon, MON_DATA_SPECIES) == SPECIES_NONE)
            continue;
        if (dmg == 0)
            dmg = 1;
        if (dmg > hp)
            dmg = hp;
        if (floorAtOne && dmg >= hp)
            dmg = hp - 1;
        if (dmg == 0)
            continue;
        hp -= dmg;
        gBrRing.damageDealt += dmg;
        SetMonData(mon, MON_DATA_HP, &hp);
        // The battle is looking at its own copy, so the bar only moves if that moves
        // with it. Singles only, which is every battle this game has.
        if (floorAtOne && gBattlersCount > 0 && gBattlerPartyIndexes[0] == i)
            gBattleMons[0].hp = hp;
        if (hp > 0)
            alive++;
    }
    if (count > 0 && alive == 0 && !gBrRing.out)
    {
        // Through br_match's one door, so the fog drops a team on the ground like any
        // other way out (POK-232) instead of quietly sending its own OUT.
        gBrRing.out = TRUE;
        BrMatch_Out();
    }
}

// ---- the fog in a fight between contestants -------------------------------------------

// Where the turn's fog has got to: the turn it is for and the next battler to look at.
static EWRAM_DATA u8 sFogTurn = 0;
static EWRAM_DATA u8 sFogNext = 0;

void BrRing_SetBattleFog(bool8 fog)
{
    gBrRing.battleFog = fog ? TRUE : FALSE;
    sFogTurn = 0xFF;
    sFogNext = 0;
}

// The two trainers of a link battle stand on one map (a challenge is only taken from a
// ghost on our own), so the challenger's answer is both of theirs; a bot stands where
// we do. Decided once, at the start: the replay has to be told it, in the bstart.
void BrRing_DecideBattleFog(void)
{
    BrRing_SetBattleFog(gBrRing.active && !BrRing_SectionInside(gMapHeader.regionMapSectionId));
}

// "<MON> is hurt by the fog!", the bar, the HP. Like the sandstorm's, minus the faint: in
// a battle the fog hurts but never finishes anybody (see Bleed), so there is nothing to
// faint and nobody's team to lose here.
static const u8 sScript_FogHurts[] =
{
    B_SCR_OP_PRINTSTRING, BR_STRINGID_FOG_HURT & 0xFF, BR_STRINGID_FOG_HURT >> 8,
    B_SCR_OP_WAITMESSAGE, B_WAIT_TIME_LONG & 0xFF, B_WAIT_TIME_LONG >> 8,
    B_SCR_OP_HEALTHBARUPDATE, BS_ATTACKER,
    B_SCR_OP_DATAHPUPDATE, BS_ATTACKER,
    B_SCR_OP_END2,
};

#define FOG_HIT_MARKERS (HITMARKER_IGNORE_SUBSTITUTE | HITMARKER_PASSIVE_HP_UPDATE | HITMARKER_IGNORE_BIDE)

// A tenth of each fighter's max HP at the end of every turn, on whoever is on the field,
// down to 1. The bench is the field's to bleed afterwards: the other trainer's bench on
// a link battle is a copy the engine never sends back.
bool8 BrRing_FogEndTurn(void)
{
    u8 turn = gBattleResults.battleTurnCounter;
    u8 b;

    if (!ContestBattle() || !gBrRing.battleFog || gBattleOutcome != 0)
        return FALSE;
    // The slave of a link battle runs no engine; this is never reached there.
    if (sFogTurn != turn)
    {
        sFogTurn = turn;
        sFogNext = 0;
    }
    gHitMarker &= ~FOG_HIT_MARKERS;
    for (b = sFogNext; b < gBattlersCount; b++)
    {
        u16 hp = gBattleMons[b].hp;
        s32 dmg = gBattleMons[b].maxHP / 10;

        if (gAbsentBattlerFlags & gBitTable[b])
            continue;
        if (hp <= 1)
            continue;
        if (dmg < 1)
            dmg = 1;
        if (dmg >= hp)
            dmg = hp - 1;
        sFogNext = b + 1;
        gBattlerAttacker = b;
        gBattleMoveDamage = dmg;
        gBrRing.damageDealt += dmg;
        gHitMarker |= FOG_HIT_MARKERS;
        BattleScriptExecute(sScript_FogHurts);
        return TRUE;
    }
    sFogNext = gBattlersCount;
    return FALSE;
}

u16 BrRing_Outside(void)
{
    return gBrRing.active && gBrRing.outside ? 1 : 0;
}

void BrRing_Init(void)
{
    CpuFill32(0, &gBrRing, sizeof(gBrRing));
    gBrRing.damageTimer = BR_FOG_TICK_FRAMES;
    BrNet_On(BR_MSG_RING, HandleRing);
}

void BrRing_Tick(void)
{
    bool8 outside;

    // The fog does not stop at the battle door (POK-262). Outside the overworld the
    // only thing it can do is bleed -- the weather and the FOG! flash belong to a map --
    // so a battle it reaches takes the damage and nothing else.
    if (!gBrRing.active)
        return;
    if (!BrField_OverworldRunning())
    {
        if (!FogReachesThisBattle())
            return;
        // Asked of the map, not of gBrRing.outside: that flag is worked out by the
        // overworld branch below, so in a battle it is whatever it was when the battle
        // started -- and a ring that closed on you mid-fight would never be noticed.
        // The map header does not change for a battle, so this is still where we stand.
        if (BrRing_SectionInside(gMapHeader.regionMapSectionId))
            return;
        gBrRing.outside = TRUE;
        if (--gBrRing.damageTimer == 0)
        {
            gBrRing.damageTimer = BR_FOG_TICK_FRAMES;
            Bleed();
        }
        return;
    }
    outside = !BrRing_SectionInside(gMapHeader.regionMapSectionId);
    if (outside && !gBrRing.outside)
        gBrHud.flashFog = 1; // just went outside: the corner flashes FOG!
    gBrRing.outside = outside;
    // A map load resets the weather to the map's own; re-apply when the map changed.
    if (!gBrRing.applied
     || gBrRing.appliedMapGroup != gSaveBlock1Ptr->location.mapGroup
     || gBrRing.appliedMapNum != gSaveBlock1Ptr->location.mapNum)
        ApplyWeather(outside);
    if (!outside)
    {
        gBrRing.damageTimer = BR_FOG_TICK_FRAMES;
        return;
    }
    if (--gBrRing.damageTimer == 0)
    {
        gBrRing.damageTimer = BR_FOG_TICK_FRAMES;
        Bleed();
    }
}
