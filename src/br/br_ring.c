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
#include "br/br_ring.h"

EWRAM_DATA struct BrRing gBrRing = {0};

static bool8 OverworldRunning(void)
{
    return gMain.callback2 == CB2_Overworld && !gMain.inBattle;
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

static void HandleRing(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 5)
        return;
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
        hp -= dmg;
        gBrRing.damageDealt += dmg;
        SetMonData(mon, MON_DATA_HP, &hp);
        if (hp > 0)
            alive++;
    }
    if (count > 0 && alive == 0 && !gBrRing.out)
    {
        u8 seat = gBrMySeat;

        gBrRing.out = TRUE;
        BrWire_Send(BR_MSG_OUT, &seat, 1);
    }
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

    if (!gBrRing.active || !OverworldRunning())
        return;
    outside = !BrRing_SectionInside(gMapHeader.regionMapSectionId);
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
