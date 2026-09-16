// Match phases, START and CLOCK, the Safari opening's end and the drop (POK-222).
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "field_screen_effect.h"
#include "safari_zone.h"
#include "script.h"
#include "pokemon.h"
#include "constants/maps.h"
#include "hall_of_fame.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_match.h"
#include "br/br_ring.h"
#include "br/br_pick.h"
#include "br/br_loot.h"
#include "br/br_spectate.h"

EWRAM_DATA struct BrMatch gBrMatch = {0};
// START can span slots once there are more than six spawn rows.
static EWRAM_DATA u8 sStartBuf[10 + 8 * BR_MAX_SEATS] = {0};
static EWRAM_DATA struct BrAssembler sStartAsm = {0};
// START arrived while we were still standing on a map. The warp it asks for cannot be
// done from inside the mailbox pump, so the tick does it on the next quiet frame.
static EWRAM_DATA u8 sStartPending = 0;

static bool8 OverworldRunning(void)
{
    return gMain.callback2 == CB2_Overworld && !gMain.inBattle;
}

static void ParseStart(const u8 *d, u16 n)
{
    u8 i, count;

    if (n < 10)
        return;
    gBrMatch.seed = d[0] | (d[1] << 8) | (d[2] << 16) | ((u32)d[3] << 24);
    count = d[4];
    gBrMatch.safariSecs = BrWire_ReadU16(d + 5);
    gBrMatch.fogSecs = BrWire_ReadU16(d + 7);
    gBrMatch.pace = d[9];
    if (count > BR_MAX_SEATS)
        count = BR_MAX_SEATS;
    if (n < 10 + 8 * count)
        return;
    for (i = 0; i < count; i++)
    {
        const u8 *row = d + 10 + 8 * i;
        u8 seat = row[0];

        if (seat >= BR_MAX_SEATS)
            continue;
        gBrMatch.spawns[seat].mapGroup = row[1];
        gBrMatch.spawns[seat].mapNum = row[2];
        gBrMatch.spawns[seat].x = (s16)BrWire_ReadU16(row + 3);
        gBrMatch.spawns[seat].y = (s16)BrWire_ReadU16(row + 5);
        gBrMatch.haveSpawn[seat] = TRUE;
    }
    gBrMatch.spawnCount = count;
    gBrMatch.started = TRUE;
    if (gBrMatch.safariSecs > 0 && gBrMatch.phase == BR_PHASE_SAFARI)
    {
        gBrMatch.clockLeft = gBrMatch.safariSecs;
        gBrMatch.clockFrames = 60;
    }
    // Still on a map: this START is the match beginning under us. Booting straight
    // into the Safari Zone only ever happens to a driver (BR_BOOT_SAFARI) -- a real
    // room boots to Littleroot and waits in the lobby, so without this the opening
    // never begins, the clock runs out against a phase that is not SAFARI, and the
    // drop never fires. Which is to say: the match never actually started.
    else if (gBrMatch.phase == BR_PHASE_NONE)
    {
        sStartPending = TRUE;
    }
}

static void HandleStart(const u8 *payload, u8 len)
{
    if (BrWire_Assemble(&sStartAsm, BR_MSG_START, FALSE, payload, len))
        ParseStart(sStartAsm.buf, sStartAsm.total);
}

static void HandleStartCont(const u8 *payload, u8 len)
{
    if (BrWire_Assemble(&sStartAsm, BR_MSG_START, TRUE, payload, len))
        ParseStart(sStartAsm.buf, sStartAsm.total);
}

static EWRAM_DATA u8 sWinPending = 0;

// RESULT {seat, outcome}: outcome 0 for our seat means we are the last one standing.
static void HandleResult(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 2)
        return;
    BrSpectate_OnResult(d[0]);
    if (d[0] == gBrMySeat && d[1] == 0 && gBrMatch.phase != BR_PHASE_OUT)
        sWinPending = TRUE;
}

static void HandleClock(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 3)
        return;
    gBrMatch.clockLeft = BrWire_ReadU16(d + 1);
    gBrMatch.clockFrames = 60;
}

void BrMatch_Init(void)
{
    CpuFill32(0, &gBrMatch, sizeof(gBrMatch));
    sStartAsm.buf = sStartBuf;
    sStartAsm.cap = sizeof(sStartBuf);
    sStartAsm.type = 0;
    sStartPending = FALSE;
    BrNet_On(BR_MSG_START, HandleStart);
    BrNet_On(BR_MSG_START | BR_MSG_CONT, HandleStartCont);
    BrNet_On(BR_MSG_CLOCK, HandleClock);
    BrNet_On(BR_MSG_RESULT, HandleResult);
    sWinPending = FALSE;
}

void BrMatch_BeginSafari(void)
{
    EnterSafariMode();
    gBrMatch.phase = BR_PHASE_SAFARI;
    gBrMatch.clockLeft = gBrMatch.safariSecs;
    gBrMatch.clockFrames = 60;
}

void BrMatch_Out(void)
{
    u8 seat = gBrMySeat;

    if (gBrMatch.phase == BR_PHASE_OUT)
        return;
    gBrMatch.phase = BR_PHASE_OUT;
    BrWire_Send(BR_MSG_OUT, &seat, 1);
    // Then what we were carrying: the room hears the elimination first, and the spill
    // that goes with it right behind (POK-232).
    BrLoot_SpillOwn();
}

static void SendOut(void)
{
    BrMatch_Out();
}

void BrMatch_SafariOver(void)
{
    struct BrSpawn *sp;

    if (gBrMatch.phase != BR_PHASE_SAFARI)
        return;
    ExitSafariMode();
    if (CalculatePlayerPartyCount() == 0)
    {
        // Caught nothing: eliminated at the buzzer (Kanto rule). The page takes over.
        SendOut();
        return;
    }
    gBrMatch.phase = BR_PHASE_PLAY;
    // Where you land is yours to choose (POK-223): the fly map goes up, the section
    // goes out as `pick`, and the host deals a cell inside it. The START's own spawn is
    // the fallback -- for a driver, and for anyone the page never answers.
    if (BrPick_Start())
        return;
    if (!gBrMatch.haveSpawn[gBrMySeat])
        return; // no deal yet; the page will place us with a later START
    sp = &gBrMatch.spawns[gBrMySeat];
    SetWarpDestination(sp->mapGroup, sp->mapNum, WARP_ID_NONE, sp->x, sp->y);
    DoWarp();
}

void BrMatch_WhiteOut(void)
{
    if (gBrMatch.phase != BR_PHASE_OUT)
        SendOut();
}

void BrMatch_HallOfFameDone(void)
{
    SetWarpDestination(gSaveBlock1Ptr->location.mapGroup, gSaveBlock1Ptr->location.mapNum, WARP_ID_NONE,
                       gSaveBlock1Ptr->pos.x, gSaveBlock1Ptr->pos.y);
    WarpIntoMap();
    gMain.state = 0;
    SetMainCallback2(CB2_LoadMap);
}

void BrMatch_Tick(void)
{
    if (sWinPending && OverworldRunning() && !ScriptContext_IsEnabled() && !ArePlayerFieldControlsLocked())
    {
        // The winner's parade: Emerald's own Hall of Fame, no save, no credits.
        sWinPending = FALSE;
        gBrMatch.phase = BR_PHASE_WIN;
        SetMainCallback2(CB2_DoHallOfFameScreenDontSaveData);
        return;
    }
    if (sStartPending && OverworldRunning() && !ScriptContext_IsEnabled() && !ArePlayerFieldControlsLocked())
    {
        sStartPending = FALSE;
        if (gBrMatch.safariSecs > 0)
        {
            // Safari Zone South, a few tiles north of the exit gate -- the same cell
            // BR_BOOT_SAFARI uses, so both ways in land in the same place.
            SetWarpDestination(MAP_GROUP(MAP_SAFARI_ZONE_SOUTH), MAP_NUM(MAP_SAFARI_ZONE_SOUTH),
                               WARP_ID_NONE, 32, 30);
            DoWarp();
            BrMatch_BeginSafari();
        }
        else if (gBrMatch.haveSpawn[gBrMySeat])
        {
            // No opening: straight to the drop.
            struct BrSpawn *sp = &gBrMatch.spawns[gBrMySeat];

            gBrMatch.phase = BR_PHASE_PLAY;
            SetWarpDestination(sp->mapGroup, sp->mapNum, WARP_ID_NONE, sp->x, sp->y);
            DoWarp();
        }
        return;
    }
    if (gBrMatch.phase != BR_PHASE_SAFARI || !OverworldRunning())
        return;
    // The fog is up: the opening is over whatever our own clock says. It has to be
    // this way round, because the CLOCK the page sends during the ring phases is the
    // ring's countdown and HandleClock cannot tell the two apart -- so a ring clock
    // arriving before our own hit zero used to reset it to 55 and the drop never
    // happened at all. The opening ending is an event, not an arithmetic result.
    if (gBrRing.active)
    {
        BrMatch_SafariOver();
        return;
    }
    // Balls gone mid-opening: the scripts that would warp out are stubbed under BR,
    // so this is where the opening ends for the ball-less.
    if (gNumSafariBalls == 0 && gBrMatch.started)
    {
        BrMatch_SafariOver();
        return;
    }
    if (!gBrMatch.started)
        return;
    if (gBrMatch.clockFrames > 0 && --gBrMatch.clockFrames == 0)
    {
        gBrMatch.clockFrames = 60;
        if (gBrMatch.clockLeft > 0)
            gBrMatch.clockLeft--;
    }
    if (gBrMatch.clockLeft == 0)
        BrMatch_SafariOver();
}
