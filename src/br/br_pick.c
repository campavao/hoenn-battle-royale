// The drop: the fly map as the picker (POK-223). See include/br/br_pick.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "task.h"
#include "palette.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "script.h"
#include "region_map.h"
#include "sprite.h"
#include "text.h"
#include "constants/field_weather.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_match.h"
#include "br/br_pick.h"
#include "br/br_field.h"

EWRAM_DATA struct BrPick gBrPick = {0};

// The map is the same screen Emerald flies from, but this is not a flight.
const u8 gBrText_DropWhere[] = _("DROP where?");

// LAND {seat, mapGroup, mapNum, x, y}: the cell the host dealt us inside the section we
// asked for. Only ever addressed to one seat, but it is a broadcast like everything
// else, so the seat check is the filter.
static void HandleLand(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 7 || d[0] != gBrMySeat)
        return;
    // A map gMapGroups does not have is no cell at all: the drop's own timeout deals one
    // (POK-330 #43).
    if (!BrWire_MapOk(d[1], d[2]))
        return;
    gBrPick.mapGroup = d[1];
    gBrPick.mapNum = d[2];
    gBrPick.x = (s16)BrWire_ReadU16(d + 3);
    gBrPick.y = (s16)BrWire_ReadU16(d + 5);
    gBrPick.landed = TRUE;
}

void BrPick_Init(void)
{
    CpuFill32(0, &gBrPick, sizeof(gBrPick));
    BrNet_On(BR_MSG_LAND, HandleLand);
}

// Twenty seconds, the same as Kanto's. Long enough to read the map, short enough that
// nobody is kept waiting by somebody who walked away.
#define BR_PICK_FRAMES (20 * 60)

// ...and how long the black screen after it will wait for the host's cell. Between
// the map closing and `land` arriving there is nothing on screen and nothing that
// answers a button (CB2_BrPickWait below), which is indistinguishable from a frozen
// game -- and the play-test froze there. So it asks again, and then it stops
// waiting: a drop we dealt ourselves is a match, and a black screen is not.
#define BR_PICK_ASK_AGAIN (5 * 60)
#define BR_PICK_GIVE_UP (15 * 60)

bool8 BrPick_Picking(void)
{
    return gBrPick.active;
}

bool8 BrPick_TimedOut(void)
{
    if (!gBrPick.active || gBrPick.landed)
        return FALSE;
    if (gBrPick.timer > 0 && --gBrPick.timer > 0)
        return FALSE;
    return TRUE;
}

void BrPick_Chose(u16 mapSec)
{
    u8 buf[3];

    gBrPick.asked = mapSec;
    gBrPick.waited = 0;
    buf[0] = gBrMySeat;
    BrWire_WriteU16(buf + 1, mapSec);
    BrWire_Send(BR_MSG_PICK, buf, 3);
}

// Between the map closing and the cell arriving there is nothing to show and nothing
// to do -- the fly map has been freed and where we are going is still the host's to
// say. So: black. BrFrame() runs from the main loop rather than from a field callback,
// so BrPick_Tick still gets its frame and takes over the moment `land` lands.
static void CB2_BrPickWait(void)
{
    RunTasks();
    AnimateSprites();
    BuildOamBuffer();
    UpdatePaletteFade();
}

void BrPick_Wait(void)
{
    SetMainCallback2(CB2_BrPickWait);
}

// Into the map screen, which wants the overworld's windows and tilemaps back first.
static void EnterPicker(void)
{
    gMain.state = 0;
    SetMainCallback2(CB2_OpenFlyMap);
}

bool8 BrPick_Start(void)
{
    if (gBrPick.active || gMain.callback2 != CB2_Overworld || gMain.inBattle)
        return FALSE;
    if (!BrField_Leave(20, EnterPicker))
        return FALSE;
    gBrPick.active = TRUE;
    gBrPick.landed = FALSE;
    gBrPick.timer = BR_PICK_FRAMES;
    return TRUE;
}

// Nothing is coming. The cell the START dealt us is the one every client already
// has, so it is the drop we make for ourselves; with not even that, reloading the
// map we are standing on at least hands the controls back.
static void DropWithoutTheHost(void)
{
    gBrPick.active = FALSE;
    gBrPick.landed = FALSE;
    gBrPick.waited = 0;
    if (BrMatch_MySpawn() != NULL)
    {
        const struct BrSpawn *sp = BrMatch_MySpawn();

        SetWarpDestination(sp->mapGroup, sp->mapNum, WARP_ID_NONE, sp->x, sp->y);
        WarpIntoMap();
    }
    gFieldCallback = NULL;
    gMain.state = 0;
    SetMainCallback2(CB2_LoadMap);
}

void BrPick_Tick(void)
{
    if (!gBrPick.landed)
    {
        if (!gBrPick.active || gMain.callback2 != CB2_BrPickWait)
            return;
        gBrPick.waited++;
        if (gBrPick.waited == BR_PICK_ASK_AGAIN)
        {
            u8 buf[3];

            // One more ask, in case the slot went in the ring rather than the room.
            buf[0] = gBrMySeat;
            BrWire_WriteU16(buf + 1, gBrPick.asked);
            BrWire_Send(BR_MSG_PICK, buf, 3);
        }
        else if (gBrPick.waited >= BR_PICK_GIVE_UP)
        {
            DropWithoutTheHost();
        }
        return;
    }
    if (gMain.callback2 == CB2_BrPickWait)
    {
        // Straight off the black screen the map left behind: no fly-in, no bounce
        // through the field we are leaving anyway.
        gBrPick.landed = FALSE;
        gBrPick.active = FALSE;
        SetWarpDestination(gBrPick.mapGroup, gBrPick.mapNum, WARP_ID_NONE, gBrPick.x, gBrPick.y);
        WarpIntoMap();
        gFieldCallback = NULL;
        gMain.state = 0;
        SetMainCallback2(CB2_LoadMap);
        return;
    }
    // The picker never opened (a driver, or a `land` we did not ask for): warp from
    // wherever we are standing, once nothing else is going on.
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle
     || ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked())
        return;
    gBrPick.landed = FALSE;
    gBrPick.active = FALSE;
    SetWarpDestination(gBrPick.mapGroup, gBrPick.mapNum, WARP_ID_NONE, gBrPick.x, gBrPick.y);
    DoWarp();
}
