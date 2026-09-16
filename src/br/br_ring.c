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

EWRAM_DATA struct BrRing gBrRing = {0};

static bool8 OverworldRunning(void)
{
    return gMain.callback2 == CB2_Overworld && !gMain.inBattle;
}

// Does the fog reach into this battle (POK-262)? Kanto's rule, v0.3.1: a wild or route
// fight fought outside the ring drains you, and a fight between contestants does not.
// Both halves matter. Without the first, a battle is somewhere to hide from the fog --
// step outside the ring, pick a fight with the grass, and the clock stops mattering.
// Without the second, a duel is decided by whose map the ring happens to be over.
static bool8 FogReachesThisBattle(void)
{
    if (!gMain.inBattle)
        return FALSE;
    if (gBrNetlink.active || gBrBotFight.fighting || gBrDuel.running)
        return FALSE; // a fight between contestants is theirs to lose
    return TRUE;
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

// The bottom box on a ring move: the place the fog is closing on, which the host
// already sends and nothing was reading. Two lines, 90 frames, above the ticker.
static const u8 sText_FogCloses[] = _("THE FOG CLOSES IN ON");

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

    if (n < 5)
        return;
    // A new phase, with a place named: say where. The corner's FOG! flash is the
    // page's own (gBrHud.flashFog); this is the sentence that goes with it.
    if (d[1] != gBrRing.phase && n >= 6 && d[5] > 0 && (u16)(6 + d[5]) <= n)
        SayFog(d + 6, d[5]);
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
    bool8 floorAtOne = FogReachesThisBattle();

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
    if (!OverworldRunning())
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
